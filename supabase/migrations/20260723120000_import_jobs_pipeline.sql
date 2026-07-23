-- ============================================================
-- Migration: Airflow file-import pipeline (Phase 1, step 1)
-- Date: 2026-07-23
-- Description:
--   Backing schema for the .csv/.xlsx fallback ingestion path used
--   when a merchant cannot connect a platform API. A merchant uploads
--   a report file -> Storage, a job row is created, and an Airflow DAG
--   parses / cleans / validates / upserts it.
--
--   1. import_jobs        — one row per uploaded file, tracks DAG lifecycle
--   2. import_row_errors  — quarantined rows (one row per rejected input row)
--   3. `imports` private Storage bucket + workspace-scoped policies
--   4. Unique index on ad_insights so DAG upserts are idempotent
--
-- Naming note: the workspace FK is `team_id` (NOT `workspace_id`) to match
-- ad_accounts / reports / sync_history / workspace_api_keys, so the existing
-- public.is_team_member() / public.can_manage_team() helpers apply directly.
--
-- Write model: clients INSERT jobs and SELECT progress. All state
-- transitions (pending -> running -> succeeded/partial/failed) and every
-- write to import_row_errors are performed by Airflow via service_role,
-- which bypasses RLS — hence no UPDATE policy for `authenticated`.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Helper: cast text to uuid without raising on bad input.
--    Storage policies read the first path segment as the team id;
--    a malformed path must fail the policy, not error the request.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_cast_uuid(_text text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN _text::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.try_cast_uuid(text) TO authenticated, service_role, anon;

-- ------------------------------------------------------------
-- 1. import_jobs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Which merchant export this file is. Drives the DAG's parser + target.
  platform TEXT NOT NULL CHECK (platform IN (
    'meta', 'tiktok', 'shopee_income', 'shopee_ads', 'cogs', 'generic'
  )),

  -- Object path inside the private `imports` bucket: {team_id}/{job_id}/{filename}
  storage_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_hash TEXT,          -- sha256 hex of the uploaded bytes (DAG dedupe stage)
  file_size_bytes BIGINT,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',    -- row created, file in Storage, DAG not triggered yet
    'queued',     -- DAG run created, not started
    'running',    -- DAG executing
    'partial',    -- finished, but some rows were quarantined
    'succeeded',
    'failed',
    'cancelled'
  )),

  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_ok INTEGER NOT NULL DEFAULT 0,
  rows_quarantined INTEGER NOT NULL DEFAULT 0,

  error_report_path TEXT,  -- downloadable CSV of quarantined rows, in the same bucket
  error_message TEXT,
  dag_run_id TEXT,

  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;

-- SELECT: team members can watch their workspace's imports
CREATE POLICY "import_jobs_select"
  ON public.import_jobs
  FOR SELECT TO authenticated
  USING (public.is_team_member(auth.uid(), team_id));

-- INSERT: team members can start an import, only as themselves
CREATE POLICY "import_jobs_insert"
  ON public.import_jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_team_member(auth.uid(), team_id)
    AND uploaded_by = auth.uid()
  );

-- DELETE: only workspace managers can remove import history
CREATE POLICY "import_jobs_delete"
  ON public.import_jobs
  FOR DELETE TO authenticated
  USING (public.can_manage_team(auth.uid(), team_id));

CREATE INDEX IF NOT EXISTS idx_import_jobs_team_created
  ON public.import_jobs(team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_jobs_status
  ON public.import_jobs(status) WHERE status IN ('pending', 'queued', 'running');
CREATE INDEX IF NOT EXISTS idx_import_jobs_file_hash
  ON public.import_jobs(team_id, file_hash);

CREATE TRIGGER update_import_jobs_updated_at
  BEFORE UPDATE ON public.import_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.import_jobs IS
  'One uploaded merchant report file (.csv/.xlsx) and its Airflow ingestion lifecycle. Status transitions are written by Airflow via service_role.';

-- ------------------------------------------------------------
-- 2. import_row_errors (quarantine)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_row_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_job_id UUID NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,          -- 1-based line number in the source file
  raw_row JSONB,                        -- the offending row exactly as parsed
  column_name TEXT,                     -- offending column, when attributable
  error_code TEXT NOT NULL,             -- machine-readable, e.g. 'invalid_date'
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.import_row_errors ENABLE ROW LEVEL SECURITY;

-- SELECT only, scoped through the parent job's workspace.
-- Writes are service_role (Airflow) exclusively.
CREATE POLICY "import_row_errors_select"
  ON public.import_row_errors
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.import_jobs j
      WHERE j.id = import_row_errors.import_job_id
        AND public.is_team_member(auth.uid(), j.team_id)
    )
  );

CREATE INDEX IF NOT EXISTS idx_import_row_errors_job
  ON public.import_row_errors(import_job_id, row_number);

COMMENT ON TABLE public.import_row_errors IS
  'Quarantined input rows rejected during validation. A job with rows here finishes as status=partial.';

-- ------------------------------------------------------------
-- 3. Private `imports` Storage bucket
--    Path convention: {team_id}/{import_job_id}/{filename}
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'imports',
  'imports',
  false,      -- PRIVATE: merchant financial data, signed URLs only
  52428800,   -- 50 MB
  ARRAY[
    'text/csv',
    'text/plain',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'  -- some browsers send this for .xlsx
  ]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "imports_insert_policy" ON storage.objects;
CREATE POLICY "imports_insert_policy"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'imports'
    AND public.is_team_member(
      auth.uid(),
      public.try_cast_uuid((storage.foldername(name))[1])
    )
  );

DROP POLICY IF EXISTS "imports_select_policy" ON storage.objects;
CREATE POLICY "imports_select_policy"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'imports'
    AND public.is_team_member(
      auth.uid(),
      public.try_cast_uuid((storage.foldername(name))[1])
    )
  );

DROP POLICY IF EXISTS "imports_delete_policy" ON storage.objects;
CREATE POLICY "imports_delete_policy"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'imports'
    AND public.can_manage_team(
      auth.uid(),
      public.try_cast_uuid((storage.foldername(name))[1])
    )
  );

-- No UPDATE policy: uploads are immutable. Re-importing means a new job.

-- ------------------------------------------------------------
-- 4. Idempotent upsert target for ad data
--    ad_insights previously had only a surrogate PK, so re-running a DAG
--    duplicated rows. NULLS NOT DISTINCT (PG15+) makes rows with a NULL
--    ads_id collide too, instead of silently inserting duplicates.
--    Verified 2026-07-23: 0 existing duplicates on this key.
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS ad_insights_account_ad_date_key
  ON public.ad_insights (ad_account_id, ads_id, date) NULLS NOT DISTINCT;

COMMENT ON INDEX public.ad_insights_account_ad_date_key IS
  'Idempotency key for ingestion (Airflow file imports and mock-api API sync): ON CONFLICT (ad_account_id, ads_id, date) DO UPDATE.';
