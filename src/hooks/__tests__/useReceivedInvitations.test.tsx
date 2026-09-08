import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/**
 * The sidebar shows one number — how many invitations are waiting — on every
 * page. It used to read that number from `useTeamManagement`, which loads the
 * entire team-management screen: the workspace, its members, the invitations it
 * has sent, the activity log, and a profile lookup for each.
 *
 * What these tests pin is the *footprint*, because that is the whole point of
 * the hook. Asserting only "returns the invitations" would pass just as well if
 * someone re-added the member and activity-log reads tomorrow.
 */

const tablesQueried: string[] = [];

const makeQuery = (result: unknown) => {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order']) q[m] = vi.fn(() => q);
  q.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: result, error: null }).then(f);
  return q;
};

const INVITE = {
  id: 'inv-1', team_id: 'ws-1', email: 'alice@example.test', role: 'member',
  custom_permissions: null, invited_by: 'bob', status: 'pending',
  expires_at: '2026-12-01', created_at: '2026-09-01', workspaces: { name: 'Acme' },
};

let invitations: unknown[] = [INVITE];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      tablesQueried.push(table);
      if (table === 'team_invitations') return makeQuery(invitations);
      if (table === 'customer') return makeQuery([{ id: 'bob', email: 'bob@example.test', full_name: 'Bob' }]);
      return makeQuery([]);
    },
  },
}));

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: async () => ({ data: { user: { id: 'alice', email: 'alice@example.test' } }, error: null }),
}));

const { useReceivedInvitations } = await import('../useReceivedInvitations');

describe('useReceivedInvitations', () => {
  beforeEach(() => {
    tablesQueried.length = 0;
    invitations = [INVITE];
  });

  it('returns the pending invitations with the inviter resolved', async () => {
    const { result } = renderHook(() => useReceivedInvitations());

    await waitFor(() => expect(result.current.receivedInvitations).toHaveLength(1));
    expect(result.current.receivedInvitations[0].inviter?.full_name).toBe('Bob');
    expect(result.current.receivedInvitations[0].team?.name).toBe('Acme');
  });

  it('reads nothing the sidebar does not display', async () => {
    const { result } = renderHook(() => useReceivedInvitations());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(new Set(tablesQueried)).toEqual(new Set(['team_invitations', 'customer']));
    // The reads that made this expensive on every page.
    expect(tablesQueried).not.toContain('workspaces');
    expect(tablesQueried).not.toContain('workspace_members');
    expect(tablesQueried).not.toContain('team_activity_logs');
  });

  it('skips the inviter lookup when there is nothing to look up', async () => {
    invitations = [];
    const { result } = renderHook(() => useReceivedInvitations());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(tablesQueried).toEqual(['team_invitations']);
  });
});
