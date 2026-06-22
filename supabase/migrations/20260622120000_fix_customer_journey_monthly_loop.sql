-- ============================================================
-- Migration: Fix get_customer_journey_monthly_data REVERSE loop bounds
-- ============================================================
-- Bug: the original definition (20260317100001_customer_journey_funnel_rpc.sql)
-- iterated `FOR v_i IN REVERSE 0..(p_months_back - 1)`. In PostgreSQL the REVERSE
-- form counts DOWN and requires `high..low`; written as `REVERSE 0..5` the loop
-- variable starts at 0 and is decremented, so the body never executes and the
-- function returns ZERO rows for every caller. This left the Customer Journey /
-- AARRR monthly chart permanently empty regardless of data.
--
-- Fix: iterate `REVERSE (p_months_back - 1)..0` so v_i runs 5,4,3,2,1,0 (oldest
-- month first → current month last). Body is otherwise identical to the original.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_customer_journey_monthly_data(
  p_months_back int DEFAULT 6,
  p_platform_id uuid DEFAULT NULL
)
RETURNS TABLE (
  month text,
  month_label text,
  awareness bigint,
  consideration bigint,
  acquisition bigint,
  intent bigint,
  conversion bigint,
  acquisition_is_estimated boolean,
  intent_is_estimated boolean,
  conversion_is_estimated boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_month_key text;
  v_date date;
  v_i int;
  v_imp bigint;
  v_clicks bigint;
  v_leads bigint;
  v_atc bigint;
  v_conv bigint;
  v_leads_est boolean;
  v_atc_est boolean;
  v_conv_est boolean;
BEGIN
  -- REVERSE form must be high..low; (p_months_back - 1)..0 yields oldest→newest.
  FOR v_i IN REVERSE (p_months_back - 1)..0 LOOP
    v_date := (CURRENT_DATE - (v_i || ' months')::interval)::date;
    v_month_key := to_char(v_date, 'YYYY-MM');

    SELECT
      COALESCE(SUM(ai.impressions), 0)::bigint,
      COALESCE(SUM(ai.clicks), 0)::bigint,
      COALESCE(SUM(ai.leads), 0)::bigint,
      COALESCE(SUM(ai.adds_to_cart), 0)::bigint,
      COALESCE(SUM(ai.conversions), 0)::bigint
    INTO v_imp, v_clicks, v_leads, v_atc, v_conv
    FROM ad_insights ai
    INNER JOIN ad_accounts aa ON aa.id = ai.ad_account_id AND aa.is_active = true
    WHERE ai.date >= date_trunc('month', v_date)::date
      AND ai.date < date_trunc('month', v_date)::date + interval '1 month'
      AND (p_platform_id IS NULL OR aa.platform_id = p_platform_id);

    v_leads_est := false;
    v_atc_est := false;
    v_conv_est := false;

    IF v_leads = 0 AND v_clicks > 0 THEN
      v_leads := ROUND(v_clicks * 0.05)::bigint;
      v_leads_est := true;
    END IF;

    IF v_atc = 0 AND (v_leads > 0 OR v_conv > 0) THEN
      v_atc := GREATEST(
        ROUND(v_leads * 0.25)::bigint,
        ROUND(v_conv * 2.5)::bigint
      );
      v_atc_est := true;
    END IF;

    IF v_conv = 0 AND v_atc > 0 THEN
      v_conv := ROUND(v_atc * 0.35)::bigint;
      v_conv_est := true;
    END IF;

    month := v_month_key;
    month_label := to_char(v_date, 'Mon yy');
    awareness := v_imp;
    consideration := v_clicks;
    acquisition := v_leads;
    intent := v_atc;
    conversion := v_conv;
    acquisition_is_estimated := v_leads_est;
    intent_is_estimated := v_atc_est;
    conversion_is_estimated := v_conv_est;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_journey_monthly_data(int, uuid) TO authenticated;

COMMENT ON FUNCTION public.get_customer_journey_monthly_data IS
  'Returns monthly ad_insights aggregation for Customer Journey charts. Includes is_estimated flags per metric. (REVERSE loop bounds fixed 2026-06-22.)';
