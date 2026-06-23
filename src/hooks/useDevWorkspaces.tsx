import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Team {
    id: string;
    name: string;
    description: string | null;
    logo_url: string | null;
    workspace_url: string | null;
    status: string | null;
    created_at: string;
    owner_id: string;
    business_type_id: string | null;
    industries_id: string | null;
    business_types?: { name: string } | null;
    industries?: { name: string } | null;
}

export interface WorkspaceStats {
    [teamId: string]: {
        memberCount: number;
        adAccountCount: number;
    };
}

export interface WorkspaceMember {
    id: string;
    user_id: string;
    team_id: string;
    role: string;
    status: string;
    joined_at: string;
    profile?: {
        id: string;
        full_name: string | null;
        email: string | null;
    } | null;
}

export interface AdAccount {
    id: string;
    team_id: string;
    account_name: string;
    platform_id: string | null;
    is_active: boolean | null;
    platform_account_id: string | null;
    created_at: string;
    platforms?: {
        name: string | null;
        icon_url: string | null;
    } | null;
}

export function useDevWorkspaces() {
    return useQuery({
        queryKey: ["dev-workspaces"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("workspaces")
                .select(`
          *,
          business_types:business_type_id (name),
          industries:industries_id (name)
        `)
                .order("created_at", { ascending: false });

            if (error) throw error;
            return data as Team[];
        },
    });
}

export function useDevWorkspaceStats() {
    return useQuery({
        queryKey: ["dev-workspace-stats"],
        queryFn: async () => {
            const [membersRes, adAccountsRes] = await Promise.all([
                supabase.from("workspace_members").select("team_id"),
                supabase.from("ad_accounts").select("team_id"),
            ]);

            const stats: WorkspaceStats = {};

            (membersRes.data ?? []).forEach((m: { team_id: string }) => {
                if (!stats[m.team_id]) stats[m.team_id] = { memberCount: 0, adAccountCount: 0 };
                stats[m.team_id].memberCount++;
            });

            (adAccountsRes.data ?? []).forEach((a: { team_id: string }) => {
                if (!stats[a.team_id]) stats[a.team_id] = { memberCount: 0, adAccountCount: 0 };
                stats[a.team_id].adAccountCount++;
            });

            return stats;
        },
    });
}

export function useDevWorkspaceMembers(workspaceId: string | null, enabled: boolean) {
    return useQuery({
        queryKey: ["dev-workspace-members", workspaceId],
        enabled: enabled && !!workspaceId,
        queryFn: async () => {
            const { data, error } = await supabase
                .from("workspace_members")
                .select("*")
                .eq("team_id", workspaceId!)
                .order("joined_at", { ascending: false });

            if (error) throw error;
            return data as WorkspaceMember[];
        },
    });
}

export function useDevWorkspaceAdAccounts(workspaceId: string | null, enabled: boolean) {
    return useQuery({
        queryKey: ["dev-workspace-ad-accounts", workspaceId],
        enabled: enabled && !!workspaceId,
        queryFn: async () => {
            const { data, error } = await supabase
                .from("ad_accounts")
                .select("*, platforms:platform_id (name, icon_url)")
                .eq("team_id", workspaceId!)
                .order("created_at", { ascending: false });

            if (error) throw error;
            return data as AdAccount[];
        },
    });
}

export function useToggleAdAccount() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
            const { error } = await supabase
                .from("ad_accounts")
                .update({ is_active: isActive })
                .eq("id", id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["dev-workspace-ad-accounts"] });
            toast.success("Ad account updated");
        },
        onError: (err) => {
            toast.error(err.message ?? "Failed to update ad account");
        },
    });
}

export function useUpdateWorkspaceStatus() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, status }: { id: string; status: string }) => {
            const { error } = await supabase
                .from("workspaces")
                .update({ status })
                .eq("id", id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["dev-workspaces"] });
            toast.success("Workspace status updated");
        },
        onError: (err) => {
            toast.error(err.message ?? "Failed to update workspace status");
        },
    });
}
