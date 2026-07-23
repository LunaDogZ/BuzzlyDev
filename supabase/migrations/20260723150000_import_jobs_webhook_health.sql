-- ============================================================
-- Migration: Airflow webhook health check + empty-string guard
-- Date: 2026-07-23
-- Description:
--   Follow-up to 20260723140000. Two fixes found while verifying it live.
--
--   1. The trigger treats a setting as configured when it is non-NULL, but
--      set_pipeline_setting('...', '') writes an empty string. Blanking a
--      setting therefore left the trigger "configured" with a URL of ''.
--      Empty now means unset.
--
--   2. The trigger swallows every exception on purpose — an upload must not
--      fail because the notifier did — which also means a genuinely broken
--      install (pg_net absent, http_post unresolvable) looks identical to a
--      healthy one. pipeline_webhook_health() reports what the trigger would
--      actually find, so the difference is observable without a test upload.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Trigger: treat '' as unset
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_import_jobs_trigger_airflow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  v_url    := NULLIF(public.pipeline_setting('airflow_trigger_url'), '');
  v_secret := NULLIF(public.pipeline_setting('airflow_trigger_secret'), '');

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
  RAISE WARNING 'Airflow webhook failed for import job % (%); leaving it for the sensor DAG.', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 2. Health check
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pipeline_webhook_health()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions, vault
AS $$
DECLARE
  v_http_post_schema TEXT;
  v_probe            TEXT := 'ok';
BEGIN
  -- Where http_post actually lives. pg_net's home schema has differed between
  -- Supabase project vintages, and the trigger resolves it unqualified via
  -- search_path — so this is the value that matters, not what CREATE EXTENSION said.
  SELECT n.nspname INTO v_http_post_schema
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'http_post'
  ORDER BY (n.nspname = 'net') DESC
  LIMIT 1;

  -- Can an unqualified http_post be resolved from the trigger's search_path?
  BEGIN
    PERFORM 'http_post(text)'::regprocedure;
  EXCEPTION WHEN others THEN
    v_probe := SQLERRM;
  END;

  RETURN jsonb_build_object(
    'pg_net_installed',   EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net'),
    'http_post_schema',   v_http_post_schema,
    'http_post_callable', v_probe,
    'vault_available',    to_regclass('vault.decrypted_secrets') IS NOT NULL,
    'url_configured',     NULLIF(public.pipeline_setting('airflow_trigger_url'), '') IS NOT NULL,
    'secret_configured',  NULLIF(public.pipeline_setting('airflow_trigger_secret'), '') IS NOT NULL,
    'trigger_installed',  EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'trg_import_jobs_trigger_airflow' AND NOT tgisinternal
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pipeline_webhook_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pipeline_webhook_health() TO service_role;

COMMENT ON FUNCTION public.pipeline_webhook_health() IS
  'Reports whether the import_jobs -> airflow-trigger webhook is installed and configured. The trigger itself swallows errors by design, so this is how you tell a working install from a broken one.';
