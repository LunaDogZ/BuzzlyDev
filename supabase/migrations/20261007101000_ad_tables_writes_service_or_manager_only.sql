-- KPI-7 round 2, A01: intra-workspace write access on ad_insights / ad_accounts.
--
-- Before: every INSERT/UPDATE policy on these two tables required only
-- membership, so a 'viewer' could write through PostgREST. "Viewer can only
-- view" was enforced in the frontend alone. Permissive policies OR together,
-- so each member-level write policy is DROPPED — a stricter policy added beside
-- them would change nothing.
--
-- ad_insights: no replacement. No client path writes this table; meta-sync
--   (Edge Function) and Airflow promote_batch write it with service_role,
--   which bypasses RLS. Kept: DELETE (can_manage_team), staff ALL policy,
--   SELECT.
-- ad_accounts: INSERT/UPDATE require can_manage_team — the same predicate
--   meta-oauth checks before it connects a platform. Kept: DELETE, the staff
--   UPDATE policy, SELECT.
--
-- seed_demo_insights(uuid) is SECURITY DEFINER with no caller check and was
-- executable by anon: anyone holding the public anon key could insert 30 rows
-- of random spend into any ad account with fewer than 5 insight rows. Nothing
-- calls it. EXECUTE is revoked; the function is kept.
--
-- ⚠️ REVOKE + anon: on supabase/postgres 17.6.1.106 a "permission denied for
-- function" raised for anon segfaults the backend (see
-- 20260811100000_rls_helpers_stable_and_caller_scoped.sql). The cloud project
-- runs 17.6.1.084, which was re-tested on 2026-10-07 and raises the error
-- cleanly. Re-check before any image upgrade to .106.

-- ad_insights ------------------------------------------------------------------
DROP POLICY "Team members can insert ad insights" ON public.ad_insights;
DROP POLICY "team_member_insert"                  ON public.ad_insights;
DROP POLICY "team_member_update"                  ON public.ad_insights;

-- ad_accounts ------------------------------------------------------------------
DROP POLICY "Team members can insert ad accounts" ON public.ad_accounts;
DROP POLICY "Team members can insert ad_accounts" ON public.ad_accounts;
DROP POLICY "team_member_insert"                  ON public.ad_accounts;
DROP POLICY "Team members can update ad_accounts" ON public.ad_accounts;
DROP POLICY "team_member_update"                  ON public.ad_accounts;

CREATE POLICY "team_manager_insert" ON public.ad_accounts
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_team((SELECT auth.uid()), team_id));

CREATE POLICY "team_manager_update" ON public.ad_accounts
  FOR UPDATE TO authenticated
  USING      (public.can_manage_team((SELECT auth.uid()), team_id))
  WITH CHECK (public.can_manage_team((SELECT auth.uid()), team_id));

-- seed_demo_insights -----------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.seed_demo_insights(uuid) FROM PUBLIC, anon, authenticated;
