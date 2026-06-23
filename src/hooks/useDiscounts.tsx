import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { auditDiscount } from "@/lib/auditLogger";

export interface Discount {
    id: string;
    code: string;
    name: string | null;
    discount_type: "percent" | "fixed";
    discount_value: number;
    min_order_value: number;
    max_discount_amount: number | null;
    usage_limit: number | null;
    usage_count: number;
    start_date: string | null;
    end_date: string | null;
    is_active: boolean;
    description: string | null;
    created_by: string | null;
    published_at: string | null;
    collections_count: number;
    created_at: string;
    updated_at: string;
}

export interface CreateDiscountInput {
    code: string;
    name?: string;
    discount_type: "percent" | "fixed";
    discount_value: number;
    min_order_value?: number;
    max_discount_amount?: number | null;
    usage_limit?: number | null;
    start_date?: string | null;
    end_date?: string | null;
    description?: string;
}

export function useDiscounts() {
    const queryClient = useQueryClient();

    const { data: discounts = [], isLoading } = useQuery({
        queryKey: ["discounts"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("discounts")
                .select(`
                    *,
                    customer_coupons (count)
                `)
                .order("created_at", { ascending: false });

            if (error) throw error;

            return (data ?? []).map((d) => ({
                ...d,
                discount_value: Number(d.discount_value),
                min_order_value: Number(d.min_order_value ?? 0),
                max_discount_amount: d.max_discount_amount ? Number(d.max_discount_amount) : null,
                collections_count: d.customer_coupons?.[0]?.count ?? 0,
            })) as Discount[];
        },
    });

    const createDiscount = useMutation({
        mutationFn: async (input: CreateDiscountInput) => {
            const { data: { user } } = await supabase.auth.getUser();

            const { data, error } = await supabase
                .from("discounts")
                .insert({
                    created_by: user?.id,
                    code: input.code.toUpperCase(),
                    name: input.name ?? null,
                    discount_type: input.discount_type,
                    discount_value: input.discount_value,
                    min_order_value: input.min_order_value ?? 0,
                    max_discount_amount: input.max_discount_amount ?? null,
                    usage_limit: input.usage_limit ?? null,
                    start_date: input.start_date ?? null,
                    end_date: input.end_date ?? null,
                    description: input.description ?? null,
                })
                .select()
                .single();

            if (error) throw error;
            if (user) auditDiscount.supportCreated(user.id, input.code.toUpperCase(), data?.id);
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["discounts"] });
            toast.success("Discount code created");
        },
        onError: (err) => {
            toast.error(err.message ?? "Failed to create discount");
        },
    });

    const updateDiscount = useMutation({
        mutationFn: async ({ id, updates }: { id: string; updates: Partial<CreateDiscountInput> }) => {
            const { error } = await supabase
                .from("discounts")
                .update({ ...updates, updated_at: new Date().toISOString() })
                .eq("id", id);
            if (error) throw error;
            const { data: { user } } = await supabase.auth.getUser();
            if (user) auditDiscount.supportUpdated(user.id, id, updates.code);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["discounts"] });
            toast.success("Discount updated");
        },
        onError: (err) => {
            toast.error(err.message ?? "Failed to update discount");
        },
    });

    const deleteDiscount = useMutation({
        mutationFn: async (id: string) => {
            const { data: existing } = await supabase.from("discounts").select("code").eq("id", id).single();
            const { error } = await supabase.from("discounts").delete().eq("id", id);
            if (error) throw error;
            const { data: { user } } = await supabase.auth.getUser();
            if (user) auditDiscount.supportDeleted(user.id, id, existing?.code);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["discounts"] });
            toast.success("Discount deleted");
        },
        onError: (err) => {
            toast.error(err.message ?? "Failed to delete discount");
        },
    });

    const toggleActive = useMutation({
        mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
            const { data: existing } = await supabase.from("discounts").select("code").eq("id", id).single();
            const { error } = await supabase
                .from("discounts")
                .update({ is_active, updated_at: new Date().toISOString() })
                .eq("id", id);
            if (error) throw error;
            const { data: { user } } = await supabase.auth.getUser();
            if (user) auditDiscount.supportToggled(user.id, id, is_active, existing?.code);
        },
        onSuccess: (_, { is_active }) => {
            queryClient.invalidateQueries({ queryKey: ["discounts"] });
            toast.success(is_active ? "Discount activated" : "Discount deactivated");
        },
        onError: (err) => {
            toast.error(err.message ?? "Failed to update discount status");
        },
    });

    const publishDiscount = useMutation({
        mutationFn: async (id: string) => {
            const { data: existing } = await supabase.from("discounts").select("code").eq("id", id).single();
            const { error } = await supabase
                .from("discounts")
                .update({ published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                .eq("id", id);
            if (error) throw error;
            const { data: { user } } = await supabase.auth.getUser();
            if (user) auditDiscount.supportPublished(user.id, id, existing?.code);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["discounts"] });
            toast.success("Discount published! Notifications sent to customers.");
        },
        onError: (err) => {
            toast.error(err.message ?? "Failed to publish discount");
        },
    });

    // Computed stats
    const draftDiscounts = discounts.filter((d) => !d.published_at);
    const liveDiscounts = discounts.filter((d) => d.published_at);
    const activeDiscounts = liveDiscounts.filter((d) => d.is_active);
    const expiredDiscounts = liveDiscounts.filter(
        (d) => d.end_date && new Date(d.end_date) < new Date()
    );
    const exhaustedDiscounts = liveDiscounts.filter(
        (d) => d.usage_limit !== null && d.collections_count >= d.usage_limit
    );

    const ongoingDiscounts = liveDiscounts.filter((d) => {
        const isExpired = d.end_date && new Date(d.end_date) < new Date();
        const isExhausted = d.usage_limit !== null && d.collections_count >= d.usage_limit;
        return d.is_active && !isExpired && !isExhausted;
    });

    const endedDiscounts = liveDiscounts.filter((d) => {
        const isExpired = d.end_date && new Date(d.end_date) < new Date();
        const isExhausted = d.usage_limit !== null && d.collections_count >= d.usage_limit;
        return !d.is_active || isExpired || isExhausted;
    });

    return {
        discounts,
        isLoading,
        draftDiscounts,
        liveDiscounts,
        activeDiscounts,
        expiredDiscounts,
        exhaustedDiscounts,
        ongoingDiscounts,
        endedDiscounts,
        createDiscount,
        updateDiscount,
        deleteDiscount,
        toggleActive,
        publishDiscount,
    };
}
