# HANDOFF — push this to Quantum-L9/infisical-config

Generated where `Quantum-L9/infisical-config` was out of GitHub scope, so it couldn't
be pushed from there. Push it from a session/terminal where the repo is writable.

## What this is
Pillar 3 of the unified plan: the shared `@quantum-l9/infisical-config` npm package —
a generalized, logger-decoupled version of SEO-Bot's `secrets.ts`. Replicates the
`@quantum-l9/llm-router` publish template (GitHub Packages, `GITHUB_TOKEN`, version-gate).

## Validated locally (this was fully runnable — no private deps)
- `npm install` ✅ (only public deps: `@infisical/sdk`, `typescript`, `vitest`)
- `npm run build` ✅ → `dist/` with `index.js` + `index.d.ts` (+ maps)
- `npm test` ✅ → **9/9** passing (no-op, required-missing, partial-config warn,
  option/env interchange, backfill-only, overwrite, env/path overrides, fail-soft,
  required-fetch-error)

## Option A — push the included git bundle (preserves the commit)
```bash
git clone infisical-config.bundle infisical-config && cd infisical-config
git remote set-url origin https://github.com/Quantum-L9/infisical-config.git
git push -u origin main
```

## Option B — push the tarball contents
```bash
mkdir infisical-config && tar -xzf infisical-config.tar.gz -C infisical-config && cd infisical-config
git init -b main && git add . && git commit -m "feat: @quantum-l9/infisical-config initial package"
git remote add origin https://github.com/Quantum-L9/infisical-config.git
git push -u origin main
```
> The tarball excludes `node_modules/` and `dist/` (rebuilt in CI) but **includes
> `package-lock.json`** so CI's `npm ci` is reproducible.

## After pushing
1. **CI** (`.github/workflows/ci.yml`) runs on push: `npm ci` → typecheck → build → test.
2. **Publish**: the first push to `main` touches `package.json`, so `publish.yml` fires,
   builds, and publishes `@quantum-l9/infisical-config@1.0.0` to GitHub Packages
   (version-gated). Confirm with `npm view @quantum-l9/infisical-config version` (with a
   Packages-read token).
3. **Grant read access** to the consuming repos (same as `@quantum-l9/llm-router`) if the
   org doesn't already share packages org-wide.

## Then (Pillar 4 — needs SEO-Bot / Website-Bot, already in scope elsewhere)
- **SEO-Bot**: `npm i @quantum-l9/infisical-config`, replace inline `src/core/secrets.ts`
  usage in `src/index.ts` + `migrate.ts` with `import { loadSecrets } from
  '@quantum-l9/infisical-config'` (pass the pino logger), delete the inline file + its test.
- **Website-Bot**: wrap the pipeline in `infisical run` in CI (CLI baseline).

## Security
No secrets in the repo. Auth for publish/install is the built-in `GITHUB_TOKEN`; no PAT.
