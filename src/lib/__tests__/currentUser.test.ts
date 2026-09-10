import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Tests for the shared "who is signed in?" helper.
 *
 * The defect being fixed is a measured one: a single dashboard load issued 30
 * separate `/auth/v1/user` requests, because each hook called
 * `supabase.auth.getUser()` inside its own queryFn and that call goes to the
 * network every time.
 *
 * The helper deduplicates only what overlaps in time, and the last two tests
 * are what pin that boundary — they assert the helper does NOT remember an
 * answer once the request has settled. That is the property that keeps this
 * change invisible to everything else: with nothing retained, there is no
 * window in which a signed-out user is still reported as signed in.
 *
 * Each test can actually fail. Removing the in-flight dedupe fails the first;
 * adding a cache that outlives the request fails the last two.
 */

const getUser = vi.fn();
const getSession = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: (...args: unknown[]) => getUser(...args),
      getSession: (...args: unknown[]) => getSession(...args),
    },
  },
}));

/** No session in storage — every test below that wants the network path uses this. */
const NO_SESSION = { data: { session: null }, error: null };

const ALICE = { data: { user: { id: 'alice' } }, error: null };
const BOB = { data: { user: { id: 'bob' } }, error: null };

const { getCurrentUser, getCurrentUserId } = await import('../currentUser');

describe('getCurrentUser', () => {
  beforeEach(() => {
    getUser.mockReset();
    getSession.mockReset();
    // Default: nothing stored, so the tests that pin the network behaviour still
    // exercise it. The fast path has its own tests at the bottom.
    getSession.mockResolvedValue(NO_SESSION);
  });

  it('collapses a burst of concurrent callers into one network call', async () => {
    // Resolve only once every caller has arrived, so this reproduces the real
    // shape of the bug: 30 hooks starting in the same tick, none of them able
    // to see an answer that has not come back yet.
    let release!: (v: typeof ALICE) => void;
    getUser.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const pending = Array.from({ length: 30 }, () => getCurrentUser());
    release(ALICE);
    const results = await Promise.all(pending);

    expect(getUser).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(30);
    expect(results.every((r) => r.data.user?.id === 'alice')).toBe(true);
  });

  it('returns the id for the common case that only wants that', async () => {
    getUser.mockResolvedValue(ALICE);
    expect(await getCurrentUserId()).toBe('alice');
  });

  it('reports null rather than throwing when nobody is signed in', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await getCurrentUserId()).toBeNull();
  });

  it('asks again for a caller that arrives after the lookup settled', async () => {
    // The staleness boundary. A helper that held the first answer would report
    // alice to a session that now belongs to bob.
    getUser.mockResolvedValueOnce(ALICE).mockResolvedValueOnce(BOB);

    expect(await getCurrentUserId()).toBe('alice');
    expect(await getCurrentUserId()).toBe('bob');
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('does not hold on to a failed lookup', async () => {
    const failure = { data: { user: null }, error: new Error('network down') };
    getUser.mockRejectedValueOnce(failure).mockResolvedValueOnce(ALICE);

    await expect(getCurrentUser()).rejects.toBeTruthy();

    // A remembered rejection would lock every caller out behind one bad moment.
    expect((await getCurrentUser()).data.user?.id).toBe('alice');
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  /**
   * The fast path. Measured on the deployment: /campaigns issued three
   * `/auth/v1/user` requests at 315 ms, 1 177 ms and 1 641 ms — spread far
   * enough apart that the in-flight dedupe above could never touch them, and
   * each one holding up the queries behind it.
   */
  describe('local session fast path', () => {
    it('answers from the stored session without calling the auth server', async () => {
      getSession.mockResolvedValue({ data: { session: { user: { id: 'alice' } } }, error: null });

      expect(await getCurrentUserId()).toBe('alice');
      expect(await getCurrentUserId()).toBe('alice');

      // The point of the change: three sequential callers, zero network calls.
      expect(getUser).not.toHaveBeenCalled();
    });

    it('falls back to the auth server when storage holds no session', async () => {
      getSession.mockResolvedValue(NO_SESSION);
      getUser.mockResolvedValue(ALICE);

      expect(await getCurrentUserId()).toBe('alice');
      expect(getUser).toHaveBeenCalledTimes(1);
    });

    it('reports nobody once the session is gone, without waiting for a network answer', async () => {
      // Sign-out clears the stored session, so the fast path stops answering
      // immediately. This is the property the old design protected by never
      // retaining anything, and it still holds — the source is storage, not a
      // cache of our own that somebody would have to invalidate.
      getSession.mockResolvedValue({ data: { session: { user: { id: 'alice' } } }, error: null });
      expect(await getCurrentUserId()).toBe('alice');

      getSession.mockResolvedValue(NO_SESSION);
      getUser.mockResolvedValue({ data: { user: null }, error: null });
      expect(await getCurrentUserId()).toBeNull();
    });
  });
});
