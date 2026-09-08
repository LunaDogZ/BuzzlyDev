import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

/**
 * Six hooks each carried their own copy of "which workspace am I in?" —
 * useScheduledReports, useTags, useBudgets, useReports, useWorkspaceMembers and
 * useTeamPermissions — so a dashboard load asked the question once per hook.
 *
 * The copies had drifted apart, which is the more interesting half. Three of
 * them matched a `workspace_members` row without looking at `status`, so a
 * suspended member still resolved to a workspace there while the other three
 * required `status = 'active'`. Unifying them is a behaviour change, and the
 * third test is what states which way it went and keeps it from drifting back.
 */

const calls: { table: string; filters: Record<string, unknown> }[] = [];

let ownedWorkspace: unknown = null;
let membership: unknown = null;

const makeQuery = (table: string, result: () => unknown) => {
  const filters: Record<string, unknown> = {};
  const q: Record<string, unknown> = {};
  q.select = vi.fn(() => q);
  q.eq = vi.fn((col: string, val: unknown) => { filters[col] = val; return q; });
  q.order = vi.fn(() => q);
  q.maybeSingle = vi.fn(() => {
    calls.push({ table, filters: { ...filters } });
    return Promise.resolve({ data: result(), error: null });
  });
  return q;
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'workspaces') return makeQuery(table, () => ownedWorkspace);
      if (table === 'workspace_members') return makeQuery(table, () => membership);
      return makeQuery(table, () => null);
    },
  },
}));

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: async () => ({ data: { user: { id: 'alice' } }, error: null }),
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useAwardMission', () => ({ useAwardMission: () => ({ awardMission: vi.fn() }) }));
vi.mock('@/lib/auditLogger', () => ({ auditSettings: { settingsChanged: vi.fn() } }));

const { fetchCurrentWorkspaceId, fetchCurrentWorkspaceContext } = await import('../useWorkspace');

const OWNED = { id: 'ws-owned', name: 'Acme', owner_id: 'alice' };
const MEMBER_OF = { team_id: 'ws-member', workspaces: { id: 'ws-member', name: 'Other' } };

let client: QueryClient;

describe('the shared workspace resolver', () => {
  beforeEach(() => {
    calls.length = 0;
    ownedWorkspace = null;
    membership = null;
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it('answers many callers with one read', async () => {
    ownedWorkspace = OWNED;

    const ids = await Promise.all(
      Array.from({ length: 6 }, () => fetchCurrentWorkspaceId(client)),
    );

    expect(ids).toEqual(Array(6).fill('ws-owned'));
    expect(calls.filter((c) => c.table === 'workspaces')).toHaveLength(1);
  });

  it('serves a later caller from the cache rather than reading again', async () => {
    ownedWorkspace = OWNED;

    expect(await fetchCurrentWorkspaceId(client)).toBe('ws-owned');
    expect(await fetchCurrentWorkspaceId(client)).toBe('ws-owned');

    expect(calls.filter((c) => c.table === 'workspaces')).toHaveLength(1);
  });

  it('requires membership to be active — the behaviour three hooks did not have', async () => {
    ownedWorkspace = null;
    membership = MEMBER_OF;

    expect(await fetchCurrentWorkspaceId(client)).toBe('ws-member');

    const memberRead = calls.find((c) => c.table === 'workspace_members');
    expect(memberRead?.filters).toMatchObject({ user_id: 'alice', status: 'active' });
  });

  it('says whether the workspace is owned, so permission checks need no extra read', async () => {
    ownedWorkspace = OWNED;
    expect(await fetchCurrentWorkspaceContext(client)).toMatchObject({ isOwner: true });

    calls.length = 0;
    const memberClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    ownedWorkspace = null;
    membership = MEMBER_OF;
    expect(await fetchCurrentWorkspaceContext(memberClient)).toMatchObject({ isOwner: false });
  });

  it('reports no workspace rather than throwing when the user has none', async () => {
    expect(await fetchCurrentWorkspaceId(client)).toBeNull();
  });
});
