import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/**
 * The business-type and industry lists are reference data for one form. They
 * were being fetched by every caller of `useWorkspace`, and fetched *before*
 * the workspace itself. A dashboard load paid for each list five times, because
 * five of its hooks call this one, and none of those five renders a dropdown
 * (evidence/kpi4-lighthouse/4c13722/desktop/R2-dashboard/run-2.json — five
 * `business_types` and five `industries` requests out of 126 to Supabase).
 *
 * These tests pin both directions, so neither can rot unnoticed: a default that
 * starts fetching again fails the first, and an opt-in that stops working fails
 * the second. The third is the one that matters to the page: the workspace read
 * must not sit behind reference data.
 */

const tablesQueried: string[] = [];

const makeQuery = (result: unknown) => {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit']) q[m] = vi.fn(() => q);
  q.maybeSingle = vi.fn(() => Promise.resolve({ data: result, error: null }));
  q.single = vi.fn(() => Promise.resolve({ data: result, error: null }));
  q.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: result, error: null }).then(f);
  return q;
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      tablesQueried.push(table);
      if (table === 'workspaces') return makeQuery({ id: 'ws-1', name: 'Acme', owner_id: 'alice' });
      if (table === 'business_types') return makeQuery([{ id: 'bt-1', name: 'Retail', slug: 'retail', description: '' }]);
      if (table === 'industries') return makeQuery([{ id: 'in-1', name: 'Fashion', slug: 'fashion', description: '' }]);
      return makeQuery(null);
    },
  },
}));

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: async () => ({ data: { user: { id: 'alice' } }, error: null }),
}));

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useAwardMission', () => ({ useAwardMission: () => ({ awardMission: vi.fn() }) }));
vi.mock('@/lib/auditLogger', () => ({ auditSettings: { workspaceUpdated: vi.fn() } }));

const { useWorkspace } = await import('../useWorkspace');

describe('useWorkspace reference data', () => {
  beforeEach(() => {
    tablesQueried.length = 0;
  });

  it('does not fetch the dropdown lists for a caller that never renders them', async () => {
    const { result } = renderHook(() => useWorkspace());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(tablesQueried).toContain('workspaces');
    expect(tablesQueried).not.toContain('business_types');
    expect(tablesQueried).not.toContain('industries');
  });

  it('fetches them for a caller that asks', async () => {
    const { result } = renderHook(() => useWorkspace({ withLookups: true }));

    await waitFor(() => expect(result.current.businessTypes).toHaveLength(1));
    await waitFor(() => expect(result.current.industries).toHaveLength(1));

    expect(tablesQueried).toContain('business_types');
    expect(tablesQueried).toContain('industries');
  });

  it('reads the workspace first, even when the lists were asked for', async () => {
    // The ordering is the point: reference data used to be awaited in front of
    // the only read the caller was waiting on.
    renderHook(() => useWorkspace({ withLookups: true }));

    await waitFor(() => expect(tablesQueried).toContain('workspaces'));
    expect(tablesQueried.indexOf('workspaces')).toBeLessThan(tablesQueried.indexOf('business_types'));
  });
});
