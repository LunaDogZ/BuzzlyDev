/**
 * One shared answer to "who is signed in?".
 *
 * `supabase.auth.getUser()` is a *network* call — it asks the auth server to
 * validate the token every time. Hooks call it inside their own queryFn, and
 * React Query starts those queryFns together, so one dashboard load fired 30 of
 * them (measured: `evidence/kpi4-lighthouse/4c13722/desktop/R2-dashboard/run-2.json`
 * — 30 requests to `/auth/v1/user` out of 126 to Supabase). They all return the
 * same user, and each one delays the query that needed it.
 *
 * This collapses the simultaneous ones: while a lookup is in flight, every other
 * caller is handed that same promise instead of opening its own request. Once it
 * resolves, the next caller asks again.
 *
 * It deliberately does NOT hold the answer for a time window. A first version
 * did, and it was wrong in a way worth recording: the cache is module state, so
 * it outlived the thing it was caching for — five test suites started failing
 * because one test's "signed out" answer was still being served to the next
 * test. Anything that survives past the burst has to be invalidated by someone,
 * and the invalidation is what goes wrong. Deduping only what overlaps in time
 * needs no invalidation at all: there is no window in which the answer can be
 * stale, because the answer only exists while the request is still open.
 *
 * Returns the same shape as `supabase.auth.getUser()`, so call sites change only
 * the function name.
 *
 * ── The local-session fast path, added 2026-09-10, and what it trades ──
 *
 * Deduping only what overlaps in time left a cost that a trace makes obvious.
 * Loading /campaigns on the deployment issued THREE `/auth/v1/user` requests, at
 * 315 ms, 1 177 ms and 1 641 ms — not concurrent, so nothing deduped them, and
 * each one gated the wave of queries behind it. Page latency here is round-trip
 * DEPTH: warm, each hop is ~0.4 s; on the cold free-tier connection each hop
 * measured 2-5 s.
 *
 * So ask storage first. `getSession()` reads the session the client already
 * holds and goes to the network only when the access token has expired, in
 * which case it refreshes. When it answers, the network call disappears
 * entirely.
 *
 * WHAT THIS GIVES UP, stated plainly: `getUser()` asks the auth server to
 * validate the token, `getSession()` does not. If a session is revoked
 * elsewhere — signed out on another device, user deleted — this helper keeps
 * reporting that user until the access token expires (up to its TTL), where
 * before it would have noticed on the next call. **No data is exposed by that
 * window**: every read still carries the same JWT and is still judged by RLS at
 * the server, so a stale or forged token returns nothing. What lingers is UI
 * state — a sidebar that still shows a name. The network path below is kept as
 * the fallback for when there is no stored session at all.
 */
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type GetUserResult = Awaited<ReturnType<typeof supabase.auth.getUser>>;

let inFlight: Promise<GetUserResult> | null = null;

/**
 * Drop-in replacement for `supabase.auth.getUser()`.
 *
 * Callers that arrive while a lookup is open share its result. Callers that
 * arrive after it settled — success or failure — start a fresh one.
 */
export async function getCurrentUser(): Promise<GetUserResult> {
  // Fast path: the session this client already holds. No network unless the
  // access token has expired, and then only to refresh it.
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    return { data: { user: session.user }, error: null } as GetUserResult;
  }

  // No stored session — ask the auth server, and share one answer with every
  // caller that arrives while that request is open.
  if (inFlight) {
    return inFlight;
  }

  inFlight = supabase.auth.getUser().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Convenience for the many call sites that only want the id. */
export async function getCurrentUserId(): Promise<string | null> {
  const { data } = await getCurrentUser();
  return data.user?.id ?? null;
}

export type { User };
