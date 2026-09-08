import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import type { Json } from "@/integrations/supabase/types";
import { useWorkspace } from "@/hooks/useWorkspace";
import { toast } from "sonner";

export interface Report {
    id: string;
    team_id: string | null;
    name: string;
    description: string | null;
    report_type: string;
    date_range_type: string | null;
    start_date: string | null;
    end_date: string | null;
    filters: Record<string, unknown> | null;
    file_format: string;
    file_url: string | null;
    status: string;
    generated_at: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface CreateReportInput {
    name: string;
    report_type: string;
    description?: string;
    date_range_type?: string;
    start_date?: string;
    end_date?: string;
    filters?: Record<string, unknown>;
    file_format?: string;
    file_url?: string;
}

async function getCurrentUserAndTeam() {
    const {
        data: { user },
    } = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");

    // Get the user's workspace
    const { data: workspace } = await supabase
        .from("workspaces")
        .select("id")
        .eq("owner_id", user.id)
        .maybeSingle();

    // Fallback: check workspace_members
    if (!workspace) {
        const { data: member } = await supabase
            .from("workspace_members")
            .select("team_id")
            .eq("user_id", user.id)
            .eq("status", "active")
            .maybeSingle();
        return { userId: user.id, teamId: member?.team_id ?? null };
    }

    return { userId: user.id, teamId: workspace.id };
}

export function useReports() {
    const queryClient = useQueryClient();
    const { workspace } = useWorkspace();
    const workspaceId = workspace?.id;

    const { data: reports = [], isLoading } = useQuery({
        queryKey: ["reports", workspaceId],
        queryFn: async () => {
            const { teamId } = await getCurrentUserAndTeam();

            let query = supabase
                .from("reports")
                .select("*")
                .order("created_at", { ascending: false });

            if (teamId) {
                query = query.or(`team_id.eq.${teamId},team_id.is.null`);
            }

            const { data, error } = await query;
            if (error) throw error;
            return (data ?? []) as Report[];
        },
    });

    const createReport = useMutation({
        mutationFn: async (input: CreateReportInput) => {
            const { userId, teamId } = await getCurrentUserAndTeam();

            const { data, error } = await supabase
                .from("reports")
                .insert({
                    name: input.name,
                    report_type: input.report_type,
                    description: input.description ?? null,
                    date_range_type: input.date_range_type ?? null,
                    start_date: input.start_date ?? null,
                    end_date: input.end_date ?? null,
                    filters: (input.filters ?? null) as Json,
                    file_format: input.file_format ?? "pdf",
                    file_url: input.file_url ?? null,
                    status: "ready",
                    generated_at: new Date().toISOString(),
                    team_id: teamId,
                    created_by: userId,
                })
                .select()
                .single();

            if (error) throw error;
            return data as Report;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["reports"] });
            toast.success("Report created successfully");
        },
        onError: (error: Error) => {
            toast.error("Failed to create report", { description: error.message });
        },
    });

    const deleteReport = useMutation({
        mutationFn: async (reportId: string) => {
            const { error } = await supabase
                .from("reports")
                .delete()
                .eq("id", reportId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["reports"] });
            toast.success("Report deleted successfully");
        },
        onError: (error: Error) => {
            toast.error("Failed to delete report", { description: error.message });
        },
    });

    const updateReportFileUrl = useMutation({
        mutationFn: async ({ reportId, fileUrl }: { reportId: string; fileUrl: string }) => {
            const { error } = await supabase
                .from("reports")
                .update({ file_url: fileUrl, status: "ready" })
                .eq("id", reportId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["reports"] });
        },
    });

    return {
        reports,
        isLoading,
        createReport,
        deleteReport,
        updateReportFileUrl,
    };
}
