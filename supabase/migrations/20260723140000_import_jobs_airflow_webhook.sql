-- ============================================================
-- Migration: Airflow trigger webhook (Phase 1, step 3)
-- Date: 2026-07-23
-- Description:
--   Push half of the ingestion trigger path. Every INSERT into import_jobs
--   fires an async pg_net request to the `airflow-trigger` Edge Function,
--   which claims the job and starts a buzzly_import_pipeline DAG run.
--
--   The pull half — the buzzly_import_sensor DAG polling for `pending` jobs
--   every two minutes — is what makes this webhook non-critical. If pg_net,
--   the Edge Function, or the network to Airflow drops a job, the sensor
--   picks it up within two minutes. That is deliberate: this trigger is an
--   optimisation for latency, not the mechanism of record.
--
--   Two settings are read at fire time and are NOT stored in this file:
--     airflow_trigger_url     https://<ref>.functions.supabase.co/airflow-trigger
--     airflow_trigger_secret  shared secret, sent as x-buzzly-trigger-secret
--                             and matched against the function's
--                             BUZZLY_TRIGGER_SECRET
--
--   Provision them out-of-band (never in a migration — migrations are in git):
--     select public.set_pipeline_setting('airflow_trigger_url',    '...');
--     select public.set_pipeline_setting('airflow_trigger_secret', '...');
--
--   Until both are set the trigger is inert: it logs and returns, so applying
--   this migration cannot break uploads.
-- ============================================================

-- ------------------------------------------------------------
-- 0. pg_net — async HTTP from Postgres.
--    Guarded: a project without it should still take the rest of this
--    migration, with the trigger degrading to a logged no-op.
-- ------------------------------------------------------------
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN others THEN
  RAISE WARNING 'pg_net unavailable (%); the Airflow webhook will no-op and the sensor DAG becomes the only trigger path.', SQLERRM;
END;
$$;

-- ------------------------------------------------------------
-- 1. Settings store.
--    Vault when the project has it, a locked-down table otherwise. Both are
--    reachable only through the SECURITY DEFINER accessors below — the table
--    has RLS on with no policies at all, so every role except service_role
--    (which bypasses RLS) sees nothing.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pipeline_settings (
  name       TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.pipeline_settings ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.pipeline_settings IS
  'Pipeline configuration read by SECURITY DEFINER triggers. RLS is on with no policies by design: nothing but service_role and the definer functions can read it. Fallback for projects without Vault.';

REVOKE ALL ON public.pipeline_settings FROM anon, authenticated;

-- ------------------------------------------------------------
-- 2. Accessors
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pipeline_setting(_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_value TEXT;
BEGIN
  -- Vault first; it is the better store when the project has it.
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
      INTO v_value USING _name;
    IF v_value IS NOT NULL THEN
      RETURN v_value;
    END IF;
  END IF;

  SELECT value INTO v_value FROM public.pipeline_settings WHERE name = _name;
  RETURN v_value;
END;
$$;

REVOKE ALL ON FUNCTION public.pipeline_setting(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pipeline_setting(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.set_pipeline_setting(_name TEXT, _value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_store TEXT := 'pipeline_settings';
BEGIN
  IF to_regclass('vault.secrets') IS NOT NULL THEN
    BEGIN
      -- vault.create_secret raises on a duplicate name, so update in that case.
      IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = _name) THEN
        PERFORM vault.update_secret(
          (SELECT id FROM vault.secrets WHERE name = _name), _value, _name
        );
      ELSE
        PERFORM vault.create_secret(_value, _name, 'Buzzly ingestion pipeline setting');
      END IF;
      RETURN 'vault';
    EXCEPTION WHEN others THEN
      RAISE WARNING 'Vault write failed (%); falling back to pipeline_settings.', SQLERRM;
    END;
  END IF;

  INSERT INTO public.pipeline_settings (name, value)
  VALUES (_name, _value)
  ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
  RETURN v_store;
END;
$$;

REVOKE ALL ON FUNCTION public.set_pipeline_setting(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_pipeline_setting(TEXT, TEXT) TO service_role;

-- ------------------------------------------------------------
-- 3. The trigger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_import_jobs_trigger_airflow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
-- `net` and `extensions` are both in scope because pg_net's home schema differs
-- between Supabase project vintages; an unqualified http_post resolves either way.
SET search_path = public, net, extensions
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
BEGIN
  -- Only brand-new work. A row inserted in any other state is not ours to start.
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  v_url    := public.pipeline_setting('airflow_trigger_url');
  v_secret := public.pipeline_setting('airflow_trigger_secret');

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE LOG 'import_jobs webhook not configured (set airflow_trigger_url / airflow_trigger_secret); job % left for the sensor DAG', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-buzzly-trigger-secret', v_secret
               ),
    body    := jsonb_build_object(
                 'type',   'INSERT',
                 'table',  'import_jobs',
                 'record', jsonb_build_object('id', NEW.id, 'status', NEW.status)
               ),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
EXCEPTION WHEN others THEN
  -- An upload must never fail because the notifier did. The job row is already
  -- committed as `pending`, which is exactly what the sensor DAG looks for.
  RAISE WARNING 'Airflow webhook failed for import job % (%); leaving it for the sensor DAG.', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_import_jobs_trigger_airflow ON public.import_jobs;

CREATE TRIGGER trg_import_jobs_trigger_airflow
  AFTER INSERT ON public.import_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_import_jobs_trigger_airflow();

COMMENT ON FUNCTION public.tg_import_jobs_trigger_airflow() IS
  'Notifies the airflow-trigger Edge Function of a new import job. Best-effort by design: the buzzly_import_sensor DAG re-discovers anything this misses.';
