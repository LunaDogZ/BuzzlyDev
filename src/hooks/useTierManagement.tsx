import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { auditTier } from "@/lib/auditLogger";

// ─── Types ───────────────────────────────────────────────────────────────────

export const ADMIN_PAGE_SIZE = 8;
export const ALERTS_PAGE_SIZE = 6;

/** Row from the new loyalty_tier_history table (simple denormalized log) */
export interface LoyaltyTierHistoryEntry {
    id: string;
    profile_customer_id: string;
    old_tier: string | null;
    new_tier: string;
    changed_at: string;
    created_at?: string;
    /** 'auto' = written by system trigger; 'manual' = written by admin override */
    change_type: 'auto' | 'manual';
    change_reason?: string | null;
    changer_id?: string | null;
    // Joined
    customer?: {
        full_name?: string | null;
        email?: string | null;
        first_name?: string | null;
        last_name?: string | null;
        user_id?: string | null;
        customer_email?: string | null;
    } | null;
    changer?: { full_name: string | null; email: string | null } | null;
}


export interface TierHistoryEntry {
    id: string;
    user_id: string;
    previous_tier_id: string | null;
    new_tier_id: string;
    change_reason: string | null;
    changed_by: string | null;
    is_manual_override: boolean;
    created_at: string;
    // Joined
    customer?: { full_name: string | null; email: string | null };
    previous_tier?: { name: string; priority_level: number } | null;
    new_tier?: { name: string; priority_level: number };
    changer?: { full_name: string | null } | null;
}

export interface PointsTransaction {
    id: string;
    user_id: string;
    transaction_type: string;
    points_amount: number | null;
    balance_after: number | null;
    description: string | null;
    reference_id: string | null;
    created_at: string;
    // Joined
    customer?: { full_name: string | null; email: string | null };
}

export interface SuspiciousActivity {
    id: string;
    user_id: string;
    activity_type: string;
    severity: "low" | "medium" | "high" | "critical";
    description: string | null;
    metadata: Record<string, unknown> | null;
    is_resolved: boolean;
    resolved_by: string | null;
    resolved_at: string | null;
    resolution_notes: string | null;
    created_at: string;
    // Joined
    customer?: { full_name: string | null; email: string | null };
}

export interface CustomerSearchResult {
    id: string;
    full_name: string | null;
    email: string | null;
    loyalty_tier: string | null;
    loyalty_points_balance: number | null;
    total_spend: number | null;
    created_at: string;
}


// ─── Loyalty Tier History (new simple table) ──────────────────────────────────

export function useLoyaltyTierHistory(page = 0) {
    return useQuery({
        queryKey: ["loyalty-tier-history", page],
        queryFn: async () => {
            const from = page * ADMIN_PAGE_SIZE;
            const to = from + ADMIN_PAGE_SIZE - 1;

            // Only show auto-logged changes (change_type='auto') in the Auto-Log section.
            const { data, error } = await supabase
                .from("loyalty_tier_history")
                .select('*, customer:profile_customers!loyalty_tier_history_profile_customer_id_fkey(first_name, last_name, user_id)')
                .eq('change_type', 'auto')
                .order("changed_at", { ascending: false })
                .range(from, to);

            if (error) throw error;
            return (data as unknown as LoyaltyTierHistoryEntry[]) ?? [];
        },
        placeholderData: keepPreviousData,
    });
}

// ─── Loyalty Tier History (All: Auto + Manual) — via RPC (bulletproof) ────────

/** Fetch tier history via RPC — bypasses RLS/PostgREST, guaranteed to work */
const TIER_HISTORY_MAX_FETCH = 150;

export function useLoyaltyTierHistoryAll(limit = TIER_HISTORY_MAX_FETCH) {
    return useQuery({
        queryKey: ["loyalty-tier-history-all", limit],
        queryFn: async () => {
            const { data, error } = await supabase.rpc("get_tier_history_for_support", {
                p_limit: limit,
                p_offset: 0,
            });

            if (error) throw error;

            const rows = (data ?? []) as Array<{
                id: string;
                profile_customer_id: string;
                old_tier: string | null;
                new_tier: string;
                changed_at: string;
                change_type: string;
                change_reason: string | null;
                changer_id: string | null;
                customer_first_name: string | null;
                customer_last_name: string | null;
                customer_user_id: string | null;
                customer_email: string | null;
            }>;

            return rows.map((r) => ({
                id: r.id,
                profile_customer_id: r.profile_customer_id,
                old_tier: r.old_tier,
                new_tier: r.new_tier,
                changed_at: r.changed_at,
                change_type: (r.change_type === "manual" ? "manual" : "auto") as "auto" | "manual",
                change_reason: r.change_reason,
                changer_id: r.changer_id,
                customer: {
                    first_name: r.customer_first_name,
                    last_name: r.customer_last_name,
                    user_id: r.customer_user_id,
                    email: r.customer_email,
                },
            })) as LoyaltyTierHistoryEntry[];
        },
        placeholderData: keepPreviousData,
    });
}

// ─── Loyalty Tier History (Manual Overrides) ──────────────────────────────────

export function useLoyaltyTierHistoryManual(page = 0) {
    return useQuery({
        queryKey: ["loyalty-tier-history-manual", page],
        queryFn: async () => {
            const from = page * ADMIN_PAGE_SIZE;
            const to = from + ADMIN_PAGE_SIZE;

            const { data, error } = await supabase
                .from("loyalty_tier_history")
                .select('*, customer:profile_customers!loyalty_tier_history_profile_customer_id_fkey(first_name, last_name, user_id)')
                .eq('change_type', 'manual')
                .order("changed_at", { ascending: false })
                .range(from, to);

            if (error) {
                if (error.code === "PGRST200" || error.message?.includes("Could not find a relationship")) {
                    const { data: fallback, error: fallbackError } = await supabase
                        .from("loyalty_tier_history")
                        .select("*")
                        .eq("change_type", 'manual')
                        .order("changed_at", { ascending: false })
                        .range(from, to);
                    if (fallbackError) throw fallbackError;
                    return (fallback as unknown as LoyaltyTierHistoryEntry[]) ?? [];
                }
                throw error;
            }
            return (data as unknown as LoyaltyTierHistoryEntry[]) ?? [];
        },
        placeholderData: keepPreviousData,
    });
}



// ─── Tier History (legacy complex table) ─────────────────────────────────────

export function useTierHistory(page = 0) {
    return useQuery({
        queryKey: ["tier-history", page],
        queryFn: async () => {
            const from = page * ADMIN_PAGE_SIZE;
            const to = from + ADMIN_PAGE_SIZE; // Fetch one extra to check if next exists

            // FKs to customer were added in migration 20260224000002_add_loyalty_fks.sql.
            // Try the full query with customer join first; fall back to tier-only query if
            // the FK relationship is not found in PostgREST's schema cache (PGRST200).
            const { data, error } = await supabase
                .from("tier_history")
                .select(
                    `*,
                    previous_tier:loyalty_tiers!tier_history_previous_tier_id_fkey(name, priority_level),
                    new_tier:loyalty_tiers!tier_history_new_tier_id_fkey(name, priority_level),
                    customer:customer!tier_history_user_id_fkey(full_name, email),
                    changer:customer!tier_history_changed_by_fkey(full_name)`
                )
                .not("previous_tier_id", "is", null)
                .order("created_at", { ascending: false })
                .range(from, to);

            if (error) {
                // PGRST200 = "Could not find a relationship" — FK not yet in schema cache
                if (error.code === "PGRST200" || error.message?.includes("Could not find a relationship")) {
                    const { data: fallback, error: fallbackError } = await supabase
                        .from("tier_history")
                        .select(
                            `*,
                            previous_tier:loyalty_tiers!tier_history_previous_tier_id_fkey(name, priority_level),
                            new_tier:loyalty_tiers!tier_history_new_tier_id_fkey(name, priority_level)`
                        )
                        .not("previous_tier_id", "is", null)
                        .order("created_at", { ascending: false })
                        .range(from, to);
                    if (fallbackError) throw fallbackError;
                    return (fallback as unknown as TierHistoryEntry[]) ?? [];
                }
                throw error;
            }
            return (data as unknown as TierHistoryEntry[]) ?? [];
        },
        placeholderData: keepPreviousData,
    });
}

// ─── Points Transactions ──────────────────────────────────────────────────────

export function usePointsTransactions(page = 0) {
    return useQuery({
        queryKey: ["points-transactions-admin", page],
        queryFn: async () => {
            const from = page * ADMIN_PAGE_SIZE;
            const to = from + ADMIN_PAGE_SIZE; // Fetch one extra to check if next exists

            // FK to customer added in migration 20260224000002_add_loyalty_fks.sql.
            // Fall back to basic query if the FK relationship is not in PostgREST schema cache.
            const { data, error } = await supabase
                .from("points_transactions")
                .select(`*, customer:customer!points_transactions_user_id_fkey(full_name, email)`)
                .order("created_at", { ascending: false })
                .range(from, to);

            if (error) {
                if (error.code === "PGRST200" || error.message?.includes("Could not find a relationship")) {
                    const { data: fallback, error: fallbackError } = await supabase
                        .from("points_transactions")
                        .select("*")
                        .order("created_at", { ascending: false })
                        .range(from, to);
                    if (fallbackError) throw fallbackError;
                    return (fallback as unknown as PointsTransaction[]) ?? [];
                }
                throw error;
            }
            return (data as unknown as PointsTransaction[]) ?? [];
        },
        placeholderData: keepPreviousData,
    });
}

// ─── Suspicious Activities ────────────────────────────────────────────────────

export function useSuspiciousActivities(page = 0, filters?: { type?: string; severity?: string; status?: string }) {
    const queryClient = useQueryClient();

    const query = useQuery<SuspiciousActivity[], Error>({
        queryKey: ["suspicious-activities", page, filters],
        queryFn: async () => {
            const from = page * ALERTS_PAGE_SIZE;
            const to = from + ALERTS_PAGE_SIZE - 1;

            let supabaseQuery = supabase
                .from("suspicious_activities")
                .select("*, customer:customer(full_name, email)");

            if (filters?.type && filters.type !== "all") {
                supabaseQuery = supabaseQuery.eq("activity_type", filters.type);
            }
            if (filters?.severity && filters.severity !== "all") {
                supabaseQuery = supabaseQuery.eq("severity", filters.severity);
            }
            if (filters?.status && filters.status !== "all") {
                supabaseQuery = supabaseQuery.eq("is_resolved", filters.status === "resolved");
            }

            const { data, error } = await supabaseQuery
                .order("created_at", { ascending: false })
                .range(from, to);

            if (error) throw error;
            return (data as unknown as SuspiciousActivity[]) ?? [];
        },
        placeholderData: keepPreviousData,
    });

    const { data: unresolvedCount = 0 } = useQuery({
        queryKey: ["unresolved-activities-count"],
        queryFn: async () => {
            const { count, error } = await supabase
                .from("suspicious_activities")
                .select("*", { count: 'exact', head: true })
                .eq("is_resolved", false);

            if (error) throw error;
            return count ?? 0;
        },
    });

    const resolveActivity = useMutation({
        mutationFn: async ({
            activityId,
            notes,
        }: {
            activityId: string;
            notes?: string;
        }) => {
            const {
                data: { user },
            } = await supabase.auth.getUser();

            const { error } = await supabase
                .from("suspicious_activities")
                .update({
                    is_resolved: true,
                    resolved_by: user?.id ?? null,
                    resolved_at: new Date().toISOString(),
                    resolution_notes: notes ?? "Resolved by admin",
                })
                .eq("id", activityId);

            if (error) throw error;
            if (user) auditTier.activityResolved(user.id, activityId);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["suspicious-activities"] });
            queryClient.invalidateQueries({ queryKey: ["unresolved-activities-count"] });
            toast.success("Marked as resolved");
        },
        onError: (error: Error) => {
            toast.error("Error", { description: error.message });
        },
    });

    const suspendCustomer = useMutation({
        mutationFn: async (userId: string) => {
            const { data: cust } = await supabase.from("customer").select("email").eq("id", userId).single();
            // `.select("id")` นับแถวที่โดนจริง: UPDATE ที่ไม่ตรงแถวไหนเลยคืน error = null
            // ถ้าไม่นับ การ "ระงับบัญชี" ที่ไม่ได้ระงับอะไรเลยจะขึ้น toast ว่าสำเร็จ
            // ซึ่งอันตรายกว่าทุกเคสในไฟล์นี้ เพราะฝ่ายซัพพอร์ตจะเชื่อว่าปิดบัญชีไปแล้ว
            const { data: suspended, error } = await supabase
                .from("customer")
                .update({ status: "suspended" })
                .eq("id", userId)
                .select("id");
            if (error) throw error;
            if (!suspended || suspended.length === 0) {
                throw new Error(`ไม่พบแถวของผู้ใช้ ${userId} ในตาราง customer — บัญชีไม่ได้ถูกระงับ`);
            }
            const { data: { user } } = await supabase.auth.getUser();
            if (user) auditTier.customerSuspended(user.id, userId, cust?.email);
        },
        onSuccess: () => {
            toast.success("User account suspended");
        },
        onError: (error: Error) => {
            toast.error("Failed to suspend account", { description: error.message });
        },
    });

    return { ...query, unresolvedCount, resolveActivity, suspendCustomer };
}

// ─── Customer Search ──────────────────────────────────────────────────────────

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Customer search for Tier Management. Supports search by name, email, or user ID.
 * Uses RPC search_customers_for_support which joins profile_customers + customer
 * so email search works (profile_customers has no email column).
 *
 * @param overrideQuery - When provided (e.g. from Adjust Tier dialog), use this
 *   instead of internal query state. Enables shared search logic for both main
 *   search and Adjust Tier dropdown.
 */
export function useCustomerSearch(overrideQuery?: string) {
    const [query, setQuery] = useState("");
    const effectiveQuery = overrideQuery !== undefined ? overrideQuery : query;
    const [debouncedQuery, setDebouncedQuery] = useState("");

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(effectiveQuery), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [effectiveQuery]);

    const searchResult = useQuery({
        queryKey: ["customer-search", debouncedQuery],
        queryFn: async () => {
            const q = debouncedQuery.trim().replace(/,/g, " "); // commas break .or()
            if (!q || q.length < 1) return [];

            // RPC searches first_name, last_name, email (from customer), user_id
            const { data: rpcData, error: rpcError } = await supabase.rpc("search_customers_for_support", {
                p_query: q,
            });

            if (rpcError) throw rpcError;

            const rows = (rpcData ?? []) as Array<{
                id: string;
                full_name: string | null;
                email: string | null;
                created_at: string | null;
                loyalty_tier: string | null;
                loyalty_points_balance: number;
            }>;

            return rows.map((r) => ({
                id: r.id,
                full_name: r.full_name,
                email: r.email ?? `${r.id?.slice(0, 8) ?? "?"}@...`,
                created_at: r.created_at ?? "",
                loyalty_tier: r.loyalty_tier,
                loyalty_points_balance: r.loyalty_points_balance ?? 0,
                total_spend: 0,
            })) as CustomerSearchResult[];
        },
        enabled: debouncedQuery.trim().length >= 1,
    });

    return { query, setQuery, ...searchResult };
}

// ─── All Customers (God-Mode Dropdown) ───────────────────────────────────────

/**
 * Fetches ALL customers from profile_customers for the God-Mode Manual Tier
 * Adjustment dropdown. Employees only (enforced via RLS policy
 * "employees_can_read_all_profile_customers").
 * Returns up to 200 customers ordered by first name; the dropdown is
 * filtered client-side by the user's search input.
 * Joins customer table for real email (required for search-by-email in dropdown).
 */
export function useAllCustomers() {
    return useQuery({
        queryKey: ["all-customers-dropdown"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("profile_customers")
                .select(`
                    id,
                    user_id,
                    first_name,
                    last_name,
                    created_at,
                    loyalty_points(
                        point_balance,
                        loyalty_tiers(name)
                    )
                `)
                .order("first_name", { ascending: true })
                .limit(200);

            if (error) {
                throw error;
            }

            const pcRows = data ?? [];
            const userIds = pcRows.map((c) => c.user_id).filter(Boolean);
            let emailMap: Record<string, string> = {};

            if (userIds.length > 0) {
                const { data: custData } = await supabase
                    .from("customer")
                    .select("id, email")
                    .in("id", userIds);
                if (custData) {
                    emailMap = (custData as Array<{ id: string; email: string | null }>).reduce(
                        (acc, row) => {
                            if (row.email) acc[row.id] = row.email;
                            return acc;
                        },
                        {} as Record<string, string>
                    );
                }
            }

            const results: CustomerSearchResult[] = pcRows.map((c) => {
                const lp = c.loyalty_points;
                const tierName = lp?.loyalty_tiers?.name || null;
                const fullName = [c.first_name, c.last_name].filter(Boolean).join(" ") || null;
                const email = emailMap[c.user_id] ?? `${c.user_id?.slice(0, 8) ?? "?"}@...`;

                return {
                    id: c.user_id, // user_id (auth UUID) — required by manual_override_customer_tier RPC
                    full_name: fullName,
                    email,
                    created_at: c.created_at,
                    loyalty_tier: tierName,
                    loyalty_points_balance: lp?.point_balance ?? 0,
                    total_spend: 0,
                };
            });

            return results;
        },
        staleTime: 60_000, // cache for 1 min — this is a heavy query
    });
}

// ─── Manual Tier Override ─────────────────────────────────────────────────────

/**
 * Calls the manual_override_customer_tier RPC — atomic, employee-only.
 * The RPC updates loyalty_points.loyalty_tier_id and inserts a 'manual' row
 * into loyalty_tier_history in a single DB transaction.
 *
 * Parameters accepted by the hook:
 *   userId      — the target customer's auth.uid (= customer.id)
 *   newTierName — human-readable tier name ('Bronze' | 'Silver' | 'Gold' | 'Platinum')
 *   reason      — free-text override reason logged in tier_history
 */
export function useManualTierOverride() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            userId,
            newTierName,
            reason,
        }: {
            userId: string;
            newTierName: string;
            reason: string;
        }) => {
            // Call the atomic RPC — employee guard enforced server-side
            const trimmedReason = reason?.trim() || null;
            const { data, error: rpcError } = await supabase.rpc(
                "admin_override_tier",
                {
                    p_user_id: userId,
                    p_new_tier_name: newTierName,
                    p_reason: trimmedReason,
                }
            );

            if (rpcError) throw rpcError;
            return data;
        },
        onSuccess: async () => {
            // Force immediate refetch so Tier Change History and customer list show updated tier
            await Promise.all([
                queryClient.refetchQueries({ queryKey: ["loyalty-tier-history-all"] }),
                queryClient.refetchQueries({ queryKey: ["customer-search"] }),
                queryClient.refetchQueries({ queryKey: ["all-customers-dropdown"] }),
            ]);
            queryClient.invalidateQueries({ queryKey: ["all_customers"] });
            queryClient.invalidateQueries({ queryKey: ["tier-history"] });
            queryClient.invalidateQueries({ queryKey: ["loyalty-tier-history"] });
            queryClient.invalidateQueries({ queryKey: ["loyalty_tier_history"] });
            queryClient.invalidateQueries({ queryKey: ["loyalty-tier-history-manual"] });
            queryClient.invalidateQueries({ queryKey: ["points-transactions-admin"] });
            toast.success("Tier updated successfully");
        },
        onError: (error: Error) => {
            toast.error("Update failed", { description: error.message });
        },
    });
}


// ─── Loyalty Tiers (for Tier Rules config) ────────────────────────────────────

export interface LoyaltyTierRule {
    id: string;
    name: string;
    min_points: number | null;
    priority_level: number | null;
    retention_period_days: number | null;
}

export function useLoyaltyTiers() {
    return useQuery({
        queryKey: ["loyalty-tiers-rules"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("loyalty_tiers")
                .select("id, name, min_points, priority_level, retention_period_days")
                .eq("is_active", true)
                .order("priority_level", { ascending: true });
            if (error) throw error;
            return (data as unknown as LoyaltyTierRule[]) ?? [];
        },
    });
}

export function useUpdateTierRetention() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ tierId, retentionDays }: { tierId: string; retentionDays: number }) => {
            const { error } = await supabase.rpc("update_tier_retention_period", {
                p_tier_id: tierId,
                p_retention_days: retentionDays,
            });
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["loyalty-tiers-rules"] });
            toast.success("Tier rules updated successfully");
        },
        onError: (err: Error) => {
            toast.error("Update failed", { description: err.message });
        },
    });
}

export function useEvaluateInactivityDowngrades() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async () => {
            const { data, error } = await supabase.rpc("evaluate_inactivity_tier_downgrades");
            if (error) throw error;
            return data as { downgraded_count: number };
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ["loyalty-tier-history-all"] });
            queryClient.invalidateQueries({ queryKey: ["all-customers-dropdown"] });
            toast.success(`Evaluation complete: ${data?.downgraded_count ?? 0} tier(s) downgraded`);
        },
        onError: (err: Error) => {
            toast.error("Evaluation failed", { description: err.message });
        },
    });
}

export function useSyncTierFromLifetimePoints() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async () => {
            const { data, error } = await supabase.rpc("sync_tier_from_lifetime_points");
            if (error) throw error;
            return data as { updated_count: number; backfilled_count: number };
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ["loyalty-tier-history-all"] });
            queryClient.invalidateQueries({ queryKey: ["all-customers-dropdown"] });
            const total = (data?.updated_count ?? 0) + (data?.backfilled_count ?? 0);
            toast.success(`Sync complete: ${total} tier history updated`);
        },
        onError: (err: Error) => {
            toast.error("Sync failed", { description: err.message });
        },
    });
}

// ─── Manual Point Adjustment ──────────────────────────────────────────────────

export function useManualPointAdjustment() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            userId,
            pointsToAdjust,
            reason,
        }: {
            userId: string;
            pointsToAdjust: number;
            reason: string;
        }) => {
            if (pointsToAdjust === 0) throw new Error("Points adjustment must not be 0");

            const { data: profile } = await supabase
                .from("profile_customers")
                .select(`id, loyalty_points(id, point_balance)`)
                .eq("user_id", userId)
                .maybeSingle();

            if (!profile || !profile.loyalty_points) {
                throw new Error("Cannot find loyalty points data for this customer");
            }

            const lpInfo = Array.isArray(profile.loyalty_points) ? profile.loyalty_points[0] : profile.loyalty_points;

            // Adjust balance ensuring it does not drop below 0
            const newBalance = Math.max(0, (lpInfo.point_balance || 0) + pointsToAdjust);

            // Update balance
            const { error: updateError } = await supabase
                .from("loyalty_points")
                .update({ point_balance: newBalance })
                .eq("id", lpInfo.id);

            if (updateError) throw updateError;

            // Log point transaction
            const {
                data: { user: adminUser },
            } = await supabase.auth.getUser();

            const { error: txError } = await supabase
                .from("points_transactions")
                .insert({
                    user_id: userId,
                    loyalty_points_id: lpInfo.id,
                    transaction_type: pointsToAdjust > 0 ? "bonus" : "adjustment",
                    points_amount: Math.abs(pointsToAdjust),
                    balance_after: newBalance,
                    description: `Manual Adjustment: ${reason}`,
                    created_by_user_id: adminUser?.id ?? null,
                });

            if (txError) throw txError;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["customer-search"] });
            queryClient.invalidateQueries({ queryKey: ["points-transactions-admin"] });
            toast.success("Points balance updated successfully");
        },
        onError: (error: Error) => {
            toast.error("Failed to update points", { description: error.message });
        },
    });
}
