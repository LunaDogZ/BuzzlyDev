-- Live definitions 2026-10-07 (pg_get_functiondef). Reference only; round 3 does not change them.

CREATE OR REPLACE FUNCTION public.can_manage_team(_user_id uuid, _team_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
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
$function$


CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _team_id uuid, _permission text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
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
$function$


CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
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
$function$


CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select _user_id is not distinct from (select auth.uid())
     and exists (
       select 1
       from public.user_roles
       where user_id = _user_id and role = _role
     )
$function$


CREATE OR REPLACE FUNCTION public.is_team_member(_user_id uuid, _team_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Answer only for the calling user.
  IF _user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RETURN FALSE;
  END IF;

  -- Check members table: only an active membership counts.
  IF EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.user_id = _user_id
      AND wm.team_id = _team_id
      AND wm.status = 'active'::public.member_status
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
$function$


CREATE OR REPLACE FUNCTION public.try_cast_uuid(_text text)
 RETURNS uuid
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
  RETURN _text::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$function$

