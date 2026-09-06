import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Regression tests for the IP-collection removal.
 *
 * What was there: every audit event — every login and every page view — called
 * `https://api.ipify.org` and stored the answer in
 * `audit_logs_enhanced.ip_address`. It had been running on localhost too, so by
 * the time it was found the table already held ~1,041 rows with real addresses.
 * Nothing disclosed it: the app has no privacy notice, and the SUS consent
 * script read aloud to participants (evidence/kpi6-sus/protocol.md:83) lists
 * what the study collects and this is not on that list. The value was worthless
 * anyway — a browser-read IP is forgeable, and nothing here reads the column.
 *
 * These tests pin both halves of the fix, and each one can actually fail:
 * bringing the fetch back fails the first, and writing anything but `null` into
 * the column fails the second. Asserting only "no network call" would not be
 * enough — a hard-coded string would sail past it.
 */

const insert = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({ insert }),
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
  },
}));

describe('audit logging does not collect the visitor IP', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    insert.mockClear();
    // Any outbound call at all is a failure here, so the stub records rather
    // than serves: a test that let the real fetch through would pass offline
    // and fail on a machine with a network, which is worse than no test.
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('audit logging must not make network calls of its own'),
    );
  });

  afterEach(() => fetchSpy.mockRestore());

  it('makes no outbound request when logging an event', async () => {
    const { logAuditEvent } = await import('../auditLogger');
    await logAuditEvent({
      userId: 'user-1',
      actionName: 'Login',
      category: 'authentication',
      description: 'customer logged in',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('writes ip_address as null, not a value from anywhere else', async () => {
    const { logAuditEvent } = await import('../auditLogger');
    await logAuditEvent({
      userId: 'user-1',
      actionName: 'Login',
      category: 'authentication',
      description: 'customer logged in',
    });

    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0][0];
    expect(row).toHaveProperty('ip_address', null);
  });

  it('logs a page view without collecting an IP either', async () => {
    const { logPageView } = await import('../auditLogger');
    await logPageView('/dashboard');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(insert.mock.calls[0][0].ip_address).toBeNull();
  });

  it('offers no parameter a caller could use to supply an IP', async () => {
    const { logAuditEvent } = await import('../auditLogger');
    // `ipAddress` was a documented field on AuditEventParams. It is gone, so a
    // caller passing one has it dropped rather than written — the guarantee is
    // structural, not a convention someone has to remember.
    await logAuditEvent({
      userId: 'user-1',
      actionName: 'Login',
      category: 'authentication',
      description: 'customer logged in',
      ...({ ipAddress: '203.0.113.9' } as Record<string, unknown>),
    });

    const row = insert.mock.calls[0][0];
    expect(row.ip_address).toBeNull();
    expect(JSON.stringify(row)).not.toContain('203.0.113.9');
  });
});
