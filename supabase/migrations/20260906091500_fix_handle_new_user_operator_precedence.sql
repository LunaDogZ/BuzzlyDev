-- ============================================================================
-- Migration: fix the operator-precedence bug that has stopped handle_new_user
--            from ever writing a public.customer row.
-- Timestamp: 20260906091500
--
-- THE ERROR, RECORDED RATHER THAN GUESSED
-- ---------------------------------------
-- 20260906090000 added log_signup_trigger_error() so the swallowed exception
-- would land somewhere readable. The next signup produced:
--
--   handle_new_user: customer block failed [42883]
--   operator does not exist: text ->> unknown
--
-- THE CAUSE
-- ---------
-- In Postgres `->>` and `||` both sit in the "any other operator" precedence
-- class, so they bind equally and associate left to right. This:
--
--   new.raw_user_meta_data->>'first_name' || ' ' || new.raw_user_meta_data->>'last_name'
--
-- does not parse as "concatenate two extracted names". It parses as:
--
--   ((((raw_user_meta_data ->> 'first_name') || ' ') || raw_user_meta_data) ->> 'last_name')
--
-- The final `->>` is therefore applied to a *text* left operand, which is
-- exactly the 42883 above. The parse is decided at plan time, so the statement
-- fails for every customer signup, whether or not first_name is present — the
-- expression never had to be reached for the error to occur.
--
-- The fix is two pairs of parentheses. Nothing else about the block changes.
--
-- WHY IT WENT UNNOTICED FOR SIX MONTHS
-- ------------------------------------
-- The same line was copy-pasted through eight migrations starting at
-- 20260223009004, so no version of this trigger has ever worked; public.customer
-- holds only the five seed rows from 2026-03-24. The enclosing
-- `EXCEPTION WHEN OTHERS THEN RAISE WARNING` returned success to GoTrue every
-- time, and the app reads the table with .update() rather than .upsert(), so a
-- zero-row UPDATE reported no error either. Two independent layers of
-- swallowing, and the failure never surfaced anywhere a person looks.
--
-- The sibling profile_customers block survived only because it passes each
-- field through `->>` on its own and never concatenates.
-- ============================================================================

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
                    -- The parentheses are the entire fix. Without them `->>` and
                    -- `||` bind equally and the last `->>` lands on text.
                    NULLIF(TRIM(
                        COALESCE(new.raw_user_meta_data->>'first_name', '')
                        || ' ' ||
                        COALESCE(new.raw_user_meta_data->>'last_name', '')
                    ), ''),
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
    'Trigger on auth.users INSERT. Creates customer/profile_customers/loyalty_points for customers. Does NOT auto-create workspace. Blocks stay non-fatal but record their SQLSTATE in error_logs via log_signup_trigger_error().';


-- Catch the signups that happened between the two migrations (the diagnostic
-- one deliberately left the bug in place so it could be observed).
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

NOTIFY pgrst, 'reload schema';
