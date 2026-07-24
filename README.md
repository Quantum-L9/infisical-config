# @quantum-l9/infisical-config

Shared, optional Infisical secret loader for Quantum-L9 services. Authenticates a
**machine identity** (Universal Auth) and hydrates `process.env` from Infisical, so a
service can run on a VPS with no committed `.env`.

- **Optional** — no-op when the bootstrap vars are absent (falls back to `process.env`).
- **Non-destructive** — never overwrites an already-set var (unless `overwrite: true`).
- **Fail-soft** by default; `required` makes it a hard dependency.
- **Lazy** — `@infisical/sdk` is only imported when Infisical is configured.
- **Rotation-aware** — `refreshSecrets`, `installSighupReload`, and `startRefreshInterval`
  close the rotation loop so rotated Universal Auth secrets propagate without restart.

## Install
Consumers authenticate to GitHub Packages (same `.npmrc` convention as
`@quantum-l9/llm-router`):
```
@quantum-l9:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
always-auth=true
```
```bash
npm install @quantum-l9/infisical-config
```

## Usage

### Boot-time load (initial hydration)
```ts
import { loadSecrets } from '@quantum-l9/infisical-config';

// At the very top of your entrypoint, before any config is read:
await loadSecrets();                       // pure env-driven (INFISICAL_*)
await loadSecrets({ logger });             // pass a pino-compatible logger
await loadSecrets({ required: true });     // abort boot if Infisical is unreachable
```

### Rotation-aware reload (recommended for long-running services)
```ts
import { loadSecrets, installSighupReload } from '@quantum-l9/infisical-config';

// 1. Boot-time hydration (backfill only)
await loadSecrets({ logger });

// 2. SIGHUP reload — triggered by systemd ExecReload or infra's rotation timer
//    Calls refreshSecrets({ overwrite: true }) so rotated values replace stale ones.
const uninstall = installSighupReload({ logger });

// 3. (Optional) Belt-and-suspenders interval — keep shorter than rotation overlap window
//    import { startRefreshInterval } from '@quantum-l9/infisical-config';
//    const handle = startRefreshInterval(15 * 60 * 1000, { logger });

// On graceful shutdown:
// uninstall();
// clearInterval(handle);
```

### Manual refresh
```ts
import { refreshSecrets } from '@quantum-l9/infisical-config';

// Always overwrites — use this in reload paths, not initial boot.
const result = await refreshSecrets({ logger });
console.log(result.refreshedAt, result.injected);
```

## Config reference

Every option falls back to its `INFISICAL_*` env var, so a zero-arg call is fully
environment-driven:

| Option | Env var | Default |
| --- | --- | --- |
| `clientId` | `INFISICAL_CLIENT_ID` | — (required to enable) |
| `clientSecret` | `INFISICAL_CLIENT_SECRET` | — (required to enable) |
| `projectId` | `INFISICAL_PROJECT_ID` | — (required to enable) |
| `environment` | `INFISICAL_ENV` | `prod` |
| `secretPath` | `INFISICAL_SECRET_PATH` | `/` |
| `siteUrl` | `INFISICAL_SITE_URL` | SDK default (cloud) |
| `recursive` | `INFISICAL_RECURSIVE` | `false` |
| `required` | `INFISICAL_REQUIRED` | `false` |
| `overwrite` | — | `false` (always `true` in refresh paths) |

Returns `{ loaded, injected, source }`. Secret **names in Infisical must match the env
var names your app expects** — they're injected verbatim.

## Rotation loop (infra integration)

`infra`'s `systemd/rotation-reload.timer` + `rotation-reload.service` re-run
`scripts/issue-client-secret.sh` on a schedule, update the systemd `EnvironmentFile`,
then send `SIGHUP` to the running service. `installSighupReload()` handles that signal
by calling `refreshSecrets({ overwrite: true })`, completing the rotation loop without
a process restart.

```
Infisical rotates secret (dual-phase, old still valid)
  → infra rotation-reload.service fires
  → issue-client-secret.sh --format systemd writes new EnvironmentFile
  → systemctl reload <your-service>  (sends SIGHUP)
  → SIGHUP handler calls refreshSecrets({ overwrite: true })
  → process.env updated with new credential
  → old credential revoked by Infisical after overlap window
```

## Publishing
Bump `version` in `package.json` on `main` → `publish.yml` builds and publishes to
GitHub Packages (version-gated; won't re-publish an existing version). Auth is the
built-in `GITHUB_TOKEN` (`packages: write`), no PAT.

## Develop
```bash
npm install
npm run build      # tsc -> dist/
npm test           # vitest (18 tests: 9 original + 9 rotation)
```
