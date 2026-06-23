import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Budget {
    id: string;
    team_id: string;
    campaign_id: string | null;
    name: string;
    budget_type: "daily" | "monthly" | "lifetime";
    amount: number;
    spent_amount: number;
    remaining_amount: number;
    currency: string;
    start_date: string | null;
    end_date: string | null;
    alert_threshold_percent: number;
    is_active: boolean;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    // joined
    campaign_name?: string | null;
}

export interface CreateBudgetInput {
    name: string;
    budget_type: "daily" | "monthly" | "lifetime";
    amount: number;
    campaign_id?: string | null;
    currency?: string;
    start_date?: string | null;
    end_date?: string | null;
    alert_threshold_percent?: number;
}

async function getTeamId(): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
        .from("workspaces")
        .select("id")
        .eq("owner_id", user.id)
        .maybeSingle();
    if (data) return data.id;
    const { data: member } = await supabase
        .from("workspace_members")
        .select("team_id")
        .eq("user_id", user.id)
        .maybeSingle();
    return member?.team_id ?? null;
}

export function useBudgets() {
    const queryClient = useQueryClient();

    const { data: budgets = [], isLoading } = useQuery({
        queryKey: ["budgets"],
        queryFn: async () => {
            const teamId = await getTeamId();
            if (!teamId) return [];

            const { data, error } = await supabase
                .from("budgets")
                .select(`
          *,
          campaigns(name)
        `)
                .eq("team_id", teamId)
                .order("created_at", { ascending: false });

            if (error) throw error;

            return (data ?? []).map((b) => ({
                ...b,
                campaign_name: b.campaigns?.name ?? null,
                amount: Number(b.amount),
                spent_amount: Number(b.spent_amount),
                remaining_amount: Number(b.remaining_amount ?? (b.amount - b.spent_amount)),
            })) as Budget[];
        },
    });

    const createBudget = useMutation({
        mutationFn: async (input: CreateBudgetInput) => {
            const teamId = await getTeamId();
            if (!teamId) throw new Error("No team found");
            const { data: { user } } = await supabase.auth.getUser();

            const { data, error } = await supabase
                .from("budgets")
                .insert({
                    team_id: teamId,
                    created_by: user?.id,
                    name: input.name,
                    budget_type: input.budget_type,
                    amount: input.amount,
                    campaign_id: input.campaign_id ?? null,
                    currency: input.currency ?? "THB",
                    start_date: input.start_date ?? null,
                    end_date: input.end_date ?? null,
                    alert_threshold_percent: input.alert_threshold_percent ?? 80,
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["budgets"] });
            toast.success("Budget created successfully");
        },
        onError: (err) => {
            toast.error(err.message ?? "Failed to create budget");
        },
    });

    const updateBudget = useMutation({
        mutationFn: async ({ id, updates }: { id: string; updates: Partial<CreateBudgetInput> }) => {
            const { error } = await supabase
                .from("budgets")
                .update({ ...updates, updated_at: new Date().toISOString() })
                .eq("id", id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["budgets"] });
            toast.success("Budget updated");
        },
        onError: (err) => {
            toast.error(err.message ?? "Failed to update budget");
        },
    });

    const deleteBudget = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.from("budgets").delete().eq("id", id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["budgets"] });
            toast.success("Budget deleted");
        },
        onError: (err) => {
            toast.error(err.message ?? "Failed to delete budget");
        },
    });

    const toggleActive = useMutation({
        mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
            const { error } = await supabase
                .from("budgets")
                .update({ is_active, updated_at: new Date().toISOString() })
                .eq("id", id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["budgets"] });
        },
        onError: (err) => {
            toast.error(err.message ?? "Failed to update budget status");
        },
    });

    // Computed stats
    const totalBudget = budgets.reduce((sum, b) => sum + b.amount, 0);
    const totalSpent = budgets.reduce((sum, b) => sum + b.spent_amount, 0);
    const alertBudgets = budgets.filter(
        (b) => b.is_active && b.amount > 0 && (b.spent_amount / b.amount) * 100 >= b.alert_threshold_percent
    );

    return {
        budgets,
        isLoading,
        totalBudget,
        totalSpent,
        totalRemaining: totalBudget - totalSpent,
        alertBudgets,
        createBudget,
        updateBudget,
        deleteBudget,
        toggleActive,
    };
}
