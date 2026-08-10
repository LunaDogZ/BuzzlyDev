-- ============================================================================
-- Let dev/owner employees read the ingestion dead-letter queue.
--
-- WHY THIS RELAXES A DELIBERATE RESTRICTION
--
-- 20260805150000 created `ingestion_dlq` with RLS enabled and *no* policy at
-- all, so only service_role could read it. That was intentional, and its own
-- comment says why: the failure detail can quote the offending values, and a
-- merchant's export carries order and revenue data — "there is no reason for a
-- browser to hold it".
--
-- The cost of that restriction is that nobody can see *where* the pipeline
-- refuses files without a service_role key and a SQL prompt. The refusals are
-- the engineering signal; keeping them unreadable means the only person who can
-- diagnose an import is whoever holds the production key.
--
-- The restriction is therefore narrowed rather than dropped:
--
--   * `dev` and `owner` only. `support` is deliberately NOT granted — support
--     answers merchants about their own imports, which the merchant-facing
--     `/imports` page already shows, and this table is the engineering view.
--   * Employees must be active AND approved: `has_employee_role` checks both
--     (20260320000041), so a suspended account loses the read with it.
--   * SELECT only. Nothing in the product may edit or delete a refusal record;
--     the DLQ is an append-only ledger written by the pipeline.
--   * The privacy concern is answered in the UI, not here: the page shows the
--     code, stage, counts and filename freely, and keeps `error_message` and
--     `detail` behind an explicit reveal that writes an audit entry naming the
--     employee who looked. RLS cannot express "readable, but log the read", so
--     that half lives in `src/pages/dev/ImportPipeline.tsx` — and this comment
--     exists so the next person knows the two halves belong together.
--
-- `import_jobs` gets the same treatment for the same reason: a refusal names a
-- job id, and a dev who cannot read the job cannot tell which upload it was.
-- The existing team-member policy is untouched; policies are OR'd, so merchants
-- keep exactly the access they had.
-- ============================================================================

BEGIN;

-- ── ingestion_dlq ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Dev or Owner can view ingestion dlq" ON public.ingestion_dlq;

CREATE POLICY "Dev or Owner can view ingestion dlq"
ON public.ingestion_dlq FOR SELECT TO authenticated
USING (
    public.has_employee_role(auth.uid(), 'dev')
    OR public.has_employee_role(auth.uid(), 'owner')
);

-- The dev view lists newest-first and filters by code. Three rows today, one
-- per refused file forever — index it now rather than after it is slow.
CREATE INDEX IF NOT EXISTS idx_ingestion_dlq_occurred_at
  ON public.ingestion_dlq(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingestion_dlq_error_code
  ON public.ingestion_dlq(error_code, occurred_at DESC);

-- ── import_jobs ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Dev or Owner can view all import jobs" ON public.import_jobs;

CREATE POLICY "Dev or Owner can view all import jobs"
ON public.import_jobs FOR SELECT TO authenticated
USING (
    public.has_employee_role(auth.uid(), 'dev')
    OR public.has_employee_role(auth.uid(), 'owner')
);

COMMIT;
