-- KPI-7 round 2, A01 follow-up: remove seed_demo_insights(uuid) outright.
--
-- 20261007101000 revoked EXECUTE from PUBLIC/anon/authenticated. The function
-- itself stays a SECURITY DEFINER writer into ad_insights with no caller check
-- and no consumer: nothing in src/, supabase/functions, mock-api or airflow
-- calls it, and pg_depend lists no dependent object. It writes rows labelled
-- data_source='api' (the column default) — indistinguishable from real API
-- data — and 0 such rows exist (checked 2026-10-07), so dropping it loses
-- nothing. Rollback: evidence/report/2026-10-07-kpi7-round2/before/.

DROP FUNCTION public.seed_demo_insights(uuid);
