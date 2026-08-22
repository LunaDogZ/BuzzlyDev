import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Finding A05-1 regression tests.
 *
 * The bug being pinned: `MOCK_API_BASE_URL` used to fall back to
 * `https://mock-api-sable.vercel.app/` whenever `VITE_BACKEND_API_URL` was
 * unset — a host this project neither owns nor allows in its own CSP. These
 * tests fail if that fallback, or any other default host, comes back.
 *
 * `import.meta.env` is read at module scope, so every case stubs the env and
 * then re-imports the module.
 */
async function loadWith(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) vi.stubEnv('VITE_BACKEND_API_URL', '');
  else vi.stubEnv('VITE_BACKEND_API_URL', value);
  return import('../mockApiKeys');
}

describe('backend base URL — fails closed (finding A05-1)', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  it('is null when VITE_BACKEND_API_URL is unset', async () => {
    const m = await loadWith(undefined);
    expect(m.MOCK_API_BASE_URL).toBeNull();
    expect(m.isBackendConfigured).toBe(false);
  });

  it('is null when VITE_BACKEND_API_URL is only whitespace', async () => {
    const m = await loadWith('   ');
    expect(m.MOCK_API_BASE_URL).toBeNull();
  });

  it('never falls back to any host — the sabotage check', async () => {
    const m = await loadWith(undefined);
    // Deliberately broad: any string at all would mean a default host is back.
    expect(m.MOCK_API_BASE_URL).not.toEqual(expect.any(String));
    expect(String(m.MOCK_API_BASE_URL)).not.toContain('mock-api-sable');
    expect(String(m.MOCK_API_BASE_URL)).not.toContain('vercel.app');
  });

  it('backendUrl() throws rather than contacting a guessed host', async () => {
    const m = await loadWith(undefined);
    expect(() => m.backendUrl('/api/connect')).toThrowError(m.BackendNotConfiguredError);
  });

  it('uses the configured value and strips trailing slashes', async () => {
    const m = await loadWith('https://backend.example.com///');
    expect(m.MOCK_API_BASE_URL).toBe('https://backend.example.com');
    expect(m.isBackendConfigured).toBe(true);
    expect(m.backendUrl('/api/connect')).toBe('https://backend.example.com/api/connect');
  });

  it('joins a path that has no leading slash', async () => {
    const m = await loadWith('https://backend.example.com');
    expect(m.backendUrl('api/connect')).toBe('https://backend.example.com/api/connect');
  });
});
