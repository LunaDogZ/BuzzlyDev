import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';

/**
 * `LoyaltyProvider` reloads seven tables and an RPC. It used to do that on
 * *every* auth event, and Supabase emits several per page load that say nothing
 * new: it replays the existing session the moment you subscribe, and emits
 * again on each token refresh. A local trace showed the loyalty reads three and
 * four deep for a user who never changed.
 *
 * What must still work is a real change of person, which is why the last two
 * tests exist: skipping too much would be a worse bug than the one being fixed,
 * and it would be invisible until someone signed out and still saw the previous
 * account's points.
 */

let authHandler: ((event: string, session: unknown) => void) | undefined;
let currentUser: { id: string } | null = { id: 'alice' };
let rpcCalls = 0;

const makeQuery = (result: unknown) => {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit']) q[m] = vi.fn(() => q);
  q.single = vi.fn(() => Promise.resolve({ data: result, error: null }));
  q.maybeSingle = vi.fn(() => Promise.resolve({ data: result, error: null }));
  q.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: result, error: null }).then(f);
  return q;
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => makeQuery([]),
    rpc: () => { rpcCalls += 1; return Promise.resolve({ data: null, error: null }); },
    auth: {
      getUser: () => Promise.resolve({ data: { user: currentUser }, error: null }),
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        authHandler = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
    channel: () => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() }),
    removeChannel: vi.fn(),
  },
}));

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: () => Promise.resolve({ data: { user: currentUser }, error: null }),
}));

const { useLoyaltyTier, LoyaltyProvider } = await import('../useLoyaltyTier');

const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(LoyaltyProvider, null, children);

const emit = async (event: string, userId: string | null) => {
  await act(async () => {
    authHandler?.(event, userId ? { user: { id: userId } } : null);
    await Promise.resolve();
  });
};

describe('LoyaltyProvider and auth events', () => {
  beforeEach(() => {
    authHandler = undefined;
    currentUser = { id: 'alice' };
    rpcCalls = 0;
  });

  it('loads once on mount', async () => {
    const { result } = renderHook(() => useLoyaltyTier(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(rpcCalls).toBe(1);
  });

  it('ignores the session replay that arrives on subscribe', async () => {
    const { result } = renderHook(() => useLoyaltyTier(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await emit('INITIAL_SESSION', 'alice');

    expect(rpcCalls).toBe(1);
  });

  it('ignores a token refresh', async () => {
    const { result } = renderHook(() => useLoyaltyTier(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await emit('TOKEN_REFRESHED', 'alice');

    expect(rpcCalls).toBe(1);
  });

  it('reloads when a different person signs in', async () => {
    const { result } = renderHook(() => useLoyaltyTier(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    currentUser = { id: 'bob' };
    await emit('SIGNED_IN', 'bob');

    await waitFor(() => expect(rpcCalls).toBe(2));
  });

  it('reloads on sign-out, so the previous account is cleared', async () => {
    const { result } = renderHook(() => useLoyaltyTier(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    currentUser = null;
    await emit('SIGNED_OUT', null);

    await waitFor(() => expect(result.current.userLoyalty).toBeNull());
  });
});
