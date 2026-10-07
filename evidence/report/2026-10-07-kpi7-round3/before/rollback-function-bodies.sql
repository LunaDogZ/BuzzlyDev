-- ROLLBACK for 20261007193000_tier_and_discount_functions_check_caller.sql
--
-- NOT a migration. The four function definitions exactly as read live
-- (pg_get_functiondef) on 2026-10-07 before the push. CREATE OR REPLACE keeps
-- owner and ACL. Running it reopens the anon / inactive-employee / any-customer holes.

BEGIN;

CREATE OR REPLACE FUNCTION public.evaluate_inactivity_tier_downgrades()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    r              RECORD;
    v_tier         RECORD;
    v_qualified_id  UUID;
    v_downgraded   INT := 0;
    v_cutoff       TIMESTAMPTZ;
    v_override_cutoff TIMESTAMPTZ;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.employees WHERE user_id = auth.uid()) THEN
        RAISE EXCEPTION 'employees_only';
    END IF;

    FOR v_tier IN
        SELECT id, name, COALESCE(retention_period_days, 90) AS days
        FROM public.loyalty_tiers
        WHERE is_active = true AND retention_period_days IS NOT NULL
    LOOP
        v_cutoff := now() - (v_tier.days || ' days')::interval;
        v_override_cutoff := now() - (v_tier.days || ' days')::interval;

        FOR r IN
            SELECT lp.id, lp.profile_customer_id, lp.loyalty_tier_id, lp.lifetime_points, lp.manual_override_at
            FROM public.loyalty_points lp
            WHERE lp.loyalty_tier_id = v_tier.id
              AND COALESCE(lp.last_activity_at, lp.updated_at, lp.created_at) < v_cutoff
              -- Skip if Support manually overrode within retention period
              AND (lp.manual_override_at IS NULL OR lp.manual_override_at < v_override_cutoff)
        LOOP
            SELECT id INTO v_qualified_id
            FROM public.loyalty_tiers
            WHERE is_active = true
              AND COALESCE(min_points, 0) <= COALESCE(r.lifetime_points, 0)
            ORDER BY priority_level DESC
            LIMIT 1;

            IF v_qualified_id IS NOT NULL AND v_qualified_id IS DISTINCT FROM r.loyalty_tier_id THEN
                UPDATE public.loyalty_points
                SET loyalty_tier_id = v_qualified_id, updated_at = now()
                WHERE id = r.id;
                v_downgraded := v_downgraded + 1;
            END IF;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object('downgraded_count', v_downgraded);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_tier_from_lifetime_points()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    r              RECORD;
    v_correct_id   UUID;
    v_updated      INT := 0;
    v_backfilled   INT := 0;
    v_override_cutoff TIMESTAMPTZ := now() - interval '90 days';
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_employee(auth.uid()) THEN
        RAISE EXCEPTION 'permission_denied: employees only';
    END IF;

    FOR r IN
        SELECT lp.id, lp.profile_customer_id, lp.loyalty_tier_id, lp.lifetime_points, lp.manual_override_at
        FROM public.loyalty_points lp
        WHERE lp.manual_override_at IS NULL OR lp.manual_override_at < v_override_cutoff
    LOOP
        SELECT id INTO v_correct_id
        FROM public.loyalty_tiers
        WHERE is_active = true
          AND COALESCE(min_points, 0) <= COALESCE(r.lifetime_points, 0)
        ORDER BY priority_level DESC
        LIMIT 1;

        IF v_correct_id IS NOT NULL AND v_correct_id IS DISTINCT FROM r.loyalty_tier_id THEN
            UPDATE public.loyalty_points
            SET loyalty_tier_id = v_correct_id, updated_at = now()
            WHERE id = r.id;
            v_updated := v_updated + 1;
        END IF;
    END LOOP;

    INSERT INTO public.loyalty_tier_history (
        profile_customer_id, old_tier, new_tier, change_type, change_reason, changed_at
    )
    SELECT lp.profile_customer_id, 'Bronze', lt.name, 'auto',
           'System auto-evaluated tier (sync)', NOW()
    FROM public.loyalty_points lp
    JOIN public.loyalty_tiers lt ON lt.id = lp.loyalty_tier_id
    WHERE lt.name IN ('Silver', 'Gold', 'Platinum')
      AND (lp.manual_override_at IS NULL OR lp.manual_override_at < v_override_cutoff)
      AND NOT EXISTS (
          SELECT 1 FROM public.loyalty_tier_history lth
          WHERE lth.profile_customer_id = lp.profile_customer_id
            AND lth.new_tier IN ('Silver', 'Gold', 'Platinum')
      );

    GET DIAGNOSTICS v_backfilled = ROW_COUNT;

    RETURN jsonb_build_object('updated_count', v_updated, 'backfilled_count', v_backfilled);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_tier_retention_period(p_tier_id uuid, p_retention_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE user_id = auth.uid()) THEN
        RAISE EXCEPTION 'employees_only';
    END IF;
    IF p_retention_days IS NOT NULL AND (p_retention_days < 30 OR p_retention_days > 365) THEN
        RAISE EXCEPTION 'retention_days must be between 30 and 365';
    END IF;
    UPDATE public.loyalty_tiers
    SET retention_period_days = p_retention_days, updated_at = now()
    WHERE id = p_tier_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'tier_not_found';
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_available_discounts(p_customer_id uuid)
 RETURNS TABLE(id uuid, code text, name character varying, description text, publish_time timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        d.id,
        d.code::TEXT,
        d.name,
        d.description,
        d.published_at AS publish_time
    FROM public.discounts d
    WHERE 
        -- 1. Is it active and published?
        d.is_active = true 
        AND d.published_at IS NOT NULL
        
        -- 2. Has it expired?
        AND (d.end_date IS NULL OR d.end_date > now())
        
        -- 3. Has the usage limit been reached? (Global across all customers)
        AND (
            d.usage_limit IS NULL 
            OR 
            (SELECT count(*) FROM public.customer_coupons WHERE discount_id = d.id) < d.usage_limit
        )

        -- 4. Did THIS specific customer already collect it?
        AND NOT EXISTS (
            SELECT 1 
            FROM public.customer_coupons cc 
            WHERE cc.discount_id = d.id 
              AND cc.customer_id = p_customer_id
        )
    ORDER BY d.published_at DESC;
END;
$function$;

COMMIT;
