# @quantum-l9/infisical-config

Shared, optional Infisical secret loader for Quantum-L9 services. Authenticates a
**machine identity** (Universal Auth) and hydrates `process.env` from Infisical, so a
service can run on a VPS with no committed `.env`.

- **Optional** — no-op when the bootstrap vars are absent (falls back to `process.env`).
- **Non-destructive** — never overwrites an already-set var (unless `overwrite: true`).
- **Fail-soft** by default; `required` makes it a hard dependency.
- **Lazy** — `@infisical/sdk` is only imported when Infisical is configured.

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
```ts
import { loadSecrets } from '@quantum-l9/infisical-config';

// At the very top of your entrypoint, before any config is read:
await loadSecrets();                       // pure env-driven (INFISICAL_*)
await loadSecrets({ logger });             // pass a pino-compatible logger
await loadSecrets({ required: true });     // abort boot if Infisical is unreachable
```

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
| `overwrite` | — | `false` |

Returns `{ loaded, injected, source }`. Secret **names in Infisical must match the env
var names your app expects** — they're injected verbatim.

## Publishing
Bump `version` in `package.json` on `main` → `publish.yml` builds and publishes to
GitHub Packages (version-gated; won't re-publish an existing version). Auth is the
built-in `GITHUB_TOKEN` (`packages: write`), no PAT.

## Develop
```bash
npm install
npm run build      # tsc -> dist/
npm test           # vitest
```
