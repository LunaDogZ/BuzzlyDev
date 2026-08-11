-- RLS helper functions: mark STABLE, and scope them to the calling user.
--
-- Two defects, one file, because they are the same seven functions and the same
-- review. Both were found by auditing the live cloud catalog on 2026-08-11 (not
-- the migration text — see the note on counts below).
--
-- 1. VOLATILE helpers re-run per row.  `is_team_member`, `can_manage_team` and
--    `has_permission` never declared a volatility, and Postgres defaults an
--    undeclared function to VOLATILE.  The planner will not hoist a VOLATILE
--    call into an InitPlan, so it is re-evaluated for every row the policy
--    filters.  `has_role`, `has_employee_role` and `is_employee` were already
--    STABLE — the rule was known and applied unevenly.
--
--    Honest scope: at today's row counts (881 ad_insights, 5,070
--    customer_activities) this is not measurable.  It is a scaling fix.
--
-- 2. Every one of these is reachable by `anon` over PostgREST as an RPC, and
--    each takes the user id as an *argument* instead of reading it from the
--    session.  That makes them membership oracles.  Proven live against the
--    cloud project on 2026-08-11 with only the publishable anon key:
--
--      POST /rest/v1/rpc/is_team_member  {real user, real team} -> 200 true
--      POST /rest/v1/rpc/is_team_member  {real user, fake team} -> 200 false
--      POST /rest/v1/rpc/can_manage_team {real user, real team} -> 200 true
--
--    while the same anon key reading workspace_members directly correctly
--    returns [] — so the RPC was handing out exactly what RLS withholds.
--
--    The fix is a caller check inside the body, NOT `REVOKE EXECUTE ... FROM
--    anon`.  The revoke is the textbook answer and it is dangerous here: on
--    supabase/postgres 17.6.1.106 a `permission denied for function` raised for
--    role anon *segfaults the backend* (reproduced from a 6-line schema; vanilla
--    postgres:17.10 and supabase/postgres 17.6.1.084 both raise the error
--    cleanly).  Revoking would therefore convert a low-severity info leak into
--    an anon-triggerable crash on any project running that build.  Do not add a
--    REVOKE here without first confirming the cloud project's exact patch level.
--
--    Safe because every call site passes auth.uid() already: all 402 policies in
--    `public` were checked against pg_policy — 37 is_team_member, 13
--    can_manage_team, 258 has_role, plus has_permission/has_employee_role/
--    is_employee, and **zero** pass anything other than auth.uid() as the user.
--    No function body, trigger, edge function or frontend hook calls them at all
--    (the only src/ hits are the generated types.ts).  So no policy outcome
--    changes; what disappears is the ability to ask about somebody else.
--
-- Correction to the audit note that prompted this, so it is not re-derived:
-- `has_role` has TWO overloads.  Policies bind exclusively to
-- `has_role(uuid, app_role)` (258 calls, already STABLE); the VOLATILE
-- `has_role(uuid, text)` overload is used by **no** policy.  Counting by
-- function *name* conflates them.
--
-- Bodies are otherwise reproduced verbatim from the live catalog.
-- `search_path` is pinned where it was missing; the three that already pinned
-- it are left as they were rather than churned.

-- ── caller-scoped + STABLE + search_path pinned ──────────────────────────────

CREATE OR REPLACE FUNCTION public.is_team_member(_user_id uuid, _team_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- Answer only for the calling user.
  IF _user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RETURN FALSE;
  END IF;

  -- Check members table
  IF EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.user_id = _user_id
      AND wm.team_id = _team_id
  ) THEN
    RETURN TRUE;
  END IF;

  -- Check owners (workspaces table)
  IF EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = _team_id
      AND w.owner_id = _user_id
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_team(_user_id uuid, _team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    -- Answer only for the calling user.
    _user_id IS NOT DISTINCT FROM (SELECT auth.uid())
    AND (
      -- 1. Workspace owner always has manage access
      EXISTS (
        SELECT 1 FROM public.workspaces
        WHERE id = _team_id AND owner_id = _user_id
      )
      OR
      -- 2. Active member with owner/admin role
      EXISTS (
        SELECT 1 FROM public.workspace_members
        WHERE user_id = _user_id
          AND team_id = _team_id
          AND status = 'active'
          AND role IN ('owner', 'admin')
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _team_id uuid, _permission text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _role text;
  _custom jsonb;
  _val jsonb;
BEGIN
  -- Answer only for the calling user.
  IF _user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RETURN false;
  END IF;

  -- Workspace owner always has all permissions
  IF EXISTS (SELECT 1 FROM public.workspaces WHERE id = _team_id AND owner_id = _user_id) THEN
    RETURN true;
  END IF;

  -- Get member's role and custom_permissions
  SELECT role::text, custom_permissions INTO _role, _custom
  FROM public.workspace_members
  WHERE user_id = _user_id AND team_id = _team_id AND status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- If custom_permissions has the key, use it
  IF _custom IS NOT NULL AND _custom ? _permission THEN
    _val := _custom -> _permission;
    IF jsonb_typeof(_val) = 'boolean' THEN
      RETURN (_val)::boolean;
    END IF;
  END IF;

  -- Default permissions by role (must match frontend defaultRolePermissions)
  RETURN CASE _permission
    WHEN 'view_dashboard' THEN true
    WHEN 'view_campaigns' THEN true
    WHEN 'edit_campaigns' THEN _role IN ('owner','admin','editor')
    WHEN 'delete_campaigns' THEN _role IN ('owner','admin')
    WHEN 'view_prospects' THEN true
    WHEN 'edit_prospects' THEN _role IN ('owner','admin','editor')
    WHEN 'delete_prospects' THEN _role IN ('owner','admin')
    WHEN 'view_analytics' THEN true
    WHEN 'export_data' THEN _role IN ('owner','admin')
    WHEN 'manage_team' THEN _role IN ('owner','admin')
    WHEN 'manage_settings' THEN _role = 'owner'
    ELSE false
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- Answer only for the calling user.
  IF _user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.role_employees re
    JOIN public.employees e ON e.role_employees_id = re.id
    WHERE e.user_id = _user_id
    AND e.status = 'active'
    AND e.approval_status = 'approved'
    AND LOWER(re.role_name) = LOWER(_role)  -- Case-insensitive comparison
  );
END;
$function$;

-- ── caller-scoped only (these three already declared STABLE + search_path) ───

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select _user_id is not distinct from (select auth.uid())
     and exists (
       select 1
       from public.user_roles
       where user_id = _user_id and role = _role
     )
$function$;

CREATE OR REPLACE FUNCTION public.has_employee_role(_user_id uuid, _role_name character varying)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    SELECT _user_id IS NOT DISTINCT FROM (SELECT auth.uid())
    AND EXISTS (
        SELECT 1 FROM public.employees e
        JOIN public.role_employees r ON e.role_employees_id = r.id
        WHERE e.user_id = _user_id
        AND LOWER(COALESCE(e.status, '')) = 'active'
        AND LOWER(COALESCE(e.approval_status, '')) = 'approved'
        AND LOWER(TRIM(r.role_name)) = LOWER(TRIM(_role_name))
    )
$function$;

CREATE OR REPLACE FUNCTION public.is_employee(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    SELECT _user_id IS NOT DISTINCT FROM (SELECT auth.uid())
    AND EXISTS (
        SELECT 1 FROM public.employees
        WHERE user_id = _user_id
        AND LOWER(COALESCE(status, '')) = 'active'
        AND LOWER(COALESCE(approval_status, '')) = 'approved'
    )
$function$;
