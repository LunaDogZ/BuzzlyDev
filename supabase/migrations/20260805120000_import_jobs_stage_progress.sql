-- ============================================================
-- Migration: per-stage progress for file imports (Phase 1, step 8)
-- Date: 2026-08-05
-- Description:
--   `status` answers "is it done?" but not "what is it doing?". A merchant
--   watching a 3,458-row Shopee report sees `running` for two minutes with no
--   way to tell work from a hang, and support debugging a stuck job has to open
--   the Airflow UI to find out which task it stopped in.
--
--   The DAG runs one stage per task precisely so each boundary is observable;
--   these two columns publish that same boundary to the people who cannot see
--   Airflow. On a terminal job the last value also survives as "where it got
--   to" — a `failed` job that reads `validate` is a data problem, one that
--   reads `verify_artifact` is a storage problem.
--
-- Write model unchanged: service_role (Airflow) writes, team members read
-- through the existing import_jobs_select policy. No new policies needed.
-- ============================================================

ALTER TABLE public.import_jobs
  ADD COLUMN IF NOT EXISTS current_stage TEXT,
  ADD COLUMN IF NOT EXISTS stage_updated_at TIMESTAMPTZ;

-- Deliberately NO check constraint on current_stage. The stage names live in
-- buzzly_common.pipeline.PROGRESS_STAGES, and a rename there landing before a
-- migration here would turn every PATCH into a 400 — failing real imports over
-- a label. The writer (SupabaseClient.set_stage) swallows its own errors for
-- the same reason: progress reporting must never be able to break ingestion.
COMMENT ON COLUMN public.import_jobs.current_stage IS
  'Pipeline stage the Airflow DAG is in, or the last one reached on a terminal job. Mirrors buzzly_common.pipeline.PROGRESS_STAGES; intentionally unconstrained.';

COMMENT ON COLUMN public.import_jobs.stage_updated_at IS
  'When current_stage last changed. A running job whose stage has not moved in minutes is stuck, which status alone cannot show.';
