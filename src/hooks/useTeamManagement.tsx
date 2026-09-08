import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import { useToast } from "@/hooks/use-toast";
import { Database } from "@/integrations/supabase/types";

// Define types based on database enums
export type TeamRole = "owner" | "admin" | "editor" | "viewer";
export type InvitationStatus = "pending" | "accepted" | "declined" | "expired";
export type MemberStatus = "active" | "suspended" | "removed";

export interface TeamPermissions {
  view_dashboard: boolean;
  view_campaigns: boolean;
  edit_campaigns: boolean;
  delete_campaigns: boolean;
  view_prospects: boolean;
  edit_prospects: boolean;
  delete_prospects: boolean;
  view_analytics: boolean;
  export_data: boolean;
  manage_team: boolean;
  manage_settings: boolean;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: TeamRole;
  status: MemberStatus;
  custom_permissions: TeamPermissions | null;
  joined_at: string;
  updated_at: string;
  // Joined data
  profile?: {
    email: string | null;
    full_name: string | null;
  };
}

export interface TeamInvitation {
  id: string;
  team_id: string;
  email: string;
  role: TeamRole;
  custom_permissions: TeamPermissions | null;
  invited_by: string;
  status: InvitationStatus;
  expires_at: string;
  created_at: string;
  // Joined data
  inviter?: {
    full_name: string | null;
    email: string | null;
  };
  team?: {
    name: string;
  };
}

export interface TeamActivityLog {
  id: string;
  team_id: string;
  user_id: string | null;
  action: string;
  target_user_id: string | null;
  target_email: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  // Joined data
  actor?: {
    full_name: string | null;
    email: string | null;
  };
}

// Default permissions for each role
export const defaultRolePermissions: Record<TeamRole, TeamPermissions> = {
  owner: {
    view_dashboard: true,
    view_campaigns: true,
    edit_campaigns: true,
    delete_campaigns: true,
    view_prospects: true,
    edit_prospects: true,
    delete_prospects: true,
    view_analytics: true,
    export_data: true,
    manage_team: true,
    manage_settings: true,
  },
  admin: {
    view_dashboard: true,
    view_campaigns: true,
    edit_campaigns: true,
    delete_campaigns: true,
    view_prospects: true,
    edit_prospects: true,
    delete_prospects: true,
    view_analytics: true,
    export_data: true,
    manage_team: true,
    manage_settings: false,
  },
  editor: {
    view_dashboard: true,
    view_campaigns: true,
    edit_campaigns: true,
    delete_campaigns: false,
    view_prospects: true,
    edit_prospects: true,
    delete_prospects: false,
    view_analytics: true,
    export_data: false,
    manage_team: false,
    manage_settings: false,
  },
  viewer: {
    view_dashboard: true,
    view_campaigns: true,
    edit_campaigns: false,
    delete_campaigns: false,
    view_prospects: true,
    edit_prospects: false,
    delete_prospects: false,
    view_analytics: true,
    export_data: false,
    manage_team: false,
    manage_settings: false,
  },
};

// Permission labels
export const permissionLabels: Record<keyof TeamPermissions, string> = {
  view_dashboard: "View Dashboard",
  view_campaigns: "View Campaigns",
  edit_campaigns: "Edit Campaigns",
  delete_campaigns: "Delete Campaigns",
  view_prospects: "View Customer Personas",
  edit_prospects: "Edit Customer Personas",
  delete_prospects: "Delete Customer Personas",
  view_analytics: "View Analytics",
  export_data: "Export data",
  manage_team: "Manage team",
  manage_settings: "Manage settings",
};

export function useTeamManagement() {
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [activityLogs, setActivityLogs] = useState<TeamActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<TeamRole | null>(null);
  const [currentUserPermissions, setCurrentUserPermissions] = useState<TeamPermissions | null>(null);
  const [receivedInvitations, setReceivedInvitations] = useState<TeamInvitation[]>([]);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchTeamData = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { user } } = await getCurrentUser();

      if (!user) {
        setLoading(false);
        return;
      }

      setCurrentUserId(user.id);
      setCurrentUserEmail(user.email ?? null);

      // Fetch user's workspace (first one they're a member of or own)
      const { data: teamData } = await supabase
        .from("workspaces")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (!teamData) {
        // No workspace yet — user must complete Onboarding Step 1.
        // Do NOT auto-create. The useOnboardingGuard hook handles this state.
        setTeam(null);
        setCurrentUserRole(null);
        setCurrentUserPermissions(null);
      } else {
        setTeam(teamData);

        // Get current user's role and custom_permissions
        const { data: memberData } = await supabase
          .from("workspace_members")
          .select("role, custom_permissions")
          .eq("team_id", teamData.id)
          .eq("user_id", user.id)
          .maybeSingle();

        const role: TeamRole = memberData
          ? (memberData.role as TeamRole)
          : teamData.owner_id === user.id
            ? "owner"
            : "viewer";
        setCurrentUserRole(role);

        // Compute effective permissions: custom_permissions override role defaults
        const customPerms = memberData?.custom_permissions as unknown as TeamPermissions | null;
        const effectivePerms: TeamPermissions = customPerms
          ? { ...defaultRolePermissions[role], ...customPerms }
          : defaultRolePermissions[role];
        setCurrentUserPermissions(effectivePerms);
      }
    } catch (error) {
      console.error("Error fetching team data:", error);
      toast({
        title: "Error",
        description: "Failed to load team data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const fetchMembers = useCallback(async () => {
    if (!team) return;

    const { data, error } = await supabase
      .from("workspace_members")
      .select("*")
      .eq("team_id", team.id)
      .order("joined_at", { ascending: true });

    if (error) {
      console.error("Error fetching members:", error);
      return;
    }

    // Fetch profiles for each member
    const memberIds = data?.map(m => m.user_id) || [];
    const { data: profiles } = await supabase
      .from("customer")
      .select("id, email, full_name")
      .in("id", memberIds);

    const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

    const membersWithProfiles: TeamMember[] = (data || []).map(member => ({
      ...member,
      role: member.role as TeamRole,
      status: member.status as MemberStatus,
      custom_permissions: member.custom_permissions as unknown as TeamPermissions | null,
      profile: profileMap.get(member.user_id) || undefined,
    }));

    setMembers(membersWithProfiles);
  }, [team]);

  const fetchInvitations = useCallback(async () => {
    if (!team) return;

    const { data, error } = await supabase
      .from("team_invitations")
      .select("*")
      .eq("team_id", team.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching invitations:", error);
      return;
    }

    // Fetch inviter profiles
    const inviterIds = [...new Set(data?.map(i => i.invited_by) || [])];
    const { data: profiles } = await supabase
      .from("customer")
      .select("id, email, full_name")
      .in("id", inviterIds);

    const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

    const invitationsWithInviters: TeamInvitation[] = (data || []).map(inv => ({
      ...inv,
      role: inv.role as TeamRole,
      status: inv.status as InvitationStatus,
      custom_permissions: inv.custom_permissions as unknown as TeamPermissions | null,
      inviter: profileMap.get(inv.invited_by) || undefined,
    }));

    setInvitations(invitationsWithInviters);
  }, [team]);

  const fetchReceivedInvitations = useCallback(async () => {
    const { data: { user } } = await getCurrentUser();
    if (!user?.email) return;

    const { data, error } = await supabase
      .from("team_invitations")
      .select("*, workspaces(name)")
      .eq("email", user.email)
      .eq("status", "pending" as InvitationStatus)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching received invitations:", error);
      return;
    }

    // Fetch inviter profiles
    const inviterIds = [...new Set(data?.map(i => i.invited_by) || [])];
    const { data: profiles } = await supabase
      .from("customer")
      .select("id, email, full_name")
      .in("id", inviterIds);

    const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

    const invitationsWithJoinedData: TeamInvitation[] = (data || []).map(inv => ({
      ...inv,
      role: inv.role as TeamRole,
      status: inv.status as InvitationStatus,
      custom_permissions: inv.custom_permissions as unknown as TeamPermissions | null,
      inviter: profileMap.get(inv.invited_by) || undefined,
      team: inv.workspaces,
    }));

    setReceivedInvitations(invitationsWithJoinedData);
  }, []);

  const fetchActivityLogs = useCallback(async () => {
    if (!team) return;

    const { data, error } = await supabase
      .from("team_activity_logs")
      .select("*")
      .eq("team_id", team.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Error fetching activity logs:", error);
      return;
    }

    // Fetch actor profiles
    const actorIds = [...new Set(data?.map(l => l.user_id).filter(Boolean) as string[])];
    const { data: profiles } = await supabase
      .from("customer")
      .select("id, email, full_name")
      .in("id", actorIds);

    const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

    const logsWithActors: TeamActivityLog[] = (data || []).map(log => ({
      ...log,
      details: log.details as Record<string, unknown> | null,
      actor: log.user_id ? profileMap.get(log.user_id) || undefined : undefined,
    }));

    setActivityLogs(logsWithActors);
  }, [team]);

  useEffect(() => {
    fetchTeamData();
  }, [fetchTeamData]);

  useEffect(() => {
    if (team) {
      fetchMembers();
      fetchInvitations();
      fetchActivityLogs();
    }
    fetchReceivedInvitations();
  }, [team, fetchMembers, fetchInvitations, fetchActivityLogs, fetchReceivedInvitations]);

  const sendInvitation = async (email: string, role: TeamRole, customPermissions?: TeamPermissions) => {
    if (!team || !currentUserId) return false;

    try {
      const insertData = {
        team_id: team.id,
        email,
        role,
        custom_permissions: customPermissions ? JSON.parse(JSON.stringify(customPermissions)) : null,
        invited_by: currentUserId,
      };

      const { error } = await supabase
        .from("team_invitations")
        .insert(insertData);

      if (error) throw error;

      // Log activity
      await supabase.from("team_activity_logs").insert({
        team_id: team.id,
        user_id: currentUserId,
        action: "invitation_sent",
        target_email: email,
        details: { role },
      });

      toast({
        title: "Invitation Sent",
        description: `Invitation sent to ${email}`,
      });

      await fetchInvitations();
      await fetchActivityLogs();
      return true;
    } catch (error) {
      console.error("Error sending invitation:", error);
      toast({
        title: "Error",
        description: "Failed to send invitation",
        variant: "destructive",
      });
      return false;
    }
  };

  const cancelInvitation = async (invitationId: string) => {
    if (!team || !currentUserId) return false;

    try {
      const invitation = invitations.find(i => i.id === invitationId);

      const { error } = await supabase
        .from("team_invitations")
        .delete()
        .eq("id", invitationId);

      if (error) throw error;

      // Log activity
      await supabase.from("team_activity_logs").insert({
        team_id: team.id,
        user_id: currentUserId,
        action: "invitation_cancelled",
        target_email: invitation?.email,
      });

      toast({
        title: "Invitation Cancelled",
        description: "The invitation has been cancelled",
      });

      await fetchInvitations();
      await fetchActivityLogs();
      return true;
    } catch (error) {
      console.error("Error cancelling invitation:", error);
      toast({
        title: "Error",
        description: "Failed to cancel invitation",
        variant: "destructive",
      });
      return false;
    }
  };

  const updateMemberRole = async (memberId: string, newRole: TeamRole) => {
    if (!team || !currentUserId) return false;

    try {
      const member = members.find(m => m.id === memberId);

      const { error } = await supabase
        .from("workspace_members")
        .update({ role: newRole })
        .eq("id", memberId);

      if (error) throw error;

      // Log activity
      await supabase.from("team_activity_logs").insert({
        team_id: team.id,
        user_id: currentUserId,
        action: "member_role_changed",
        target_user_id: member?.user_id,
        details: { old_role: member?.role, new_role: newRole },
      });

      toast({
        title: "Role Updated",
        description: "Member role has been updated",
      });

      await fetchMembers();
      await fetchActivityLogs();
      return true;
    } catch (error) {
      console.error("Error updating member role:", error);
      toast({
        title: "Error",
        description: "Failed to update member role",
        variant: "destructive",
      });
      return false;
    }
  };

  const updateMemberPermissions = async (memberId: string, permissions: TeamPermissions) => {
    if (!team || !currentUserId) return false;

    try {
      const member = members.find(m => m.id === memberId);

      const updateData = { custom_permissions: JSON.parse(JSON.stringify(permissions)) };

      const { error } = await supabase
        .from("workspace_members")
        .update(updateData)
        .eq("id", memberId);

      if (error) throw error;

      // Log activity
      await supabase.from("team_activity_logs").insert({
        team_id: team.id,
        user_id: currentUserId,
        action: "member_permissions_updated",
        target_user_id: member?.user_id,
      });

      toast({
        title: "Permissions Updated",
        description: "Member permissions have been updated",
      });

      await fetchMembers();
      await fetchActivityLogs();
      return true;
    } catch (error) {
      console.error("Error updating permissions:", error);
      toast({
        title: "Error",
        description: "Failed to update permissions",
        variant: "destructive",
      });
      return false;
    }
  };

  const suspendMember = async (memberId: string) => {
    if (!team || !currentUserId) return false;

    try {
      const member = members.find(m => m.id === memberId);

      const { error } = await supabase
        .from("workspace_members")
        .update({ status: "suspended" as MemberStatus })
        .eq("id", memberId);

      if (error) throw error;

      // Log activity
      await supabase.from("team_activity_logs").insert({
        team_id: team.id,
        user_id: currentUserId,
        action: "member_suspended",
        target_user_id: member?.user_id,
      });

      toast({
        title: "Member Suspended",
        description: "Member access has been suspended",
      });

      await fetchMembers();
      await fetchActivityLogs();
      return true;
    } catch (error) {
      console.error("Error suspending member:", error);
      toast({
        title: "Error",
        description: "Failed to suspend member",
        variant: "destructive",
      });
      return false;
    }
  };

  const reactivateMember = async (memberId: string) => {
    if (!team || !currentUserId) return false;

    try {
      const member = members.find(m => m.id === memberId);

      const { error } = await supabase
        .from("workspace_members")
        .update({ status: "active" as MemberStatus })
        .eq("id", memberId);

      if (error) throw error;

      // Log activity
      await supabase.from("team_activity_logs").insert({
        team_id: team.id,
        user_id: currentUserId,
        action: "member_reactivated",
        target_user_id: member?.user_id,
      });

      toast({
        title: "Member Reactivated",
        description: "Member access has been restored",
      });

      await fetchMembers();
      await fetchActivityLogs();
      return true;
    } catch (error) {
      console.error("Error reactivating member:", error);
      toast({
        title: "Error",
        description: "Failed to reactivate member",
        variant: "destructive",
      });
      return false;
    }
  };

  const removeMember = async (memberId: string) => {
    if (!team || !currentUserId) return false;

    try {
      const member = members.find(m => m.id === memberId);

      const { error } = await supabase
        .from("workspace_members")
        .delete()
        .eq("id", memberId);

      if (error) throw error;

      // Log activity
      await supabase.from("team_activity_logs").insert({
        team_id: team.id,
        user_id: currentUserId,
        action: "member_removed",
        target_user_id: member?.user_id,
      });

      toast({
        title: "Member Removed",
        description: "Member has been removed from the team",
      });

      await fetchMembers();
      await fetchActivityLogs();
      return true;
    } catch (error) {
      console.error("Error removing member:", error);
      toast({
        title: "Error",
        description: "Failed to remove member",
        variant: "destructive",
      });
      return false;
    }
  };

  const acceptInvitation = async (invitationId: string) => {
    if (!currentUserId || !currentUserEmail) return false;

    try {
      const invitation = receivedInvitations.find(i => i.id === invitationId);
      if (!invitation) return false;

      // 1. Update invitation status
      const { error: updateError } = await supabase
        .from("team_invitations")
        .update({ status: "accepted" as InvitationStatus })
        .eq("id", invitationId);

      if (updateError) throw updateError;

      // 2. Add to workspace_members
      const { error: memberError } = await supabase
        .from("workspace_members")
        .insert({
          team_id: invitation.team_id,
          user_id: currentUserId,
          role: invitation.role,
          custom_permissions: invitation.custom_permissions ? JSON.parse(JSON.stringify(invitation.custom_permissions)) : null,
          status: "active" as MemberStatus,
        });

      if (memberError) throw memberError;

      // 3. Log activity
      await supabase.from("team_activity_logs").insert({
        team_id: invitation.team_id,
        user_id: currentUserId,
        action: "invitation_accepted",
      });

      toast({
        title: "Invitation Accepted",
        description: `You have joined the team`,
      });

      await fetchReceivedInvitations();
      await fetchTeamData(); // Refresh to potentially show the new team if it's the only one
      return true;
    } catch (error) {
      console.error("Error accepting invitation:", error);
      toast({
        title: "Error",
        description: "Failed to accept invitation",
        variant: "destructive",
      });
      return false;
    }
  };

  const declineInvitation = async (invitationId: string) => {
    try {
      const { error } = await supabase
        .from("team_invitations")
        .update({ status: "declined" as InvitationStatus })
        .eq("id", invitationId);

      if (error) throw error;

      toast({
        title: "Invitation Declined",
        description: "The invitation has been declined",
      });

      await fetchReceivedInvitations();
      return true;
    } catch (error) {
      console.error("Error declining invitation:", error);
      toast({
        title: "Error",
        description: "Failed to decline invitation",
        variant: "destructive",
      });
      return false;
    }
  };

  const canManageTeam =
    currentUserPermissions?.manage_team ?? (currentUserRole === "owner" || currentUserRole === "admin");

  const canAccess = useCallback(
    (permission: keyof TeamPermissions): boolean => {
      return currentUserPermissions?.[permission] ?? false;
    },
    [currentUserPermissions]
  );

  return {
    team,
    members,
    invitations,
    activityLogs,
    loading,
    currentUserId,
    currentUserRole,
    currentUserPermissions,
    canManageTeam,
    canAccess,
    sendInvitation,
    cancelInvitation,
    updateMemberRole,
    updateMemberPermissions,
    suspendMember,
    reactivateMember,
    removeMember,
    refetch: () => {
      fetchMembers();
      fetchInvitations();
      fetchActivityLogs();
      fetchReceivedInvitations();
    },
    receivedInvitations,
    acceptInvitation,
    declineInvitation,
  };
}
