-- Store the revenue the import pipeline already parsed, instead of dropping it.
--
-- `mapping.py` maps a revenue column (`conversion value`, `ยอดขายจากโฆษณา`, …),
-- `records.py` types it as Decimal, and `targets.py` sums it per bucket and even
-- recovers it per row from `roas x spend`. Then `INSIGHT_COLUMNS` omitted it and
-- this function never inserted it, so every imported row landed `revenue NULL`.
--
-- That is not a cosmetic gap. `computeRoas` (src/hooks/useDashboardMetrics.tsx)
-- withholds ROAS from the whole selection when any `data_source` present in it
-- never reported revenue — deliberately, because printing 0.0x for rows nobody
-- measured is a fabrication. So one uploaded file removed ROAS from the
-- merchant's combined dashboard, using the merchant's own revenue column to do
-- it. The withholding is correct; the NULL feeding it was the defect.
--
-- `ad_insights.revenue` has existed since 20260814120000. Nothing here changes
-- the meaning of the column: NULL = nobody measured revenue for this row, 0 = a
-- source that measures revenue measured none. A file with neither a revenue nor
-- a ROAS column still stages no `revenue` key, `payload->>'revenue'` is still
-- NULL, and the row still lands NULL.
--
-- Replaced whole because CREATE OR REPLACE FUNCTION has no partial form. The
-- body is 20260806090000's, byte for byte, plus the three revenue lines.
-- ---------------------------------------------------------------------------

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
      impressions, reach, clicks, conversions, spend, revenue, ctr, cpc, cpm, roas,
      data_source
    )
    SELECT (p->>'ad_account_id')::uuid, (p->>'campaign_id')::uuid, (p->>'ads_id')::uuid,
           (p->>'date')::date,
           (p->>'impressions')::integer, (p->>'reach')::integer,
           (p->>'clicks')::integer, (p->>'conversions')::integer,
           (p->>'spend')::numeric,
           -- Absent from the payload until now, so `->>` returned NULL and the
           -- column was never written. NULL still means "no source measured
           -- revenue for this row" — an import whose file carried no revenue
           -- and no ROAS stages no key here and lands NULL, exactly as before.
           (p->>'revenue')::numeric,
           (p->>'ctr')::numeric,
           (p->>'cpc')::numeric, (p->>'cpm')::numeric, (p->>'roas')::numeric,
           -- Literal, not payload: this function exists only to commit an
           -- uploaded file, so every row it writes is by definition an import.
           -- Taking it from the payload would let a Python bug label imported
           -- rows as API data, and the dashboard would then attribute a
           -- merchant's spreadsheet to a platform they never connected.
           'import'
    FROM src
    ON CONFLICT (ad_account_id, ads_id, date) DO UPDATE SET
      campaign_id = EXCLUDED.campaign_id,
      -- An import that overwrites an API row has replaced every metric on it,
      -- so the row is the file's now and must be counted as one.
      data_source = 'import',
      impressions = EXCLUDED.impressions,
      reach = EXCLUDED.reach,
      clicks = EXCLUDED.clicks,
      conversions = EXCLUDED.conversions,
      spend = EXCLUDED.spend,
      revenue = EXCLUDED.revenue,
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

-- The column comment named the import pipeline as a writer that leaves this
-- NULL. It no longer does, and a stale comment on a money column is how the
-- next reader gets it wrong.
COMMENT ON COLUMN public.ad_insights.revenue IS
  'Revenue attributed to this ad on this date, in the ad account''s currency (THB). NULL means no source measured revenue for this row — it is NOT zero revenue, and readers must gate on it rather than treat it as 0. Written by the Meta connector from `action_values` under the PURCHASE_ACTIONS allow-list (mock-api/meta/mapping.ts), and by `promote_batch` from an uploaded file whose export stated revenue or a ROAS to recover it from; the mock server leaves it NULL. Caveat for any figure derived from it: this is value the platform ATTRIBUTES, not confirmed income.';
