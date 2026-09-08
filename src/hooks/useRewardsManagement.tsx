import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import { toast } from "sonner";
import { auditReward } from "@/lib/auditLogger";

export interface RewardItem {
    id: string;
    name: string;
    description: string | null;
    reward_type: string;
    points_cost: number;
    stock_quantity: number | null;
    image_url: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string | null;
}

export function useRewardsManagement() {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ["rewards-management"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("reward_items")
                .select("*")
                .order("created_at", { ascending: false })
                .order("id", { ascending: true });

            if (error) {
                toast.error("An error occurred while fetching rewards catalog", {
                    description: error.message
                });
                throw error;
            }
            return (data as unknown as RewardItem[]) ?? [];
        },
    });

    const toggleRewardStatus = useMutation({
        mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
            const { data: existing } = await supabase.from("reward_items").select("name").eq("id", id).single();
            const { error } = await supabase
                .from("reward_items")
                .update({ is_active })
                .eq("id", id);
            if (error) throw error;
            const { data: { user } } = await getCurrentUser();
            if (user) auditReward.supportToggled(user.id, id, is_active, existing?.name);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["rewards-management"] });
        },
        onError: (error: Error) => {
            toast.error("เกิดข้อผิดพลาดในการเปลี่ยนสถานะ", { description: error.message });
        },
    });

    const createRewardItem = useMutation({
        mutationFn: async (item: {
            name: string;
            description: string | null;
            reward_type: string;
            points_cost: number;
            stock_quantity: number | null;
            image_url: string | null;
            is_active: boolean;
        }) => {
            const { data: created, error } = await supabase.from("reward_items").insert(item).select("id").single();
            if (error) throw error;
            const { data: { user } } = await getCurrentUser();
            if (user) auditReward.supportCreated(user.id, item.name, created?.id);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["rewards-management"] });
            toast.success("เพิ่มของรางวัลสำเร็จ");
        },
        onError: (error: Error) => {
            toast.error("ไม่สามารถเพิ่มของรางวัลได้", { description: error.message });
        },
    });

    const updateRewardItem = useMutation({
        mutationFn: async (item: {
            id: string;
            name: string;
            description: string | null;
            reward_type: string;
            points_cost: number;
            stock_quantity: number | null;
            image_url: string | null;
            is_active: boolean;
        }) => {
            const { id, ...updates } = item;
            const { error } = await supabase
                .from("reward_items")
                .update(updates)
                .eq("id", id);
            if (error) throw error;
            const { data: { user } } = await getCurrentUser();
            if (user) auditReward.supportUpdated(user.id, id, item.name);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["rewards-management"] });
            toast.success("อัปเดตของรางวัลสำเร็จ");
        },
        onError: (error: Error) => {
            toast.error("เกิดข้อผิดพลาดในการอัปเดต", { description: error.message });
        },
    });

    const deleteRewardItem = useMutation({
        mutationFn: async (id: string) => {
            const { data: existing } = await supabase.from("reward_items").select("name").eq("id", id).single();
            const { error } = await supabase.from("reward_items").delete().eq("id", id);
            if (error) throw error;
            const { data: { user } } = await getCurrentUser();
            if (user) auditReward.supportDeleted(user.id, id, existing?.name);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["rewards-management"] });
            toast.success("ลบของรางวัลสำเร็จ");
        },
        onError: (error: Error) => {
            toast.error("ไม่สามารถลบของรางวัลได้", { description: error.message });
        },
    });

    return {
        ...query,
        toggleRewardStatus,
        createRewardItem,
        updateRewardItem,
        deleteRewardItem,
    };
}
