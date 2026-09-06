-- ============================================================================
-- Migration: make the swallowed `customer` INSERT in handle_new_user visible,
--            and backfill the rows it never wrote.
-- Timestamp: 20260906090000
--
-- WHY
-- ---
-- Every block in handle_new_user() is wrapped in `EXCEPTION WHEN OTHERS THEN
-- RAISE WARNING`. On 2026-09-06 a real signup against the cloud project
-- (deploy-check-20260906@buzzly.test) produced a profile_customers row and a
-- loyalty_points wallet but NO public.customer row — proving the customer block
-- raised, and that the warning went somewhere nobody reads. `public.customer`
-- still holds only the five seed rows from 2026-03-24, so no signup has ever
-- written one.
--
-- The damage is silent because the app uses .update() (not .upsert()) on that
-- table in 15 places: an UPDATE matching zero rows returns no error, so
-- SettingsGeneralTab reports "Success" without saving, a plan upgrade in
-- useSubscription leaves plan_type unchanged, and team lists render members
-- with no name or email.
--
-- WHAT THIS MIGRATION DOES *NOT* DO
-- ---------------------------------
-- It does not guess at the cause. The insert succeeds when replayed by hand
-- through PostgREST as service_role — including the exact ON CONFLICT form —
-- so the failure is specific to the trigger's execution context, and the
-- SQLSTATE is the only thing that will say which. This migration records that
-- SQLSTATE; the actual repair lands in a follow-up with the error quoted in its
-- message.
--
-- The handler stays non-fatal on purpose. Making it re-raise would turn an
-- invisible defect into a signup outage for real users before we know what we
-- are catching.
-- ============================================================================

-- ── the recorder ────────────────────────────────────────────────────────────
-- Deliberately NOT given the email. `error_logs` is diagnostic storage, and an
-- email is the one field in a signup payload that identifies a person outright;
-- the same objection already stands against audit_logs_enhanced writing
-- addresses in plaintext. `user_id` correlates a row back to auth.users for
-- anyone entitled to look, and for nobody who is not.
--
-- Its own handler swallows everything: a logger that can abort a signup would
-- be a worse bug than the one it was added to find.
CREATE OR REPLACE FUNCTION public.log_signup_trigger_error(
    p_block     text,
    p_user_id   uuid,
    p_sqlstate  text,
    p_sqlerrm   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
    INSERT INTO public.error_logs (level, message, user_id, metadata)
    VALUES (
        'error',
        format('handle_new_user: %s block failed [%s] %s', p_block, p_sqlstate, p_sqlerrm),
        p_user_id,
        jsonb_build_object(
            'source',   'handle_new_user',
            'block',    p_block,
            'sqlstate', p_sqlstate,
            'sqlerrm',  p_sqlerrm
        )
    );
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'log_signup_trigger_error could not record %: %', p_block, SQLERRM;
END;
$fn$;

ALTER FUNCTION public.log_signup_trigger_error(text, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.log_signup_trigger_error(text, uuid, text, text) FROM PUBLIC;


-- ── the trigger ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_employee_id uuid;
    new_customer_id uuid;
    v_profile_id uuid;
    v_bronze_tier_id uuid;
BEGIN
    RAISE NOTICE 'handle_new_user trigger fired for user: %', new.email;

    IF (new.raw_user_meta_data->>'is_employee_signup')::boolean IS TRUE THEN
        RAISE NOTICE 'Employee signup detected for: %', new.email;

        BEGIN
            INSERT INTO public.employees (
                user_id, email, status, approval_status, role_employees_id
            )
            VALUES (
                new.id, new.email, 'active', 'pending',
                (SELECT id FROM public.role_employees WHERE LOWER(role_name) = 'admin' LIMIT 1)
            )
            ON CONFLICT (user_id) DO UPDATE
                SET email = EXCLUDED.email, updated_at = NOW()
            RETURNING id INTO new_employee_id;

            IF new_employee_id IS NOT NULL THEN
                INSERT INTO public.employees_profile (
                    employees_id, first_name, last_name, aptitude, birthday_at
                )
                VALUES (
                    new_employee_id,
                    new.raw_user_meta_data->>'first_name',
                    new.raw_user_meta_data->>'last_name',
                    new.raw_user_meta_data->>'aptitude',
                    CASE
                        WHEN new.raw_user_meta_data->>'birthday' IS NOT NULL
                         AND new.raw_user_meta_data->>'birthday' != ''
                        THEN (new.raw_user_meta_data->>'birthday')::date
                        ELSE NULL
                    END
                )
                ON CONFLICT (employees_id) DO UPDATE
                    SET first_name = EXCLUDED.first_name,
                        last_name = EXCLUDED.last_name,
                        updated_at = NOW();
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Error creating employee record: %', SQLERRM;
            PERFORM public.log_signup_trigger_error('employees', new.id, SQLSTATE, SQLERRM);
        END;

    ELSE
        RAISE NOTICE 'Customer signup detected for: %', new.email;

        BEGIN
            INSERT INTO public.customer (
                id, email, full_name, plan_type, acquisition_source
            )
            VALUES (
                new.id,
                new.email,
                COALESCE(
                    new.raw_user_meta_data->>'full_name',
                    (new.raw_user_meta_data->>'first_name' || ' ' || new.raw_user_meta_data->>'last_name'),
                    new.email
                ),
                'free',
                new.raw_user_meta_data->>'acquisition_source'
            )
            ON CONFLICT (id) DO UPDATE
                SET email = EXCLUDED.email,
                    full_name = EXCLUDED.full_name,
                    acquisition_source = COALESCE(EXCLUDED.acquisition_source, customer.acquisition_source),
                    updated_at = NOW()
            RETURNING id INTO new_customer_id;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Error creating customer record: %', SQLERRM;
            PERFORM public.log_signup_trigger_error('customer', new.id, SQLSTATE, SQLERRM);
        END;

        BEGIN
            INSERT INTO public.profile_customers (
                user_id, first_name, last_name, phone_number, gender, salary_range
            )
            VALUES (
                new.id,
                new.raw_user_meta_data->>'first_name',
                new.raw_user_meta_data->>'last_name',
                new.raw_user_meta_data->>'phone',
                new.raw_user_meta_data->>'gender',
                new.raw_user_meta_data->>'salary_range'
            )
            ON CONFLICT (user_id) DO UPDATE
                SET first_name = EXCLUDED.first_name,
                    last_name = EXCLUDED.last_name,
                    phone_number = EXCLUDED.phone_number,
                    gender = EXCLUDED.gender,
                    salary_range = EXCLUDED.salary_range,
                    updated_at = NOW()
            RETURNING id INTO v_profile_id;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Error creating profile_customers: %', SQLERRM;
            PERFORM public.log_signup_trigger_error('profile_customers', new.id, SQLSTATE, SQLERRM);
        END;

        -- Create loyalty_points wallet (0 pts, Bronze tier) so missions can award points
        BEGIN
            IF v_profile_id IS NULL THEN
                SELECT id INTO v_profile_id FROM public.profile_customers WHERE user_id = new.id;
            END IF;
            IF v_profile_id IS NOT NULL THEN
                SELECT id INTO v_bronze_tier_id
                FROM public.loyalty_tiers
                WHERE name = 'Bronze' AND is_active = true
                LIMIT 1;
                IF v_bronze_tier_id IS NOT NULL THEN
                    INSERT INTO public.loyalty_points (
                        profile_customer_id, loyalty_tier_id, point_balance, lifetime_points
                    )
                    SELECT v_profile_id, v_bronze_tier_id, 0, 0
                    WHERE NOT EXISTS (
                        SELECT 1 FROM public.loyalty_points
                        WHERE profile_customer_id = v_profile_id
                    );
                END IF;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Error creating loyalty_points wallet: %', SQLERRM;
            PERFORM public.log_signup_trigger_error('loyalty_points', new.id, SQLSTATE, SQLERRM);
        END;

        -- NOTE: Workspace is NOT auto-created for customers (20260320000004,
        -- 20260320000058). useOnboardingGuard answers 'no_workspace' and the UI
        -- asks the merchant to create one. That is deliberate, not a defect.
    END IF;

    RETURN new;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
    'Trigger on auth.users INSERT. Creates customer/profile_customers/loyalty_points for customers. Does NOT auto-create workspace. Every block stays non-fatal, but now records its SQLSTATE in error_logs via log_signup_trigger_error() instead of only RAISE WARNING.';


-- ── backfill ────────────────────────────────────────────────────────────────
-- Everyone who signed up while the block was failing has no row. Written with
-- an explicit NOT EXISTS rather than ON CONFLICT so it can only ever insert,
-- never quietly rewrite a row that is already correct.
--
-- Employees are excluded twice over: the trigger routes them down the other
-- branch, and an existing row in public.employees disqualifies the user here as
-- well. `customer` means "Buzzly subscriber", and an employee is not one.
INSERT INTO public.customer (id, email, full_name, plan_type, acquisition_source)
SELECT
    u.id,
    u.email,
    COALESCE(
        u.raw_user_meta_data->>'full_name',
        NULLIF(TRIM(CONCAT_WS(' ',
            u.raw_user_meta_data->>'first_name',
            u.raw_user_meta_data->>'last_name')), ''),
        u.email
    ),
    'free',
    u.raw_user_meta_data->>'acquisition_source'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.customer  c WHERE c.id      = u.id)
  AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.user_id = u.id)
  AND COALESCE((u.raw_user_meta_data->>'is_employee_signup')::boolean, false) IS NOT TRUE;

-- Say whether the backfill actually closed the gap, so the push output carries
-- the answer instead of it having to be counted afterwards.
DO $backfill$
DECLARE
    v_missing bigint;
BEGIN
    SELECT count(*) INTO v_missing
    FROM auth.users u
    WHERE NOT EXISTS (SELECT 1 FROM public.customer  c WHERE c.id      = u.id)
      AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.user_id = u.id);

    IF v_missing = 0 THEN
        RAISE NOTICE 'backfill: every non-employee auth.users row now has a customer row';
    ELSE
        RAISE WARNING 'backfill: % non-employee users still have no customer row', v_missing;
    END IF;
END;
$backfill$;

NOTIFY pgrst, 'reload schema';
