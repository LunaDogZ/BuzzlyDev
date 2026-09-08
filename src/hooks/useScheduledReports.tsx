import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { fetchCurrentWorkspaceId } from '@/hooks/useWorkspace';
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import { useToast } from "@/hooks/use-toast";

export interface ScheduledReport {
    id: string;
    team_id: string;
    report_id: string | null;
    name: string;
    frequency: "daily" | "weekly" | "monthly";
    recipients: string[];
    next_run_at: string | null;
    last_run_at: string | null;
    is_active: boolean;
    format: "pdf" | "csv" | "excel";
    created_by: string | null;
    created_at: string;
    updated_at: string;
    // joined
    report_name?: string | null;
    report_type?: string | null;
}

export interface CreateScheduledReportInput {
    name: string;
    frequency: "daily" | "weekly" | "monthly";
    recipients: string[];
    format?: "pdf" | "csv" | "excel";
    report_id?: string | null;
    next_run_at?: string | null;
}

/** Delegates to the one shared workspace read; see `fetchCurrentWorkspaceId`.
 *  This copy used to run its own two queries per mount. */
async function getTeamId(queryClient: QueryClient): Promise<string | null> {
    return fetchCurrentWorkspaceId(queryClient);
}

export function useScheduledReports() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const { data: scheduledReports = [], isLoading } = useQuery({
        queryKey: ["scheduled-reports"],
        queryFn: async () => {
            const teamId = await getTeamId(queryClient);
            console.log("ScheduledReports - getTeamId returned:", teamId);
            if (!teamId) return [];

            const { data, error } = await supabase
                .from("scheduled_reports")
                .select(`
          *,
          reports(name, report_type)
        `)
                .eq("team_id", teamId)
                .order("created_at", { ascending: false });

            console.log("ScheduledReports - Select Data:", data?.length, "Error:", error);

            if (error) throw error;

            return (data ?? []).map((r) => ({
                ...r,
                recipients: Array.isArray(r.recipients) ? r.recipients : [],
                report_name: r.reports?.name ?? null,
                report_type: r.reports?.report_type ?? null,
            })) as ScheduledReport[];
        },
    });

    const createScheduledReport = useMutation({
        mutationFn: async (input: CreateScheduledReportInput) => {
            const teamId = await getTeamId(queryClient);
            if (!teamId) throw new Error("No team found");
            const { data: { user } } = await getCurrentUser();

            console.log("ScheduledReports - Creating...", { teamId, user: user?.id, input });

            const { data, error } = await supabase
                .from("scheduled_reports")
                .insert({
                    team_id: teamId,
                    created_by: user?.id,
                    name: input.name,
                    frequency: input.frequency,
                    recipients: input.recipients,
                    format: input.format ?? "pdf",
                    report_id: input.report_id ?? null,
                    next_run_at: input.next_run_at ?? null,
                })
                .select()
                .single();

            console.log("ScheduledReports - Insert Result:", data, "Error:", error);

            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["scheduled-reports"] });
            toast({ title: "Success", description: "Report schedule created" });
        },
        onError: (err) => {
            console.error("Schedule creation failed:", err);
            toast({ variant: "destructive", title: "Error", description: err.message ?? "Failed to create schedule" });
        },
    });

    const toggleActive = useMutation({
        mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
            const { error } = await supabase
                .from("scheduled_reports")
                .update({ is_active, updated_at: new Date().toISOString() })
                .eq("id", id);
            if (error) throw error;
        },
        onSuccess: (_, { is_active }) => {
            queryClient.invalidateQueries({ queryKey: ["scheduled-reports"] });
            toast({ title: "Status Updated", description: is_active ? "Schedule activated" : "Schedule paused" });
        },
        onError: (err) => {
            toast({ variant: "destructive", title: "Error", description: err.message ?? "Failed to update schedule" });
        },
    });

    const deleteScheduledReport = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.from("scheduled_reports").delete().eq("id", id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["scheduled-reports"] });
            toast({ title: "Deleted", description: "Schedule deleted successfully" });
        },
        onError: (err) => {
            toast({ variant: "destructive", title: "Error", description: err.message ?? "Failed to delete schedule" });
        },
    });

    const updateRecipients = useMutation({
        mutationFn: async ({ id, recipients }: { id: string; recipients: string[] }) => {
            const { error } = await supabase
                .from("scheduled_reports")
                .update({ recipients, updated_at: new Date().toISOString() })
                .eq("id", id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["scheduled-reports"] });
            toast({ title: "Updated", description: "Recipients updated successfully" });
        },
        onError: (err) => {
            toast({ variant: "destructive", title: "Error", description: err.message ?? "Failed to update recipients" });
        },
    });

    return {
        scheduledReports,
        isLoading,
        createScheduledReport,
        toggleActive,
        deleteScheduledReport,
        updateRecipients,
    };
}
