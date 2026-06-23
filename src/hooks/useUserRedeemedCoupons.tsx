import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RedeemedCoupon {
    id: string;
    user_id: string;
    reward_item_id: string;
    coupon_code: string;
    /** Canonical status from user_redeemed_coupons — 'unused' | 'used' */
    status: "unused" | "used";
    redeemed_at: string;
    /** FK to discounts row created by redeem_reward() — used for live status sync */
    discount_id: string | null;
    // Denormalized at insert time by the redeem_reward RPC
    user_email: string | null;
    customer_name: string | null;
    // Joined
    reward_item?: {
        name: string;
        description: string | null;
        points_cost: number;
        reward_type: string;
    };
    /**
     * Live status from the discounts table (if discount_id is set).
     * If the discount has been fully used (usage_count >= usage_limit) or
     * is_active=false, this will be true regardless of the status column.
     */
    discount?: {
        is_active: boolean;
        usage_count: number | null;
        usage_limit: number | null;
    } | null;
}

/** Derived: returns true if the coupon has been used, checking both sources of truth. */
export function isCouponUsed(coupon: RedeemedCoupon): boolean {
    if (coupon.status === "used") return true;
    // Also check if the discount row has been exhausted
    if (coupon.discount) {
        const { is_active, usage_count, usage_limit } = coupon.discount;
        if (!is_active) return true;
        if (usage_limit != null && usage_count != null && usage_count >= usage_limit) return true;
    }
    return false;
}

// ─── Customer Hook ────────────────────────────────────────────────────────────

/**
 * Fetches the current (logged-in) customer's redeemed coupons.
 * Joins the discounts table via discount_id to get live coupon status.
 * RLS guarantees only their own rows are returned.
 */
export function useUserRedeemedCoupons() {
    return useQuery({
        queryKey: ["user-redeemed-coupons"],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return [];

            const { data, error } = await supabase
                .from("user_redeemed_coupons")
                .select(`
                    *,
                    reward_item:reward_items (
                        name,
                        description,
                        points_cost,
                        reward_type
                    ),
                    discount:discounts (
                        is_active,
                        usage_count,
                        usage_limit
                    )
                `)
                .eq("user_id", user.id)
                .order("redeemed_at", { ascending: false });

            if (error) {
                console.error("[useUserRedeemedCoupons] Error:", error);
                return [];
            }
            return (data as RedeemedCoupon[]) ?? [];
        },
    });
}

// ─── Admin Hook ───────────────────────────────────────────────────────────────

/**
 * Admin-only: fetches ALL redeemed coupons across every customer.
 * Uses denormalized user_email + customer_name columns written by the RPC
 * so no complex auth.users join is required.
 * Also joins discounts for live status.
 * RLS allows employees to SELECT all rows.
 */
export function useAllRedeemedCoupons() {
    return useQuery({
        queryKey: ["admin-all-redeemed-coupons"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("user_redeemed_coupons")
                .select(`
                    *,
                    reward_item:reward_items (
                        name,
                        description,
                        points_cost,
                        reward_type
                    ),
                    discount:discounts (
                        is_active,
                        usage_count,
                        usage_limit
                    )
                `)
                .order("redeemed_at", { ascending: false });

            if (error) {
                console.error("[useAllRedeemedCoupons] Error:", error);
                throw error;
            }
            return (data as RedeemedCoupon[]) ?? [];
        },
    });
}
