-- is_team_member: a suspended or removed member is no longer a member.
--
-- The app's "Suspend member" action (useTeamManagement.tsx) sets
-- workspace_members.status = 'suspended' and tells the owner "Member access has
-- been suspended". The database did not agree: is_team_member matched any
-- workspace_members row whatever its status, so every policy built on it kept
-- granting access. Reproduced on the cloud project on 2026-10-07 inside a
-- rolled-back transaction — a viewer set to 'suspended' still got
-- is_team_member = true and could read 3 import_jobs, 448 ad_insights and the
-- workspace's member list.
--
-- can_manage_team already requires status = 'active'; this brings the weaker
-- helper in line with it. The owner path (workspaces.owner_id) is unchanged.
--
-- Blast radius at the time of writing: all 31 workspace_members rows are
-- 'active', so no current user loses access.
--
-- This also closes the 36 policies on 13 tables that read workspace_members
-- directly (EXISTS … WHERE user_id = auth.uid()) with no status check. Their
-- subquery runs under workspace_members' own RLS, whose only seller SELECT
-- policy is is_team_member, so a suspended member's own row is invisible to it.
-- Verified with the same rolled-back test across all 16 affected tables: after
-- the change a suspended member saw exactly what an outsider sees (0 rows on
-- every table), and an active member saw exactly what they saw before.
-- That cascade holds only while workspace_members has no policy letting a user
-- read their own row unconditionally — adding one would reopen the 36 policies.
--
-- Signature, language, volatility, SECURITY DEFINER, search_path, owner and
-- grants are kept as they were, so CREATE OR REPLACE changes the body only.

CREATE OR REPLACE FUNCTION public.is_team_member(_user_id uuid, _team_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
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
$$;
