-- ROLLBACK for 20261007190000_revoke_unscoped_definer_functions.sql
--
-- NOT a migration. Restores EXECUTE exactly as read live from pg_proc.proacl on
-- 2026-10-07 before the push (before/functions-live.json): PUBLIC, anon and
-- authenticated held EXECUTE on eight of the nine; log_signup_trigger_error had
-- anon and authenticated but not PUBLIC (revoked by 20260906090000). Running it
-- reopens every finding the migration closed.

BEGIN;
GRANT EXECUTE ON FUNCTION public.process_scheduled_reports_with_preferences() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_stop_completed_campaigns()              TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_weekly_digest_notifications()         TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debug_dashboard_visibility()                 TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_role(uuid, uuid)                    TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_employee_role(uuid)                      TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_notification_preferences(uuid)           TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_discount_usage(uuid)               TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_signup_trigger_error(text, uuid, text, text) TO anon, authenticated;
COMMIT;
