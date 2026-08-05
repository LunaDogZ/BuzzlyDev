-- ============================================================
-- Migration: atomic per-file ingestion + the ingestion dead-letter queue
-- Date: 2026-08-05
-- Description:
--   Turns a file import from six chained PostgREST upserts — each its own
--   transaction, so a fault halfway through left half a file in production —
--   into ONE commit boundary, and gives every refused file a machine-readable
--   record of why.
--
--     1. ingestion_staging   — the row buffer a run fills before committing
--     2. ingestion_batches   — which batches have been promoted (idempotency)
--     3. ingestion_dlq       — one row per file the pipeline would not commit
--     4. promote_batch()     — staging -> production, all of it or none of it
--     5. discard_staging_batch() — drop a batch's buffer after a refusal
--
-- Why staging + one RPC rather than a direct Postgres connection:
--   the pooler route needs a database password this deployment does not have,
--   and `db.<ref>.supabase.co` resolves AAAA-only (no IPv6 route from the
--   Airflow bridge network). PostgREST is the path that has run for months, and
--   "one HTTP request is one transaction" is not a limitation here — it is
--   exactly the guarantee atomicity needs. The staging inserts are deliberately
--   NOT atomic: staging is not production, and rows left there are garbage
--   keyed by a batch id that never promoted.
--
-- Where validation lives: still Python. `buzzly_common.validate` + `.thai` +
--   `.mapping` are the measured research artifact and are unit-tested with no
--   database at all. Everything below does merge and dedupe ONLY. Nothing here
--   decides whether a row is good.
--
-- Write model, unchanged from 20260723120000: service_role owns all of this.
--   None of the three tables carries a policy for `authenticated`, so with RLS
--   enabled a merchant's client sees nothing — see the note on ingestion_dlq.
-- ============================================================

-- ------------------------------------------------------------
-- 1. ingestion_staging — where a file waits to be committed
--
-- One row per row-to-be-written, tagged with the table it belongs in. Bulk
-- inserts here are chunked over several requests and are expected to be
-- partial if a run dies mid-upload; nothing reads staging except promote_batch,
-- and it only ever reads one batch id.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ingestion_staging (
  batch_id UUID NOT NULL,
  -- Which target this row is for. Not a FK to anything — `campaign_windows` is
  -- a pseudo-target (a widening instruction, not a row), and constraining this
  -- to real table names would block that without buying any safety: only
  -- promote_batch reads the column, and it names the targets it handles.
  target_table TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (batch_id, target_table, row_index)
);

ALTER TABLE public.ingestion_staging ENABLE ROW LEVEL SECURITY;
-- No policies, on purpose: service_role bypasses RLS, everyone else is denied.

COMMENT ON TABLE public.ingestion_staging IS
  'Row buffer for one import batch. Written non-atomically over several requests, read only by promote_batch(). Rows for a batch that never promoted are garbage, not data.';

-- ------------------------------------------------------------
-- 2. ingestion_batches — the promotion ledger
--
-- A batch id is derived from the import job id, so an Airflow retry of the
-- promote task computes the same id and finds this row instead of writing the
-- file a second time. That is what makes "re-run the whole fixture set and the
-- counts do not move" a property of the pipeline rather than of the upserts.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ingestion_batches (
  batch_id UUID PRIMARY KEY,
  import_job_id UUID NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rows_promoted INTEGER NOT NULL DEFAULT 0,
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  promoted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ingestion_batches ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ingestion_batches_job
  ON public.ingestion_batches(import_job_id);

COMMENT ON TABLE public.ingestion_batches IS
  'One row per batch that reached production. Its presence is the idempotency check: promote_batch() returns early rather than writing a file twice.';

-- ------------------------------------------------------------
-- 3. ingestion_dlq — the engineer's ledger of refused files
--
-- NOT what the merchant sees. `import_jobs.status` + `import_row_errors` are
-- the merchant's view and stay exactly as they were; this table exists so an
-- engineer (and the KPI harness) can ask "which files did we refuse, and for
-- which reason" without reading Airflow logs. The two views disagree on
-- purpose in one case: a duplicate upload writes a DUPLICATE_BATCH row here
-- while the merchant is told, correctly, that the file is already imported. A
-- duplicate is a successful no-op, not a failure.
--
-- No policy for `authenticated` — deliberately service_role-only. Merchant
-- exports carry order and revenue data, and the failure detail here can quote
-- offending values; there is no reason for a browser to hold it.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ingestion_dlq (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SET NULL, not CASCADE: the point of a dead-letter queue is that the record
  -- of a refusal outlives the thing that was refused. A merchant deleting an
  -- import from their history must not erase the engineering evidence, so the
  -- identifying details below are denormalised rather than joined.
  import_job_id UUID REFERENCES public.import_jobs(id) ON DELETE SET NULL,
  team_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  batch_id UUID,

  original_filename TEXT,
  file_hash TEXT,
  platform TEXT,

  -- Seven codes. The first six come from the sprint brief; ROW_VALIDATION_FAILED
  -- is the seventh and was added because none of the six means "the rows were
  -- read perfectly and broke the validation rules". Filing a negative spend or a
  -- clicks-exceed-impressions row under TYPE_COERCION_FAILED would be a lying
  -- diagnostic, and the KPI that matters is error-code *accuracy*, not merely
  -- landing in the queue.
  error_code TEXT NOT NULL CHECK (error_code IN (
    'SCHEMA_MISMATCH',        -- headers did not map to a dataset we can store
    'TYPE_COERCION_FAILED',   -- a cell could not be turned into its type
    'ENCODING_ERROR',         -- the bytes could not be decoded as text
    'EMPTY_PAYLOAD',          -- nothing to ingest: 0 bytes, or 0 data rows
    'DUPLICATE_BATCH',        -- these exact bytes were already imported
    'ROW_VALIDATION_FAILED',  -- rows parsed, then failed the validation rules
    'UNKNOWN'                 -- unclassified; a non-zero count here is a defect
  )),
  error_message TEXT,
  -- Which pipeline stage refused it. Same vocabulary as import_jobs.current_stage.
  stage TEXT,

  rows_attempted INTEGER NOT NULL DEFAULT 0,
  rows_rejected INTEGER NOT NULL DEFAULT 0,
  -- Structured diagnosis: per-reason counts, the first few offending rows.
  -- Never the file itself — the upload is still in Storage.
  detail JSONB,

  dag_run_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ingestion_dlq ENABLE ROW LEVEL SECURITY;

-- Exactly one DLQ row per job, enforced here rather than in Python.
-- "Every broken file produces exactly one DLQ record" is a graded KPI, and a
-- constraint the database holds is evidence; a convention the caller follows is
-- not. Writers upsert on this key, so a retried task rewrites its own row.
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_dlq_job_key
  ON public.ingestion_dlq(import_job_id) WHERE import_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ingestion_dlq_code_time
  ON public.ingestion_dlq(error_code, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_dlq_team_time
  ON public.ingestion_dlq(team_id, occurred_at DESC);

COMMENT ON TABLE public.ingestion_dlq IS
  'Dead-letter queue: one row per file the pipeline refused to commit, with the reason. Engineering/diagnostic view, service_role only — the merchant-facing view is import_jobs.status + import_row_errors.';

-- ------------------------------------------------------------
-- 4. promote_batch — the commit boundary
--
-- Everything this function writes commits together or not at all, because a
-- function body is one statement and PostgREST maps one request to one
-- transaction. That is the whole design: Python decides what is valid, this
-- decides nothing, and the file lands in one step.
--
-- SECURITY INVOKER (the default) on purpose. The only grantee is service_role,
-- which already bypasses RLS, so SECURITY DEFINER would add an escalation path
-- and buy nothing.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_batch(
  p_batch_id UUID,
  p_import_job_id UUID,
  p_team_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.ingestion_batches%ROWTYPE;
  v_counts JSONB := '{}'::jsonb;
  v_n INTEGER;
  v_inserted INTEGER;
BEGIN
  -- Already promoted? Say so and touch nothing. This is the retry path: the
  -- batch id is derived from the job id, so a second attempt lands here.
  SELECT * INTO v_existing FROM public.ingestion_batches WHERE batch_id = p_batch_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'batch_id', p_batch_id,
      'already_promoted', true,
      'rows_promoted', v_existing.rows_promoted,
      'counts', v_existing.counts
    );
  END IF;

  -- Order below is dictated by foreign keys: an ad cannot reference an ad group
  -- that does not exist yet, and an insight cannot reference either.
  --
  -- Every SELECT is DISTINCT ON the conflict key. The Python builders already
  -- collapse rows by key, so this should never do anything — but PostgreSQL
  -- rejects a statement whose conflict target appears twice ("cannot affect row
  -- a second time") and that failure is file-wide, so the second lock is worth
  -- its four words.

  ---------------------------------------------------------------- ad_groups
  WITH src AS (
    SELECT DISTINCT ON (payload->>'id') payload AS p
    FROM public.ingestion_staging
    WHERE batch_id = p_batch_id AND target_table = 'ad_groups'
    ORDER BY payload->>'id', row_index DESC
  ), ins AS (
    INSERT INTO public.ad_groups (
      id, team_id, name, status, source_platform, external_group_id
    )
    SELECT (p->>'id')::uuid, (p->>'team_id')::uuid, p->>'name', p->>'status',
           p->>'source_platform', p->>'external_group_id'
    FROM src
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      status = EXCLUDED.status,
      source_platform = EXCLUDED.source_platform,
      external_group_id = EXCLUDED.external_group_id,
      updated_at = NOW()
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  v_counts := v_counts || jsonb_build_object('ad_groups', v_n);

  ---------------------------------------------------------------- campaigns
  -- start_date / end_date are deliberately absent here; they are widened
  -- separately below so a second import cannot narrow a campaign's window.
  WITH src AS (
    SELECT DISTINCT ON (payload->>'id') payload AS p
    FROM public.ingestion_staging
    WHERE batch_id = p_batch_id AND target_table = 'campaigns'
    ORDER BY payload->>'id', row_index DESC
  ), ins AS (
    INSERT INTO public.campaigns (
      id, team_id, ad_account_id, name, status, objective
    )
    SELECT (p->>'id')::uuid, (p->>'team_id')::uuid, (p->>'ad_account_id')::uuid,
           p->>'name', p->>'status', p->>'objective'
    FROM src
    ON CONFLICT (id) DO UPDATE SET
      ad_account_id = EXCLUDED.ad_account_id,
      name = EXCLUDED.name,
      status = EXCLUDED.status,
      objective = EXCLUDED.objective,
      updated_at = NOW()
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  v_counts := v_counts || jsonb_build_object('campaigns', v_n);

  ---------------------------------------------------- campaign date windows
  -- A campaign's window must cover every import it has received. Expressed as
  -- a filter rather than a read-modify-write so that two imports landing
  -- together converge on the union instead of one overwriting the other, and
  -- so a window can only ever grow.
  UPDATE public.campaigns c
  SET start_date = w.start_date, updated_at = NOW()
  FROM (
    SELECT (payload->>'id')::uuid AS id, (payload->>'start_date')::timestamptz AS start_date
    FROM public.ingestion_staging
    WHERE batch_id = p_batch_id AND target_table = 'campaign_windows'
      AND payload->>'start_date' IS NOT NULL
  ) w
  WHERE c.id = w.id AND (c.start_date IS NULL OR c.start_date > w.start_date);

  UPDATE public.campaigns c
  SET end_date = w.end_date, updated_at = NOW()
  FROM (
    SELECT (payload->>'id')::uuid AS id, (payload->>'end_date')::timestamptz AS end_date
    FROM public.ingestion_staging
    WHERE batch_id = p_batch_id AND target_table = 'campaign_windows'
      AND payload->>'end_date' IS NOT NULL
  ) w
  WHERE c.id = w.id AND (c.end_date IS NULL OR c.end_date < w.end_date);

  ---------------------------------------------------------------------- ads
  WITH src AS (
    SELECT DISTINCT ON (payload->>'id') payload AS p
    FROM public.ingestion_staging
    WHERE batch_id = p_batch_id AND target_table = 'ads'
    ORDER BY payload->>'id', row_index DESC
  ), ins AS (
    INSERT INTO public.ads (
      id, team_id, ad_group_id, name, platform, platform_ad_id, status, external_status
    )
    SELECT (p->>'id')::uuid, (p->>'team_id')::uuid, (p->>'ad_group_id')::uuid,
           p->>'name', p->>'platform', p->>'platform_ad_id',
           p->>'status', p->>'external_status'
    FROM src
    ON CONFLICT (id) DO UPDATE SET
      ad_group_id = EXCLUDED.ad_group_id,
      name = EXCLUDED.name,
      platform = EXCLUDED.platform,
      platform_ad_id = EXCLUDED.platform_ad_id,
      status = EXCLUDED.status,
      external_status = EXCLUDED.external_status,
      updated_at = NOW()
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  v_counts := v_counts || jsonb_build_object('ads', v_n);

  ------------------------------------------------------------- campaign_ads
  -- A pure join row: it either exists or it does not, and there is nothing to
  -- update about it. DO NOTHING keeps assigned_at at the moment the link was
  -- first made rather than resetting it on every re-import.
  WITH src AS (
    SELECT DISTINCT ON (payload->>'campaign_id', payload->>'ad_id') payload AS p
    FROM public.ingestion_staging
    WHERE batch_id = p_batch_id AND target_table = 'campaign_ads'
    ORDER BY payload->>'campaign_id', payload->>'ad_id', row_index DESC
  ), ins AS (
    INSERT INTO public.campaign_ads (campaign_id, ad_id, assigned_at)
    SELECT (p->>'campaign_id')::uuid, (p->>'ad_id')::uuid, NOW()
    FROM src
    ON CONFLICT (campaign_id, ad_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  v_counts := v_counts || jsonb_build_object('campaign_ads', v_n);

  -------------------------------------------------------------- ad_insights
  -- The conflict key is (ad_account_id, ads_id, date) NULLS NOT DISTINCT, which
  -- is why every insight must carry a non-null ads_id: a null one would collapse
  -- every campaign on the same day into a single row.
  WITH src AS (
    SELECT DISTINCT ON (payload->>'ad_account_id', payload->>'ads_id', payload->>'date')
           payload AS p
    FROM public.ingestion_staging
    WHERE batch_id = p_batch_id AND target_table = 'ad_insights'
    ORDER BY payload->>'ad_account_id', payload->>'ads_id', payload->>'date', row_index DESC
  ), ins AS (
    INSERT INTO public.ad_insights (
      ad_account_id, campaign_id, ads_id, date,
      impressions, reach, clicks, conversions, spend, ctr, cpc, cpm, roas
    )
    SELECT (p->>'ad_account_id')::uuid, (p->>'campaign_id')::uuid, (p->>'ads_id')::uuid,
           (p->>'date')::date,
           (p->>'impressions')::integer, (p->>'reach')::integer,
           (p->>'clicks')::integer, (p->>'conversions')::integer,
           (p->>'spend')::numeric, (p->>'ctr')::numeric,
           (p->>'cpc')::numeric, (p->>'cpm')::numeric, (p->>'roas')::numeric
    FROM src
    ON CONFLICT (ad_account_id, ads_id, date) DO UPDATE SET
      campaign_id = EXCLUDED.campaign_id,
      impressions = EXCLUDED.impressions,
      reach = EXCLUDED.reach,
      clicks = EXCLUDED.clicks,
      conversions = EXCLUDED.conversions,
      spend = EXCLUDED.spend,
      ctr = EXCLUDED.ctr,
      cpc = EXCLUDED.cpc,
      cpm = EXCLUDED.cpm,
      roas = EXCLUDED.roas
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  v_counts := v_counts || jsonb_build_object('ad_insights', v_n);
  v_inserted := v_n;

  ------------------------------------------------------------- sync_history
  -- The merchant's own record that data arrived, in the same place a platform
  -- sync reports itself. Inside the transaction so it cannot claim a sync that
  -- did not commit.
  WITH src AS (
    SELECT DISTINCT ON (payload->>'id') payload AS p
    FROM public.ingestion_staging
    WHERE batch_id = p_batch_id AND target_table = 'sync_history'
    ORDER BY payload->>'id', row_index DESC
  ), ins AS (
    INSERT INTO public.sync_history (
      id, team_id, platform_id, sync_type, status, rows_synced,
      error_message, started_at, completed_at
    )
    SELECT (p->>'id')::uuid, (p->>'team_id')::uuid, (p->>'platform_id')::uuid,
           p->>'sync_type', p->>'status', COALESCE((p->>'rows_synced')::integer, 0),
           p->>'error_message',
           (p->>'started_at')::timestamptz, (p->>'completed_at')::timestamptz
    FROM src
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      rows_synced = EXCLUDED.rows_synced,
      error_message = EXCLUDED.error_message,
      completed_at = EXCLUDED.completed_at,
      updated_at = NOW()
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  v_counts := v_counts || jsonb_build_object('sync_history', v_n);

  -- Mark the batch promoted. ON CONFLICT DO NOTHING rather than a plain insert
  -- because two runs racing on the same batch id both wrote identical rows
  -- above; the loser should report "already promoted", not fail.
  INSERT INTO public.ingestion_batches (
    batch_id, import_job_id, team_id, rows_promoted, counts
  )
  VALUES (p_batch_id, p_import_job_id, p_team_id, COALESCE(v_inserted, 0), v_counts)
  ON CONFLICT (batch_id) DO NOTHING;

  -- The buffer has served its purpose. Dropped in the same transaction, so a
  -- rollback keeps it and a commit does not leave it behind.
  DELETE FROM public.ingestion_staging WHERE batch_id = p_batch_id;

  RETURN jsonb_build_object(
    'batch_id', p_batch_id,
    'already_promoted', false,
    'rows_promoted', COALESCE(v_inserted, 0),
    'counts', v_counts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.promote_batch(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_batch(UUID, UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.promote_batch(UUID, UUID, UUID) IS
  'Move one staged batch into the production ad tables in a single transaction. Merge and dedupe only — validation happens in Python before anything is staged.';

-- ------------------------------------------------------------
-- 5. discard_staging_batch — drop the buffer of a file we refused
--
-- Rows for a batch that never promoted are harmless (nothing reads staging but
-- promote_batch, by batch id), but they are dead weight, and a DLQ path that
-- leaves its buffer behind makes "how much did we refuse" harder to answer than
-- it should be.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.discard_staging_batch(p_batch_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.ingestion_staging WHERE batch_id = p_batch_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.discard_staging_batch(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discard_staging_batch(UUID) TO service_role;

COMMENT ON FUNCTION public.discard_staging_batch(UUID) IS
  'Delete a batch''s staged rows without promoting them. Called after the pipeline refuses a file and writes it to the DLQ.';
