import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import {
  defaultRolePermissions,
  type TeamPermissions,
  type TeamRole,
} from "@/hooks/useTeamManagement";

async function fetchUserPermissions(): Promise<{
  permissions: TeamPermissions;
  role: TeamRole;
  teamId: string | null;
} | null> {
  const {
    data: { user },
  } = await getCurrentUser();
  if (!user) return null;

  // Get user's workspace (owned or member of)
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();

  let teamId: string | null = workspace?.id ?? null;
  if (!teamId) {
    const { data: member } = await supabase
      .from("workspace_members")
      .select("team_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    teamId = member?.team_id ?? null;
  }

  if (!teamId) {
    // No workspace yet (onboarding): grant manage_settings + manage_team so user can access Settings and Team Management
    return {
      permissions: {
        ...defaultRolePermissions.viewer,
        manage_settings: true,
        manage_team: true,
      },
      role: "viewer" as TeamRole,
      teamId: null,
    };
  }

  const { data: memberData } = await supabase
    .from("workspace_members")
    .select("role, custom_permissions")
    .eq("team_id", teamId)
    .eq("user_id", user.id)
    .maybeSingle();

  const effectiveRole: TeamRole =
    (memberData?.role as TeamRole) ??
    (workspace?.id === teamId ? "owner" : "viewer");
  const customPerms = memberData?.custom_permissions as unknown as TeamPermissions | null;
  const permissions: TeamPermissions = customPerms
    ? { ...defaultRolePermissions[effectiveRole], ...customPerms }
    : defaultRolePermissions[effectiveRole];

  return {
    permissions,
    role: effectiveRole,
    teamId,
  };
}

export function useTeamPermissions() {
  const query = useQuery({
    queryKey: ["team-permissions"],
    queryFn: fetchUserPermissions,
    staleTime: 1000 * 60 * 5,
  });

  const data = query.data;
  const permissions = data?.permissions ?? null;
  const role = data?.role ?? null;
  const teamId = data?.teamId ?? null;

  const canAccess = (permission: keyof TeamPermissions): boolean => {
    if (!permissions) return false;
    return permissions[permission] ?? false;
  };

  const canManageTeam = permissions?.manage_team ?? (role === "owner" || role === "admin");

  return {
    permissions,
    role,
    teamId,
    canAccess,
    canManageTeam,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
