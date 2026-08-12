-- Tell a simulated number from a real one.
--
-- Migration 20260806090000 split `ad_insights` by how the data arrived:
-- 'api' (a platform connection) vs 'import' (a file the merchant uploaded).
-- That split is still right, but 'api' has been carrying two different claims
-- at once. Every 'api' row in this database was written by the mock server in
-- mock-api/server.ts, which serves fixtures — not one of them came from Meta.
--
-- A real Meta connector is now possible (a long-lived token with `ads_read`
-- reads act_1025260845170202 as of 2026-08-12). The moment it writes its first
-- row it would land as 'api' too, and real revenue would become
-- indistinguishable from invented numbers inside the same column — the exact
-- failure 20260806090000 was written to prevent, recreated one level down.
--
-- So 'api' is split in two:
--
--   'mock'      the mock server's fixtures — simulated, proves nothing
--   'meta_live' fetched from the Meta Marketing API against a real ad account
--
-- 'api' and 'import' are kept in the CHECK. 'import' because it is unchanged
-- and load-bearing (see the guard below). 'api' because it is the column
-- DEFAULT, and that is deliberate — see the note after the constraint.

-- ---------------------------------------------------------------------------
-- 1. Widen the constraint FIRST.
-- ---------------------------------------------------------------------------
-- Order matters: the relabel below writes 'mock', which the old two-value
-- CHECK rejects. Widening after updating would abort the whole migration.
--
-- DROP IF EXISTS + ADD rather than a DO block guarding pg_constraint: this
-- follows 20260806090000, and the drop-then-add is already idempotent. The
-- table is small (881 rows at time of writing) so the ACCESS EXCLUSIVE lock
-- taken to re-validate it is measured in milliseconds; on a large table this
-- would want ADD ... NOT VALID followed by a separate VALIDATE CONSTRAINT.

ALTER TABLE public.ad_insights
  DROP CONSTRAINT IF EXISTS ad_insights_data_source_check;
ALTER TABLE public.ad_insights
  ADD CONSTRAINT ad_insights_data_source_check
  CHECK (data_source IN ('api', 'import', 'mock', 'meta_live'));

-- The DEFAULT stays 'api', which after this migration matches zero rows.
--
-- That is the point. Every writer is now expected to name its source: the mock
-- server says 'mock', the Meta connector says 'meta_live', promote_batch says
-- 'import'. A row that arrives as 'api' therefore means a writer forgot to say
-- what it was — a bug, and one that shows up as an obviously wrong label
-- instead of hiding.
--
-- Defaulting to 'mock' or 'meta_live' instead would each be worse in a
-- different direction: 'mock' would quietly file real money as fake, and
-- 'meta_live' would quietly file fixtures as real money. Given the product is
-- a profit number a merchant acts on, the second is the one that must never be
-- reachable by accident.

COMMENT ON COLUMN public.ad_insights.data_source IS
  'Where this row came from: ''mock'' = fixtures from mock-api/server.ts (simulated), ''meta_live'' = fetched from the Meta Marketing API for a real ad account, ''import'' = a file the merchant uploaded through /imports (written by promote_batch), ''api'' = legacy/unattributed, matches no row after 20260812060000 and indicates a writer that failed to declare its source.';

-- ---------------------------------------------------------------------------
-- 2. Relabel the existing 'api' rows to 'mock', and prove what was touched.
-- ---------------------------------------------------------------------------
-- Every one of them is a fixture, so this is a rename of a mislabelled set,
-- not a reinterpretation of anything: no row changes meaning, only its name
-- stops overstating what it is.
--
-- Expected on the research cloud project (aokzvknggtccgwbavszj), counted
-- 2026-08-12 immediately before writing this file:
--
--     total 881  =  api 608  +  import 273
--
-- Those numbers are NOT asserted literally. This file has to run on a fresh
-- local database and in CI, where they are all zero, and a migration that only
-- works against one snapshot of one database is not a migration. What is
-- asserted instead are invariants that hold on any database and still catch
-- the failures worth catching — a trigger, an RLS policy or a typo silently
-- widening or narrowing the write.
--
-- The import guard is the one that matters most: those 273 rows are the
-- evidence behind KPI-2 and KPI-3 in tests/RESULTS.md. If this migration
-- disturbs a single one of them, the measurement stops being reproducible and
-- the run has to abort rather than report success.

DO $$
DECLARE
  v_api_before    BIGINT;
  v_import_before BIGINT;
  v_api_after     BIGINT;
  v_mock_after    BIGINT;
  v_import_after  BIGINT;
  v_updated       BIGINT;
BEGIN
  SELECT count(*) FILTER (WHERE data_source = 'api'),
         count(*) FILTER (WHERE data_source = 'import')
    INTO v_api_before, v_import_before
    FROM public.ad_insights;

  RAISE NOTICE 'ad_insights before: api=%, import=%', v_api_before, v_import_before;

  UPDATE public.ad_insights
     SET data_source = 'mock'
   WHERE data_source = 'api';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT count(*) FILTER (WHERE data_source = 'api'),
         count(*) FILTER (WHERE data_source = 'mock'),
         count(*) FILTER (WHERE data_source = 'import')
    INTO v_api_after, v_mock_after, v_import_after
    FROM public.ad_insights;

  RAISE NOTICE 'ad_insights after:  api=%, mock=%, import=% (% relabelled)',
    v_api_after, v_mock_after, v_import_after, v_updated;

  -- The uploaded rows are untouched. Checked by count rather than by trusting
  -- the WHERE clause, because the point of a guard is to disbelieve the
  -- statement it guards.
  IF v_import_after <> v_import_before THEN
    RAISE EXCEPTION
      'aborting: import rows changed from % to %. The uploaded-file rows are the KPI-2/KPI-3 evidence and this migration must not touch them.',
      v_import_before, v_import_after;
  END IF;

  -- Nothing labelled 'api' survives, or the relabel did not do what it says.
  IF v_api_after <> 0 THEN
    RAISE EXCEPTION
      'aborting: % rows still labelled ''api'' after the relabel.', v_api_after;
  END IF;

  -- Exactly the former 'api' rows became 'mock' — no more, no fewer. Catches a
  -- write that reached rows outside the intended set as well as one that was
  -- silently filtered down (an RLS policy on the migration role, say).
  IF v_mock_after <> v_api_before THEN
    RAISE EXCEPTION
      'aborting: expected % rows labelled ''mock'', found %.',
      v_api_before, v_mock_after;
  END IF;

  IF v_updated <> v_api_before THEN
    RAISE EXCEPTION
      'aborting: UPDATE reported % rows but % were labelled ''api'' beforehand.',
      v_updated, v_api_before;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. No index change.
-- ---------------------------------------------------------------------------
-- `ad_insights_account_source_date_idx (ad_account_id, data_source, date)` from
-- 20260806090000 still covers every dashboard read; the column's values changed
-- but neither its type nor how it is filtered did. Left alone deliberately, so
-- that this is recorded as considered rather than forgotten.
