import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import { toast } from "sonner";

export interface UserPaymentMethod {
    id: string;
    user_id: string;
    payment_method_id: string | null;
    is_default: boolean;
    gateway_customer_id: string | null;
    gateway_payment_method_id: string | null;
    card_brand: string | null;
    card_last_four: string | null;
    card_exp_month: number | null;
    card_exp_year: number | null;
    bank_name: string | null;
    account_last_four: string | null;
    billing_details: Record<string, unknown> | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    // Joined
    payment_method?: {
        name: string;
        slug: string;
        icon_url: string | null;
    };
}

export function useUserPaymentMethods() {
    const queryClient = useQueryClient();

    const { data: paymentMethods = [], isLoading } = useQuery({
        queryKey: ["user-payment-methods"],
        queryFn: async () => {
            const {
                data: { user },
            } = await getCurrentUser();
            if (!user) return [];

            const { data, error } = await supabase
                .from("user_payment_methods")
                .select("*, payment_methods(name, slug, icon_url)")
                .eq("user_id", user.id)
                .eq("is_active", true)
                .order("is_default", { ascending: false })
                .order("created_at", { ascending: false });

            if (error) throw error;

            return (data ?? []).map((row) => ({
                ...row,
                payment_method: row.payment_methods ?? undefined,
            })) as UserPaymentMethod[];
        },
    });

    const setDefault = useMutation({
        mutationFn: async (methodId: string) => {
            const {
                data: { user },
            } = await getCurrentUser();
            if (!user) throw new Error("Not authenticated");

            // Unset all defaults first
            await supabase
                .from("user_payment_methods")
                .update({ is_default: false })
                .eq("user_id", user.id);

            // Set the selected one as default
            const { error } = await supabase
                .from("user_payment_methods")
                .update({ is_default: true })
                .eq("id", methodId);

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["user-payment-methods"] });
            toast.success("ตั้งเป็นวิธีชำระเงินหลักแล้ว");
        },
        onError: (error: Error) => {
            toast.error("เกิดข้อผิดพลาด", { description: error.message });
        },
    });

    const removeMethod = useMutation({
        mutationFn: async (methodId: string) => {
            const { error } = await supabase
                .from("user_payment_methods")
                .update({ is_active: false })
                .eq("id", methodId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["user-payment-methods"] });
            toast.success("ลบวิธีชำระเงินแล้ว");
        },
        onError: (error: Error) => {
            toast.error("เกิดข้อผิดพลาด", { description: error.message });
        },
    });

    const defaultMethod = paymentMethods.find((m) => m.is_default) ?? null;

    const addMethod = useMutation({
        mutationFn: async (cardDetails: {
            brand: string;
            last4: string;
            expMonth: number;
            expYear: number;
            name: string;
        }) => {
            const {
                data: { user },
            } = await getCurrentUser();
            if (!user) throw new Error("Not authenticated");

            const { error } = await supabase.from("user_payment_methods").insert({
                user_id: user.id,
                card_brand: cardDetails.brand,
                card_last_four: cardDetails.last4,
                card_exp_month: cardDetails.expMonth,
                card_exp_year: cardDetails.expYear,
                billing_details: { name: cardDetails.name },
                is_default: false, // Default to false, let user set it
                is_active: true,
                // In a real app, you'd integrate Stripe/Omise here to get a token
                // For now we just store the mock details
                gateway_customer_id: "cus_mock_" + Math.random().toString(36).substring(7),
                gateway_payment_method_id: "pm_mock_" + Math.random().toString(36).substring(7),
            });

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["user-payment-methods"] });
        },
        onError: (error: Error) => {
            toast.error("เกิดข้อผิดพลาดในการเพิ่มบัตร", { description: error.message });
        },
    });

    return {
        paymentMethods,
        defaultMethod,
        isLoading,
        setDefault,
        removeMethod,
        addMethod,
    };
}
