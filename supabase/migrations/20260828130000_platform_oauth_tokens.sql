-- Storage for real OAuth credentials, kept out of reach of the browser.
--
-- Why not `workspace_api_keys`: that table holds `access_token` in plaintext and
-- its SELECT policy is "Team members can view API keys" — any member of the
-- workspace, including a viewer, can read the column over PostgREST. That is
-- survivable today only because the token stored there is a placeholder that
-- `usePlatformConnections.tsx:250` invents (`oauth_facebook_m7k2p1`). The moment
-- a real Meta token goes in, every member can lift it and call the Graph API as
-- the merchant, outside anything this app enforces.
--
-- So the secret moves to a table with RLS enabled and **no policies at all**.
-- No policy means no authenticated caller matches, which is the point: only
-- `service_role` — the edge functions — can read or write it. The browser never
-- sees a token again, and `workspace_api_keys` goes back to being what its other
-- columns say it is: connection status.

-- ── one-time state for the authorization-code round trip ────────────────────
-- The callback arrives from Meta as a plain browser redirect carrying no user
-- JWT, so the only thing tying it back to a workspace is this row. It is
-- therefore single-use and short-lived: without that, anyone who can make the
-- merchant's browser hit the callback could graft their own Meta account onto
-- the merchant's workspace, or replay a captured code.
CREATE TABLE IF NOT EXISTS public.platform_oauth_states (
  state           text PRIMARY KEY,
  team_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,
  platform_slug   text NOT NULL,
  redirect_to     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz
);

ALTER TABLE public.platform_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_platform_oauth_states_expires_at
  ON public.platform_oauth_states USING btree (expires_at);

COMMENT ON TABLE public.platform_oauth_states IS
  'Single-use CSRF state for OAuth redirects. RLS on with no policies: service_role only.';

-- ── the tokens themselves ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_oauth_tokens (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id             uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  platform_id         uuid NOT NULL REFERENCES public.platforms(id),
  access_token        text NOT NULL,
  token_type          text,
  scopes              text,
  expires_at          timestamptz,
  external_account_id text,
  external_user_id    text,
  connected_by        uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, platform_id)
);

ALTER TABLE public.platform_oauth_tokens ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.platform_oauth_tokens IS
  'OAuth access tokens per workspace+platform. RLS on with no policies: service_role only. Never expose access_token to the browser.';

-- ── what the browser is allowed to know ─────────────────────────────────────
-- The integrations page still has to render "connected as act_123, expires in
-- 41 days". That is not secret; the token is. This function returns everything
-- except the token, and answers only for a workspace the caller belongs to.
--
-- SECURITY DEFINER because the table has no policies — the definer's rights are
-- what let it read at all — so the membership check inside the body is the whole
-- access control, not a convenience. `search_path` is pinned per the project's
-- existing helpers.
CREATE OR REPLACE FUNCTION public.get_platform_connection_status(_team_id uuid)
RETURNS TABLE (
  platform_id         uuid,
  platform_slug       character varying,
  external_account_id text,
  scopes              text,
  expires_at          timestamptz,
  connected_at        timestamptz,
  is_expired          boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    t.platform_id,
    p.slug,
    t.external_account_id,
    t.scopes,
    t.expires_at,
    t.created_at,
    (t.expires_at IS NOT NULL AND t.expires_at <= now())
  FROM public.platform_oauth_tokens t
  JOIN public.platforms p ON p.id = t.platform_id
  WHERE t.team_id = _team_id
    AND public.is_team_member((SELECT auth.uid()), _team_id);
$function$;

COMMENT ON FUNCTION public.get_platform_connection_status(uuid) IS
  'Connection status for a workspace, minus the token. Membership-checked in the body; the underlying table has no policies.';
