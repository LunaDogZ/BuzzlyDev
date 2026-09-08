import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * `fetchScopedAdAccountIds` is called from three queryFns that React Query
 * starts together — useDashboardMetrics, useAdDataRange, useAdSourceCounts —
 * so the same rows were read three to five times per dashboard load. The
 * request never depended on `platformId`: that filter is applied in memory.
 *
 * The last test is the one that protects a user-visible behaviour. Connecting a
 * platform writes an `ad_accounts` row, so anything retained past the burst
 * would leave the dashboard insisting the account does not exist. Sharing only
 * what overlaps is what makes that impossible, and this test fails if someone
 * upgrades the dedupe into a cache.
 */

let reads = 0;
let release: ((v: { data: unknown; error: null }) => void) | null = null;
let rows: unknown[] = [];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = vi.fn(() => q);
      q.eq = vi.fn(() => {
        reads += 1;
        return new Promise((resolve) => {
          if (release === null) resolve({ data: rows, error: null });
          else release = resolve as typeof release;
        });
      });
      return q;
    },
  },
}));

const { fetchScopedAdAccountIds } = await import('../useDashboardMetrics');

const ROWS = [
  { id: 'acc-fb', platform_id: 'facebook' },
  { id: 'acc-tt', platform_id: 'tiktok' },
];

describe('fetchScopedAdAccountIds', () => {
  beforeEach(() => {
    reads = 0;
    release = null;
    rows = ROWS;
  });

  it('reads once for callers that overlap, whatever platform each asked for', async () => {
    // Held open so all three arrive before any answer does — the real shape.
    release = (() => {}) as never;
    const pending = [
      fetchScopedAdAccountIds('ws-1', 'all'),
      fetchScopedAdAccountIds('ws-1', 'facebook'),
      fetchScopedAdAccountIds('ws-1', 'tiktok'),
    ];
    (release as unknown as (v: { data: unknown; error: null }) => void)({ data: ROWS, error: null });

    const [all, fb, tt] = await Promise.all(pending);

    expect(reads).toBe(1);
    expect(all).toEqual(['acc-fb', 'acc-tt']);
    expect(fb).toEqual(['acc-fb']);
    expect(tt).toEqual(['acc-tt']);
  });

  it('keeps workspaces apart', async () => {
    await Promise.all([
      fetchScopedAdAccountIds('ws-1', 'all'),
      fetchScopedAdAccountIds('ws-2', 'all'),
    ]);

    expect(reads).toBe(2);
  });

  it('reads again after the first call settled, so a new account is never hidden', async () => {
    expect(await fetchScopedAdAccountIds('ws-1', 'all')).toEqual(['acc-fb', 'acc-tt']);

    // What connecting a platform does.
    rows = [...ROWS, { id: 'acc-new', platform_id: 'facebook' }];

    expect(await fetchScopedAdAccountIds('ws-1', 'all')).toContain('acc-new');
    expect(reads).toBe(2);
  });
});
