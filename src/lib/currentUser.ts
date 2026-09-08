/**
 * One shared answer to "who is signed in?" for callers that ask at the same time.
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
