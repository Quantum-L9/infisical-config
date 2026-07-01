// @quantum-l9/infisical-config — shared Infisical secret loader.
// Consumers: `import { loadSecrets } from '@quantum-l9/infisical-config'`.
export { loadSecrets, envFlag } from './secrets.js';
export type { LoadSecretsOptions, LoadSecretsResult, Logger } from './types.js';
