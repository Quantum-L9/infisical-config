import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Chainable @infisical/sdk mock:
//   new InfisicalSDK().auth().universalAuth.login(...)
//   new InfisicalSDK().secrets().listSecrets(...)
const { ctorMock, loginMock, listSecretsMock } = vi.hoisted(() => {
  const loginMock = vi.fn();
  const listSecretsMock = vi.fn();
  // Must be a real `function`, not an arrow: the SDK is invoked with `new
  // InfisicalSDK(...)`, and arrow functions aren't constructable. Vitest 3
  // silently tolerated this; vitest 4 enforces real constructor semantics.
  const ctorMock = vi.fn(function InfisicalSDKMock() {
    return {
      auth: () => ({ universalAuth: { login: loginMock } }),
      secrets: () => ({ listSecrets: listSecretsMock }),
    };
  });
  return { ctorMock, loginMock, listSecretsMock };
});

vi.mock('@infisical/sdk', () => ({ InfisicalSDK: ctorMock }));

import { loadSecrets } from '../src/index.js';

const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };

const TOUCHED = [
  'INFISICAL_CLIENT_ID',
  'INFISICAL_CLIENT_SECRET',
  'INFISICAL_PROJECT_ID',
  'INFISICAL_ENV',
  'INFISICAL_SECRET_PATH',
  'INFISICAL_REQUIRED',
  'INFISICAL_RECURSIVE',
  'INFISICAL_SITE_URL',
  'FETCHED_SECRET',
  'ALREADY_SET',
];

beforeEach(() => {
  for (const k of TOUCHED) delete process.env[k];
  ctorMock.mockClear();
  loginMock.mockReset();
  listSecretsMock.mockReset();
  logger.info.mockReset();
  logger.warn.mockReset();
  logger.debug.mockReset();
});

afterEach(() => {
  for (const k of TOUCHED) delete process.env[k];
});

const creds = { clientId: 'cid', clientSecret: 'csecret', projectId: 'proj' };

describe('loadSecrets', () => {
  it('is a no-op when Infisical is not configured', async () => {
    const result = await loadSecrets({ logger });
    expect(result).toEqual({ loaded: false, injected: 0, source: 'env' });
    expect(ctorMock).not.toHaveBeenCalled();
  });

  it('throws when required but config is missing', async () => {
    await expect(loadSecrets({ required: true, logger })).rejects.toThrow(/INFISICAL_REQUIRED/);
    expect(ctorMock).not.toHaveBeenCalled();
  });

  it('warns and no-ops on partial config (only some creds)', async () => {
    const result = await loadSecrets({ clientId: 'cid', logger });
    expect(result.loaded).toBe(false);
    expect(ctorMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('reads options and env interchangeably (options win)', async () => {
    process.env.INFISICAL_PROJECT_ID = 'env-proj';
    listSecretsMock.mockResolvedValue({ secrets: [] });
    await loadSecrets({ clientId: 'cid', clientSecret: 'csecret', logger }); // projectId from env
    expect(loginMock).toHaveBeenCalledWith({ clientId: 'cid', clientSecret: 'csecret' });
    expect(listSecretsMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'env-proj', environment: 'prod', secretPath: '/' }),
    );
  });

  it('backfills only missing keys, preserving already-set env', async () => {
    process.env.ALREADY_SET = 'from-env';
    listSecretsMock.mockResolvedValue({
      secrets: [
        { secretKey: 'FETCHED_SECRET', secretValue: 'from-infisical' },
        { secretKey: 'ALREADY_SET', secretValue: 'from-infisical' },
      ],
    });
    const result = await loadSecrets({ ...creds, logger });
    expect(process.env.FETCHED_SECRET).toBe('from-infisical');
    expect(process.env.ALREADY_SET).toBe('from-env');
    expect(result).toEqual({ loaded: true, injected: 1, source: 'infisical' });
  });

  it('overwrites existing keys when overwrite=true', async () => {
    process.env.ALREADY_SET = 'from-env';
    listSecretsMock.mockResolvedValue({
      secrets: [{ secretKey: 'ALREADY_SET', secretValue: 'from-infisical' }],
    });
    const result = await loadSecrets({ ...creds, overwrite: true, logger });
    expect(process.env.ALREADY_SET).toBe('from-infisical');
    expect(result.injected).toBe(1);
  });

  it('honours environment / secretPath overrides', async () => {
    listSecretsMock.mockResolvedValue({ secrets: [] });
    await loadSecrets({ ...creds, environment: 'staging', secretPath: '/svc', logger });
    expect(listSecretsMock).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'staging', secretPath: '/svc' }),
    );
  });

  it('fails soft on fetch error when not required', async () => {
    listSecretsMock.mockRejectedValue(new Error('network down'));
    const result = await loadSecrets({ ...creds, logger });
    expect(result).toEqual({ loaded: false, injected: 0, source: 'env' });
  });

  it('aborts on fetch error when required', async () => {
    listSecretsMock.mockRejectedValue(new Error('network down'));
    await expect(loadSecrets({ ...creds, required: true, logger })).rejects.toThrow(/network down/);
  });
});
