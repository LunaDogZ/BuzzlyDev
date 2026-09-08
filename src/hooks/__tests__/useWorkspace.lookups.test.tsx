import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import React from 'react';

/**
 * Two properties of `useWorkspace`, both measured problems before they were
 * tests.
 *
 * 1. It is called by 26 files, and five of them are hooks the dashboard mounts.
 *    While it was useState/useEffect, each caller ran its own fetch chain, so
 *    the page read the same workspace row five times and then repeated the
 *    cascade underneath it. The sharing test is the one that matters: it fails
 *    the moment the read leaves React Query again.
 *
 * 2. The business-type and industry lists are reference data for one form, and
 *    they used to be fetched by every caller, ahead of the workspace itself.
 *
 * The mock counts tables rather than asserting on returned values, because the
 * defect was never a wrong value — it was the number of requests.
 */

const tablesQueried: string[] = [];
/** Lets a test simulate the row changing on the server between two reads. */
let workspaceName = 'Acme';

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
      if (table === 'workspaces') return makeQuery({ id: 'ws-1', name: workspaceName, owner_id: 'alice' });
      if (table === 'business_types') return makeQuery([{ id: 'bt-1', name: 'Retail', slug: 'retail', description: '' }]);
      if (table === 'industries') return makeQuery([{ id: 'in-1', name: 'Fashion', slug: 'fashion', description: '' }]);
      return makeQuery(null);
    },
  },
}));

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: async () => ({ data: { user: { id: 'alice' } }, error: null }),
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useAwardMission', () => ({ useAwardMission: () => ({ awardMission: vi.fn() }) }));
vi.mock('@/lib/auditLogger', () => ({ auditSettings: { settingsChanged: vi.fn() } }));

const { useWorkspace } = await import('../useWorkspace');

const count = (table: string) => tablesQueried.filter((t) => t === table).length;

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);

describe('useWorkspace', () => {
  beforeEach(() => {
    tablesQueried.length = 0;
    workspaceName = 'Acme';
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it('reads the workspace once no matter how many callers there are', async () => {
    // The dashboard's shape: five hooks, one page, one workspace.
    const { result } = renderHook(
      () => {
        useWorkspace();
        useWorkspace();
        useWorkspace();
        useWorkspace();
        return useWorkspace();
      },
      { wrapper },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasTeam).toBe(true);

    expect(count('workspaces')).toBe(1);
  });

  it('does not fetch the dropdown lists for a caller that never renders them', async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(tablesQueried).toContain('workspaces');
    expect(tablesQueried).not.toContain('business_types');
    expect(tablesQueried).not.toContain('industries');
  });

  it('fetches them for a caller that asks', async () => {
    const { result } = renderHook(() => useWorkspace({ withLookups: true }), { wrapper });

    await waitFor(() => expect(result.current.businessTypes).toHaveLength(1));
    await waitFor(() => expect(result.current.industries).toHaveLength(1));
  });

  it('reads the workspace first, even when the lists were asked for', async () => {
    // The ordering is the point: reference data used to be issued in front of
    // the only read the caller was waiting on.
    const { result } = renderHook(() => useWorkspace({ withLookups: true }), { wrapper });

    await waitFor(() => expect(result.current.businessTypes).toHaveLength(1));
    expect(tablesQueried.indexOf('workspaces')).toBeLessThan(tablesQueried.indexOf('business_types'));
  });

  it('exposes the workspace as editable form state that a refetch cannot clobber', async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => expect(result.current.workspace.name).toBe('Acme'));

    // What the settings inputs do on every keystroke.
    result.current.setWorkspace({ ...result.current.workspace, name: 'Half-typed nam' });
    await waitFor(() => expect(result.current.workspace.name).toBe('Half-typed nam'));

    // A background refetch brings back a *different* name — someone saved from
    // another tab. Without the id guard this lands on top of the half-typed
    // edit; with it, only a different workspace re-seeds the form.
    workspaceName = 'Renamed elsewhere';
    await client.refetchQueries({ queryKey: ['workspace', 'current'] });
    await waitFor(() =>
      expect(client.getQueryData(['workspace', 'current'])).toMatchObject({ name: 'Renamed elsewhere' }),
    );

    expect(result.current.workspace.name).toBe('Half-typed nam');
  });
});
