-- ============================================================
-- Migration: fix the http_post probe in pipeline_webhook_health()
-- Date: 2026-07-23
-- Description:
--   The probe added in 20260723150000 cast 'http_post(text)'::regprocedure,
--   which asks for a single-text-argument overload. pg_net's signature is
--   http_post(url text, body jsonb, params jsonb, headers jsonb,
--   timeout_milliseconds integer), so the probe reported "does not exist" on a
--   perfectly healthy install — a health check that cries wolf.
--
--   to_regproc() resolves by name against the current search_path, which is
--   exactly the question the trigger's unqualified call asks.
-- ============================================================

CREATE OR REPLACE FUNCTION public.pipeline_webhook_health()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions, vault
AS $$
DECLARE
  v_schema    TEXT;
  v_signature TEXT;
BEGIN
  SELECT n.nspname, pg_get_function_identity_arguments(p.oid)
    INTO v_schema, v_signature
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'http_post'
  ORDER BY (n.nspname = 'net') DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'pg_net_installed',  EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net'),
    'http_post_schema',  v_schema,
    -- The trigger calls http_post unqualified, so name resolution against
    -- search_path — not the extension's presence — is what has to hold.
    'http_post_callable', to_regproc('http_post') IS NOT NULL,
    'http_post_signature', v_signature,
    'vault_available',   to_regclass('vault.decrypted_secrets') IS NOT NULL,
    'url_configured',    NULLIF(public.pipeline_setting('airflow_trigger_url'), '') IS NOT NULL,
    'secret_configured', NULLIF(public.pipeline_setting('airflow_trigger_secret'), '') IS NOT NULL,
    'trigger_installed', EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'trg_import_jobs_trigger_airflow' AND NOT tgisinternal
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pipeline_webhook_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pipeline_webhook_health() TO service_role;
