import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { fetchCurrentWorkspaceId } from '@/hooks/useWorkspace';
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import { toast } from "sonner";

export type WorkspaceMemberRole = "owner" | "admin" | "editor" | "viewer";
export type WorkspaceMemberStatus = "active" | "pending" | "suspended";

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string | null;
  email: string;
  fullName: string | null;
  role: WorkspaceMemberRole;
  status: WorkspaceMemberStatus;
  invitedBy: string | null;
  inviterName: string;
  joinedAt: string | null;
  invitedAt: string;
  workspaceName: string;
}

/** Delegates to the one shared workspace read; see `fetchCurrentWorkspaceId`.
 *  This copy used to run its own two queries per mount. */
async function getWorkspaceId(queryClient: QueryClient): Promise<string | null> {
    return fetchCurrentWorkspaceId(queryClient);
}

export function useWorkspaceMembers() {
  const queryClient = useQueryClient();

  const { data: members = [], isLoading, error } = useQuery({
    queryKey: ["workspace-members-list"],
    queryFn: async () => {
      const workspaceId = await getWorkspaceId(queryClient);
      if (!workspaceId) return [];

      // Fetch workspace info
      const { data: wsData } = await supabase
        .from("workspaces")
        .select("name")
        .eq("id", workspaceId)
        .maybeSingle();

      const workspaceName = wsData?.name ?? "Workspace";

      // Fetch members
      const { data: membersData, error: membersError } = await supabase
        .from("workspace_members")
        .select("*")
        .eq("team_id", workspaceId)
        .order("joined_at", { ascending: true });

      if (membersError) throw membersError;

      type MemberRow = NonNullable<typeof membersData>[number] & {
        email?: string | null;
        invited_by?: string | null;
        created_at?: string | null;
      };
      const members = (membersData ?? []) as MemberRow[];

      // Fetch customer profiles for each member
      const userIds = members
        .map((m) => m.user_id)
        .filter(Boolean) as string[];

      const profileMap = new Map<
        string,
        { full_name: string | null; email: string | null }
      >();

      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("customer")
          .select("id, full_name, email")
          .in("id", userIds);

        (profiles ?? []).forEach((p) => profileMap.set(p.id, p));
      }

      // Fetch inviter names
      const inviterIds = [
        ...new Set(
          members
            .map((m) => m.invited_by)
            .filter(Boolean) as string[]
        ),
      ];

      const inviterMap = new Map<string, string>();
      if (inviterIds.length > 0) {
        const { data: inviters } = await supabase
          .from("customer")
          .select("id, full_name, email")
          .in("id", inviterIds);

        (inviters ?? []).forEach((p) =>
          inviterMap.set(p.id, p.full_name ?? p.email ?? "Unknown")
        );
      }

      return members.map((m): WorkspaceMember => {
        const profile = m.user_id ? profileMap.get(m.user_id) : null;
        return {
          id: m.id,
          workspace_id: m.team_id,
          user_id: m.user_id ?? null,
          email: profile?.email ?? m.email ?? "",
          fullName: profile?.full_name ?? null,
          role: (m.role as WorkspaceMemberRole) ?? "editor",
          status: (m.status as WorkspaceMemberStatus) ?? "active",
          invitedBy: m.invited_by ?? null,
          inviterName: m.invited_by
            ? (inviterMap.get(m.invited_by) ?? "Unknown")
            : "ระบบ",
          joinedAt: m.joined_at ?? null,
          invitedAt: m.created_at ?? new Date().toISOString(),
          workspaceName,
        };
      });
    },
  });

  const inviteMember = useMutation({
    mutationFn: async ({
      email,
      role,
    }: {
      email: string;
      role: WorkspaceMemberRole;
    }) => {
      const {
        data: { user },
      } = await getCurrentUser();
      if (!user) throw new Error("Not authenticated");

      const workspaceId = await getWorkspaceId(queryClient);
      if (!workspaceId) throw new Error("No workspace found");

      const { error } = await supabase.from("team_invitations").insert({
        team_id: workspaceId,
        email,
        role,
        invited_by: user.id,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-members-list"] });
      toast.success("ส่งคำเชิญสำเร็จ");
    },
    onError: (error: Error) => {
      toast.error("ไม่สามารถส่งคำเชิญได้", { description: error.message });
    },
  });

  const suspendMember = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("workspace_members")
        .update({ status: "suspended" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-members-list"] });
      toast.success("ระงับสมาชิกสำเร็จ");
    },
    onError: (error: Error) => {
      toast.error("เกิดข้อผิดพลาด", { description: error.message });
    },
  });

  const reactivateMember = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("workspace_members")
        .update({ status: "active" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-members-list"] });
      toast.success("เปิดใช้งานสมาชิกอีกครั้ง");
    },
    onError: (error: Error) => {
      toast.error("เกิดข้อผิดพลาด", { description: error.message });
    },
  });

  const removeMember = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("workspace_members")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-members-list"] });
      toast.success("นำสมาชิกออกสำเร็จ");
    },
    onError: (error: Error) => {
      toast.error("เกิดข้อผิดพลาด", { description: error.message });
    },
  });

  return {
    members,
    isLoading,
    error,
    inviteMember,
    suspendMember,
    reactivateMember,
    removeMember,
  };
}
