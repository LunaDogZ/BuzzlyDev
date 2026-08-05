-- ============================================================
-- Migration: make the "one DLQ row per job" rule usable as an upsert target
-- Date: 2026-08-05
-- Description:
--   20260805150000 enforced the rule with a PARTIAL unique index:
--
--     CREATE UNIQUE INDEX ingestion_dlq_job_key
--       ON public.ingestion_dlq(import_job_id) WHERE import_job_id IS NOT NULL;
--
--   It enforces correctly, and every insert against it behaved. What it cannot
--   do is serve as an ON CONFLICT target: PostgreSQL will not infer a partial
--   index unless the statement carries a matching predicate, and PostgREST
--   emits none. So `POST /ingestion_dlq?on_conflict=import_job_id` failed with
--
--     42P10  there is no unique or exclusion constraint matching the
--            ON CONFLICT specification
--
--   which the pipeline never reported, because a DLQ write is deliberately not
--   allowed to fail an import. The symptom was silence: refused files finished
--   exactly as they should for the merchant, and the engineers' queue stayed
--   empty. Caught by the first live run against cloud; no unit test could have
--   seen it, and neither could the local migration suite, which exercised the
--   index through plain INSERTs rather than through PostgREST's upsert.
--
--   A plain UNIQUE constraint is both enforceable and inferrable. It is also
--   still the right rule: NULLs are distinct by default, so the orphaned
--   records left by ON DELETE SET NULL are unaffected, while a job that still
--   exists can have exactly one record — which is what the DLQ recall KPI
--   measures.
-- ============================================================

DROP INDEX IF EXISTS public.ingestion_dlq_job_key;

ALTER TABLE public.ingestion_dlq
  ADD CONSTRAINT ingestion_dlq_import_job_id_key UNIQUE (import_job_id);

COMMENT ON CONSTRAINT ingestion_dlq_import_job_id_key ON public.ingestion_dlq IS
  'One dead-letter record per import job. Also the ON CONFLICT target the pipeline upserts against, so a retried task rewrites its own record instead of failing and losing the diagnosis.';
