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

import { loadSecrets, refreshSecrets, installSighupReload, startRefreshInterval } from '../src/index.js';

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
  'ROTATED_KEY',
];

beforeEach(() => {
  for (const k of TOUCHED) delete process.env[k];
  ctorMock.mockClear();
  loginMock.mockReset();
  listSecretsMock.mockReset();
  logger.info.mockReset();
  logger.warn.mockReset();
  logger.debug.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  for (const k of TOUCHED) delete process.env[k];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const creds = { clientId: 'cid', clientSecret: 'csecret', projectId: 'proj' };

// ── Original 9 loadSecrets tests (no regressions) ───────────────────────────

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
    await loadSecrets({ clientId: 'cid', clientSecret: 'csecret', logger });
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

// ── refreshSecrets tests ─────────────────────────────────────────────────────

describe('refreshSecrets', () => {
  it('always overwrites process.env — picks up rotated value', async () => {
    process.env.ROTATED_KEY = 'old-value';
    listSecretsMock.mockResolvedValue({
      secrets: [{ secretKey: 'ROTATED_KEY', secretValue: 'new-value' }],
    });
    const result = await refreshSecrets({ ...creds, logger });
    expect(process.env.ROTATED_KEY).toBe('new-value');
    expect(result.loaded).toBe(true);
    expect(result.injected).toBe(1);
  });

  it('returns a refreshedAt ISO timestamp', async () => {
    listSecretsMock.mockResolvedValue({ secrets: [] });
    const result = await refreshSecrets({ ...creds, logger });
    expect(result.refreshedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('calls onRefresh callback with result', async () => {
    listSecretsMock.mockResolvedValue({ secrets: [] });
    const onRefresh = vi.fn();
    await refreshSecrets({ ...creds, logger, onRefresh });
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onRefresh.mock.calls[0][0]).toMatchObject({ loaded: true });
  });

  it('warns and returns env source when Infisical is not configured', async () => {
    const result = await refreshSecrets({ logger });
    expect(result.loaded).toBe(false);
    expect(result.source).toBe('env');
    expect(result.refreshedAt).toBeTruthy();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('fails soft on fetch error — does not throw', async () => {
    listSecretsMock.mockRejectedValue(new Error('timeout'));
    const result = await refreshSecrets({ ...creds, logger });
    expect(result.loaded).toBe(false);
    expect(result.source).toBe('env');
  });
});

// ── installSighupReload tests ────────────────────────────────────────────────

describe('installSighupReload', () => {
  it('re-fetches secrets with overwrite on SIGHUP', async () => {
    process.env.ROTATED_KEY = 'stale';
    listSecretsMock.mockResolvedValue({
      secrets: [{ secretKey: 'ROTATED_KEY', secretValue: 'fresh' }],
    });

    // Use onRefresh as a completion signal so we don't race against the
    // fire-and-forget promise inside the SIGHUP handler.
    let resolve!: () => void;
    const refreshDone = new Promise<void>(r => { resolve = r; });

    const uninstall = installSighupReload({ ...creds, logger, onRefresh: () => resolve() });

    process.emit('SIGHUP');
    await refreshDone;

    expect(process.env.ROTATED_KEY).toBe('fresh');
    uninstall();
  });

  it('uninstall removes the SIGHUP listener', async () => {
    listSecretsMock.mockResolvedValue({ secrets: [] });
    const uninstall = installSighupReload({ ...creds, logger });
    uninstall();

    const callsBefore = loginMock.mock.calls.length;
    process.emit('SIGHUP');
    await Promise.resolve();
    expect(loginMock.mock.calls.length).toBe(callsBefore);
  });
});

// ── startRefreshInterval tests ───────────────────────────────────────────────

describe('startRefreshInterval', () => {
  it('fires immediately and on interval', async () => {
    listSecretsMock.mockResolvedValue({ secrets: [] });

    // Use onRefresh to signal each completion — the fire-and-forget promises
    // inside startRefreshInterval cannot be awaited directly.
    const completions: Array<() => void> = [];
    const nextCompletion = () => new Promise<void>(r => completions.push(r));
    const onRefresh = () => completions.shift()?.();

    const firstDone = nextCompletion();
    const handle = startRefreshInterval(15 * 60 * 1000, { ...creds, logger, onRefresh });

    // Wait for the immediate first fire
    await firstDone;
    expect(loginMock).toHaveBeenCalledTimes(1);

    // Register completion listener before advancing so we never miss the callback
    const secondDone = nextCompletion();
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    await secondDone;
    expect(loginMock).toHaveBeenCalledTimes(2);

    clearInterval(handle);
  });

  it('does not call Infisical after clearInterval', async () => {
    listSecretsMock.mockResolvedValue({ secrets: [] });

    let resolveFirst!: () => void;
    const firstFire = new Promise<void>(r => { resolveFirst = r; });

    // Wait for the immediate fire before clearing, so it doesn't bleed into
    // the post-clearInterval assertion.
    const handle = startRefreshInterval(15 * 60 * 1000, {
      ...creds,
      logger,
      onRefresh: () => resolveFirst(),
    });
    await firstFire;
    clearInterval(handle);

    const callsAfterClear = loginMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(loginMock.mock.calls.length).toBe(callsAfterClear);
  });
});
