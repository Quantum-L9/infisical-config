import type { LoadSecretsOptions, LoadSecretsResult, Logger } from './types.js';

/** Fallback logger when a service doesn't pass its own. Quiet by default. */
const consoleLogger: Logger = {
  info: (obj, msg) => console.info(msg ?? '', obj ?? ''),
  warn: (obj, msg) => console.warn(msg ?? '', obj ?? ''),
  debug: (obj, msg) => {
    if (process.env.DEBUG) console.debug(msg ?? '', obj ?? '');
  },
};

/** Parse a loose boolean env var ('1' / 'true', case-insensitive). */
export function envFlag(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

/**
 * Hydrate process.env from Infisical (https://infisical.com) via a machine
 * identity (Universal Auth). Designed to be called once, before configuration
 * is read/validated.
 *
 *  - OPTIONAL: no-op when client id / secret / project id are all absent —
 *    falls back to process.env exactly as before. Nothing breaks locally.
 *  - NON-DESTRUCTIVE: never overwrites an already-set var (unless `overwrite`),
 *    so an explicit shell/systemd export or a local .env still wins.
 *  - FAIL-SOFT by default; `required` (or INFISICAL_REQUIRED=true) makes it a
 *    hard dependency that throws on missing config or fetch failure.
 *  - @infisical/sdk is imported lazily, so it's only resolved when configured.
 *
 * Every option falls back to its INFISICAL_* environment variable, so a
 * zero-arg `loadSecrets()` behaves purely off the environment.
 */
export async function loadSecrets(options: LoadSecretsOptions = {}): Promise<LoadSecretsResult> {
  const log = options.logger ?? consoleLogger;

  const clientId = options.clientId ?? process.env.INFISICAL_CLIENT_ID;
  const clientSecret = options.clientSecret ?? process.env.INFISICAL_CLIENT_SECRET;
  const projectId = options.projectId ?? process.env.INFISICAL_PROJECT_ID;
  const required = options.required ?? envFlag(process.env.INFISICAL_REQUIRED);
  const overwrite = options.overwrite ?? false;

  // Not configured → no-op fallback to process.env.
  if (!clientId || !clientSecret || !projectId) {
    if (required) {
      throw new Error(
        'INFISICAL_REQUIRED is set but client id, client secret and project id are not all provided.',
      );
    }
    // Partial config is almost always a deploy misconfiguration — surface it.
    if (clientId || clientSecret || projectId) {
      log.warn(
        {
          hasClientId: Boolean(clientId),
          hasClientSecret: Boolean(clientSecret),
          hasProjectId: Boolean(projectId),
        },
        'Infisical partially configured — need client id, client secret and project id; skipping Infisical',
      );
    } else {
      log.debug({}, 'Infisical not configured — using process.env only');
    }
    return { loaded: false, injected: 0, source: 'env' };
  }

  const environment = options.environment ?? process.env.INFISICAL_ENV ?? 'prod';
  const secretPath = options.secretPath ?? process.env.INFISICAL_SECRET_PATH ?? '/';
  const siteUrl = options.siteUrl ?? process.env.INFISICAL_SITE_URL;
  const recursive = options.recursive ?? envFlag(process.env.INFISICAL_RECURSIVE);

  try {
    // Lazy import: the SDK is only loaded when Infisical is configured.
    const { InfisicalSDK } = await import('@infisical/sdk');
    const client = new InfisicalSDK(siteUrl ? { siteUrl } : {});

    await client.auth().universalAuth.login({ clientId, clientSecret });

    const { secrets } = await client.secrets().listSecrets({
      environment,
      projectId,
      secretPath,
      recursive,
      expandSecretReferences: true,
    });

    let injected = 0;
    for (const secret of secrets) {
      if (overwrite || process.env[secret.secretKey] === undefined) {
        process.env[secret.secretKey] = secret.secretValue;
        injected++;
      }
    }

    log.info(
      { environment, secretPath, fetched: secrets.length, injected },
      'Loaded secrets from Infisical',
    );
    return { loaded: true, injected, source: 'infisical' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (required) {
      throw new Error(`Infisical secret load failed (required): ${message}`);
    }
    log.warn({ error: message }, 'Infisical secret load failed — continuing with process.env');
    return { loaded: false, injected: 0, source: 'env' };
  }
}
