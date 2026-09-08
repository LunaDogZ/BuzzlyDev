import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import { toast } from "sonner";
import { auditReward } from "@/lib/auditLogger";
import { type RewardItem } from "./useRewardsManagement";
import { type ActivityCode } from "./useActivityCodes";

export interface CustomerLoyaltyStats {
    id: string;
    point_balance: number;
    tier_name: string;
    total_points_earned: number;
}

export function useCustomerRewards() {
    const queryClient = useQueryClient();

    const activeCatalogQuery = useQuery({
        queryKey: ["customer-rewards-catalog"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("reward_items")
                .select("*")
                .eq("is_active", true)
                .order("points_cost", { ascending: true });

            if (error) throw error;
            return (data as unknown as RewardItem[]) ?? [];
        },
    });

    const activeCampaignsQuery = useQuery({
        queryKey: ["customer-active-campaigns"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("loyalty_activity_codes")
                .select("*")
                .eq("is_active", true)
                .order("reward_points", { ascending: false });

            if (error) throw error;
            return (data as unknown as ActivityCode[]) ?? [];
        },
    });

    const customerStatsQuery = useQuery({
        queryKey: ["customer-loyalty-stats"],
        queryFn: async () => {
            const { data: { user } } = await getCurrentUser();
            if (!user) return null;

            const { data: profile } = await supabase
                .from("profile_customers")
                .select(`
          loyalty_points (
            id,
            point_balance,
            total_points_earned,
            loyalty_tiers (name)
          )
        `)
                .eq("user_id", user.id)
                .maybeSingle();

            if (!profile?.loyalty_points) return null;

            const lpInfo = Array.isArray(profile.loyalty_points) ? profile.loyalty_points[0] : profile.loyalty_points;

            return {
                id: lpInfo.id,
                point_balance: lpInfo.point_balance ?? 0,
                total_points_earned: lpInfo.total_points_earned ?? 0,
                tier_name: lpInfo.loyalty_tiers?.name ?? "Bronze",
            } as CustomerLoyaltyStats;
        },
    });

    const redeemReward = useMutation({
        mutationFn: async (rewardItem: RewardItem) => {
            const { data, error } = await supabase.rpc("redeem_reward", {
                p_reward_item_id: rewardItem.id,
            });

            if (error) {
                // Map RPC exception messages to user-friendly Thai strings
                const msg = error.message ?? "";
                if (msg.includes("insufficient_points")) throw new Error("คะแนนสะสมไม่เพียงพอ");
                if (msg.includes("out_of_stock")) throw new Error("ของรางวัลชิ้นนี้หมดแล้ว");
                if (msg.includes("reward_not_found")) throw new Error("ไม่พบของรางวัลนี้");
                if (msg.includes("loyalty_points_not_found")) throw new Error("ไม่พบข้อมูลคะแนนสะสม");
                if (msg.includes("not_authenticated")) throw new Error("กรุณาเข้าสู่ระบบก่อน");
                throw error;
            }

            const { data: { user } } = await getCurrentUser();
            if (user) auditReward.customerRedeemed(user.id, rewardItem.id, rewardItem.name);
            return data as { success: boolean; new_balance: number; coupon_code?: string };
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["customer-loyalty-stats"] });
            queryClient.invalidateQueries({ queryKey: ["customer-rewards-catalog"] });
            window.dispatchEvent(new CustomEvent('loyalty-refetch'));
            // Toast is now handled by RewardsCenterModal which has access to coupon_code
        },
        onError: (error: Error) => {
            toast.error("เกิดข้อผิดพลาดในการแลกของรางวัล", { description: error.message });
        },
    });

    const completedRulesQuery = useQuery({
        queryKey: ["customer-completed-rules"],
        queryFn: async () => {
            const { data: { user } } = await getCurrentUser();
            if (!user) return [];

            const { data, error } = await supabase
                .from("loyalty_mission_completions")
                .select("action_type")
                .eq("user_id", user.id);

            if (error) throw error;

            // Group by action_type to get times_completed
            const actionCounts: Record<string, number> = {};
            data.forEach(row => {
                actionCounts[row.action_type] = (actionCounts[row.action_type] || 0) + 1;
            });

            return Object.entries(actionCounts).map(([action_code, times_completed]) => ({
                action_code,
                times_completed,
            }));
        },
    });

    // Listen for global loyalty refetch events
    useEffect(() => {
        const handleRefetch = async () => {
            console.log("[useCustomerRewards] Global refetch triggered");
            // Force immediate refetch
            await Promise.all([
                queryClient.refetchQueries({ queryKey: ["customer-loyalty-stats"] }),
                queryClient.refetchQueries({ queryKey: ["customer-completed-rules"] })
            ]);
        };
        window.addEventListener('loyalty-refetch', handleRefetch);
        return () => window.removeEventListener('loyalty-refetch', handleRefetch);
    }, [queryClient]);

    return {
        catalog: activeCatalogQuery,
        campaigns: activeCampaignsQuery,
        stats: customerStatsQuery,
        completedRules: completedRulesQuery,
        redeemReward,
    };
}
