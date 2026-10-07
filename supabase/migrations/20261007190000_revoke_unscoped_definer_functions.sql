-- KPI-7 round 3, A01: SECURITY DEFINER functions that anon and authenticated
-- could EXECUTE through PostgREST (/rest/v1/rpc/...) with no caller check.
--
-- Every function here runs as its owner (postgres), so it bypasses RLS, and
-- nothing in the frontend, the Edge Functions, Airflow or mock-api calls it as
-- anon or authenticated (grep of rpc names, 2026-10-07; full sweep in
-- evidence/report/2026-10-07-kpi7-round3/FUNCTIONS.md). EXECUTE stays with the
-- owner (postgres) and service_role, so a pg_cron job running as postgres, or
-- another SECURITY DEFINER function owned by postgres, still calls them.
--
--   process_scheduled_reports_with_preferences()  every workspace's due reports:
--       returns recipient emails + user ids, advances next_run_at
--   auto_stop_completed_campaigns()               completes campaigns / pauses
--       ads in every workspace
--   create_weekly_digest_notifications()          inserts a notification for every
--       member of every workspace
--   debug_dashboard_visibility()                  global counts + latest insights
--       with account names and team ids
--   get_team_role(uuid, uuid)                     any user's role in any workspace
--   get_employee_role(uuid)                       any user's staff role
--   get_notification_preferences(uuid)            any user's notification settings
--       (callers: create_weekly_digest_notifications, fn_notify_budget_alert,
--       process_scheduled_reports_with_preferences — all DEFINER, owner postgres)
--   increment_discount_usage(uuid)                bumps any discount's usage_count
--       (can exhaust a coupon's usage_limit)
--   log_signup_trigger_error(text, uuid, text, text)  inserts arbitrary error_logs
--       rows (caller: handle_new_user, DEFINER, owner postgres)
--
-- REVOKE FROM PUBLIC alone is not enough here: Supabase's default privileges
-- grant EXECUTE to anon and authenticated by name, which is why
-- log_signup_trigger_error is still anon-executable after
-- 20260906090000 revoked it from PUBLIC.
--
-- ⚠️ REVOKE + anon: on supabase/postgres 17.6.1.106 an anon "permission denied
-- for function" segfaults the backend. The cloud runs 17.6.1.084, which raises
-- 42501 cleanly (re-tested 2026-10-07 on a local .084 replica with these exact
-- statements). Re-check before any image upgrade to .106.

REVOKE EXECUTE ON FUNCTION public.process_scheduled_reports_with_preferences() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_stop_completed_campaigns()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_weekly_digest_notifications()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.debug_dashboard_visibility()                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_team_role(uuid, uuid)                    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_employee_role(uuid)                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_notification_preferences(uuid)           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_discount_usage(uuid)               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_signup_trigger_error(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
