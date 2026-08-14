-- Store the revenue Meta attributes, instead of throwing it away and printing 0.0x.
--
-- `ad_insights` has carried a `roas` column since the consolidated schema, and
-- every writer either leaves it NULL (the Meta connector, deliberately) or
-- computes it and discards its own numerator (the import pipeline —
-- airflow/dags/buzzly_common/targets.py admits this in a comment). The
-- dashboard then averages the per-row ratios, which is not a return on
-- anything: a row that spent ฿1 and a row that spent ฿1,000 count equally.
--
-- Measured 2026-08-14 by scripts/meta-revenue-probe.mjs against the live
-- account (act_1025260845170202, 2025-01-01 → 2026-08-14, ad/day, 32 rows):
-- Meta DOES report revenue, ฿3,605.00 of it, under `action_values`. Without
-- somewhere to put it the dashboard has to keep showing ROAS 0.0x for an
-- account whose blended return is about 2.6x.
--
-- So: one nullable column, and the nullability is the whole design.
--
--   NULL  = nobody measured revenue for this row
--   0     = a source that reports revenue reported none
--
-- Those are different claims and the product is not allowed to confuse them
-- (see 9b12678, which deleted a dashboard that invented `gross × 0.85`). Hence
-- no DEFAULT: `spend` defaults to 0 and that was arguably already a mistake,
-- but a revenue column that defaults to 0 would state "this campaign earned
-- nothing" on all 273 imported rows and every mock row, none of which was ever
-- asked the question. The reader gates on it — a set with any NULL revenue
-- shows "—" rather than a ratio computed from the rows that happen to have it.

-- ---------------------------------------------------------------------------
-- 1. The column.
-- ---------------------------------------------------------------------------
-- numeric(15,2), matching `spend` exactly. Same currency (THB — the connector
-- refuses any account whose currency is not THB, because this table has no
-- currency column), same scale, and numeric rather than double precision
-- because ROAS is a ratio of two money totals and float addition does not
-- round-trip. The writer passes a decimal string straight through; it must
-- never become a JS number on the way.
--
-- Adding a nullable column with no DEFAULT is metadata-only in Postgres 11+:
-- no table rewrite, an ACCESS EXCLUSIVE lock held for microseconds. A DEFAULT
-- would still avoid the rewrite (11+ stores it in pg_attribute) but would set
-- the wrong value on every existing row, which is the point above.

ALTER TABLE public.ad_insights
  ADD COLUMN IF NOT EXISTS revenue numeric(15,2);

COMMENT ON COLUMN public.ad_insights.revenue IS
  'Revenue attributed to this ad on this date, in the ad account''s currency (THB). NULL means no source measured revenue for this row — it is NOT zero revenue, and readers must gate on it rather than treat it as 0. Written by the Meta connector from `action_values` under the PURCHASE_ACTIONS allow-list (mock-api/meta/mapping.ts); the import pipeline and the mock server leave it NULL. Caveat for any figure derived from it: this is value Meta ATTRIBUTES, not confirmed income.';

-- ---------------------------------------------------------------------------
-- 2. Refuse a negative.
-- ---------------------------------------------------------------------------
-- Meta's `action_values` are non-negative for purchase action types, so a
-- negative here would not be a refund — it would be a parser fault (a stray
-- minus, a subtraction where a sum was meant, a locale-mangled Thai numeral of
-- the kind the ingestion cleaner exists to catch). Storing it silently would
-- push a wrong ROAS onto the screen; refusing it turns the same bug into a
-- failed write with a name on it.
--
-- If a genuine negative ever needs storing (a refund column, say), that is a
-- deliberate schema decision and it can drop this constraint on purpose —
-- which is exactly the review this guard is here to force.
--
-- NULL passes: `revenue >= 0` evaluates to NULL for a NULL row and a CHECK
-- only fails on an explicit false. Written out anyway so the intent is on the
-- page rather than resting on three-valued logic the next reader has to recall.

ALTER TABLE public.ad_insights
  DROP CONSTRAINT IF EXISTS ad_insights_revenue_nonnegative;
ALTER TABLE public.ad_insights
  ADD CONSTRAINT ad_insights_revenue_nonnegative
  CHECK (revenue IS NULL OR revenue >= 0);

-- ---------------------------------------------------------------------------
-- 3. Prove the column landed empty.
-- ---------------------------------------------------------------------------
-- The migration claims it invents no revenue. That claim is worth a count:
-- a DEFAULT added by a later hand-edit, or a trigger backfilling from `roas`,
-- would both show up here as a non-NULL row and abort before the number
-- reaches a dashboard. Counts are not asserted literally — this file has to
-- run on a fresh local database and in CI where the table is empty.

DO $$
DECLARE
  v_total   BIGINT;
  v_with    BIGINT;
BEGIN
  SELECT count(*), count(revenue) INTO v_total, v_with FROM public.ad_insights;

  RAISE NOTICE 'ad_insights: % rows, % with revenue (expected 0)', v_total, v_with;

  IF v_with <> 0 THEN
    RAISE EXCEPTION
      'aborting: % of % rows already carry a revenue value. This migration adds the column and must not populate it; revenue arrives from a sync, not from a schema change.',
      v_with, v_total;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. No index change.
-- ---------------------------------------------------------------------------
-- `ad_insights_account_source_date_idx (ad_account_id, data_source, date)`
-- from 20260806090000 still selects the dashboard's rows; `revenue` is summed
-- after the filter, never filtered or ordered on. Widening it into a covering
-- index would add a column to every index entry to save one heap fetch per row
-- on a table of under a thousand rows. Considered, declined, recorded.
