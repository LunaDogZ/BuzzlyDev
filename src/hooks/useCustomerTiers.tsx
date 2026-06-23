import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, subMonths, endOfMonth, startOfMonth } from "date-fns";
import { th } from "date-fns/locale";

export interface GenderSegment {
  gender: string;
  count: number;
  percentage: number;
}

export interface GenderTrendPoint {
  month: string;
  Male: number;
  Female: number;
  "Not Specified": number;
}

export interface KPISparkline {
  date: string;
  value: number;
}

export interface AccountGrowthPoint {
  month: string;
  creations: number;
  activations: number;
}

export interface RetentionChurnPoint {
  month: string;
  retentionRate: number;
  churnRate: number;
}

export interface TierDistribution {
    name: string;
    value: number;
    color: string;
}

export interface RevenueByTier {
    name: string;
    revenue: number;
    avgSpend: number;
}

export interface TierMovement {
    month: string;
    upgrades: number;
    downgrades: number;
}

export interface TopPerformer {
    id: string;
    name: string;
    tier: string;
    totalSpend: number;
    points: number;
}

export interface NearUpgradeCustomer {
    id: string;
    name: string;
    currentTier: string;
    nextTier: string;
    spendNeeded: number;
}

export interface ChurnRiskCustomer {
    id: string;
    name: string;
    tier: string;
    daysInactive: number;
}

export interface CustomerTiersData {
    tierDistribution: TierDistribution[];
    revenueByTier: RevenueByTier[];
    tierMovement: TierMovement[];
    topPerformers: TopPerformer[];
    nearUpgradeCustomers: NearUpgradeCustomer[];
    churnRiskCustomers: ChurnRiskCustomer[];
    pointsBurnRate: number;
    totalCustomers: number;
    totalRevenue: number;
    avgSpendAll: number;
    platinumCount: number;
    // Overview / Customer Overview
    byGender: GenderSegment[];
    genderTrend: GenderTrendPoint[];
    kpiSparklines: {
        totalCustomers: KPISparkline[];
        newMonthly: KPISparkline[];
        active: KPISparkline[];
        churned: KPISparkline[];
    };
    kpiChange: { totalCustomers: number; newMonthly: number; active: number; churned: number };
    accountGrowth: AccountGrowthPoint[];
    retentionChurn: RetentionChurnPoint[];
}

const TIER_COLORS: Record<string, string> = {
    Bronze: "#A85823",
    Silver: "#94A3B8",
    Gold: "#F59E0B",
    Platinum: "#6366F1",
};

async function fetchCustomerTiersData(timePeriod: string): Promise<CustomerTiersData> {
    const [tiersRes, customersRes, txsRes, tierHistoryRes] = await Promise.all([
        supabase.from("loyalty_tiers").select("*").order("min_points"),
        supabase.from("profile_customers").select(`
      user_id,
      first_name,
      last_name,
      created_at,
      gender,
      last_active,
      loyalty_point_id,
      loyalty_points(
        point_balance,
        total_points_earned,
        loyalty_tier_id,
        status,
        loyalty_tiers(name, badge_color)
      )
    `),
        supabase
            .from("payment_transactions")
            .select("amount, user_id, created_at")
            .order("created_at", { ascending: true }),
        supabase
            .from("tier_history")
            .select(`
                id,
                user_id,
                created_at,
                previous_tier:loyalty_tiers!tier_history_previous_tier_id_fkey(name, priority_level),
                new_tier:loyalty_tiers!tier_history_new_tier_id_fkey(name, priority_level)
            `)
            .order("created_at", { ascending: true }),
    ]);

    const tiers = tiersRes.data ?? [];
    const customers = customersRes.data ?? [];
    const allTxs = txsRes.data ?? [];
    const allTierHistory = tierHistoryRes.data ?? [];

    const now = new Date();
    let filterStartDate = new Date(0);
    if (timePeriod === "7d") filterStartDate = new Date(now.setDate(now.getDate() - 7));
    else if (timePeriod === "30d") filterStartDate = new Date(now.setDate(now.getDate() - 30));
    else if (timePeriod === "90d") filterStartDate = new Date(now.setDate(now.getDate() - 90));
    else if (timePeriod === "1y") filterStartDate = new Date(now.setFullYear(now.getFullYear() - 1));

    const txs = allTxs.filter(tx => new Date(tx.created_at) >= filterStartDate);

    // Deduplicate tiers by name
    const uniqueTiers = new Map<string, (typeof tiers)[0]>();
    tiers.forEach((t) => {
        if (!uniqueTiers.has(t.name)) uniqueTiers.set(t.name, t);
    });
    const masterTiers = Array.from(uniqueTiers.values()).sort(
        (a, b) => a.min_points - b.min_points
    );

    // A. Tier distribution
    const tierCounts = new Map<string, number>();
    let totalCustomers = 0;
    let platinumCount = 0;

    customers.forEach((c) => {
        const lp = c.loyalty_points;
        // Relaxed check: Count if ANY loyalty record exists, effectively all customers in the system
        // Only exclude if explicitly 'banned' or 'archived' if those statuses existed, but 'active' check was too strict
        if (lp) {
            const tName = lp.loyalty_tiers?.name || "Bronze";
            tierCounts.set(tName, (tierCounts.get(tName) || 0) + 1);
            totalCustomers++;
            if (tName === "Platinum") platinumCount++;
        }
    });

    const tierDistribution: TierDistribution[] = masterTiers.map((t) => ({
        name: t.name,
        value: tierCounts.get(t.name) || 0,
        color: TIER_COLORS[t.name] ?? "#94A3B8",
    }));

    // B. Revenue
    const userSpendMap = new Map<string, number>();
    let totalRevenue = 0;
    txs.forEach((tx) => {
        userSpendMap.set(tx.user_id, (userSpendMap.get(tx.user_id) || 0) + (Number(tx.amount) || 0));
        totalRevenue += (Number(tx.amount) || 0);
    });

    // Safety check for avgSpend
    const avgSpendAll = totalCustomers > 0 ? Math.round(totalRevenue / totalCustomers) : 0;

    const userTierNameMap = new Map<string, string>();
    customers.forEach((c) => {
        const lp = c.loyalty_points;
        userTierNameMap.set(c.user_id, lp?.loyalty_tiers?.name || "Bronze");
    });

    const tierRevenueMap = new Map<string, number>();
    userSpendMap.forEach((spend, userId) => {
        const tName = userTierNameMap.get(userId);
        if (tName) tierRevenueMap.set(tName, (tierRevenueMap.get(tName) || 0) + spend);
    });

    const revenueByTier: RevenueByTier[] = masterTiers.map((t) => {
        const rev = tierRevenueMap.get(t.name) || 0;
        const count = tierCounts.get(t.name) || 1;
        // Prevent division by zero if count is somehow 0 (though we set default 1 above, logic holds)
        // If revenue is 0, avgSpend is 0.
        return { name: t.name, revenue: rev, avgSpend: count > 0 ? Math.round(rev / count) : 0 };
    });

    // C. Top performers
    const sortedCustomers = customers.map((c) => {
        const lp = c.loyalty_points;
        return {
            id: c.user_id,
            name: `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Unknown Customer",
            tier: lp?.loyalty_tiers?.name || "Bronze",
            points: lp?.total_points_earned || 0,
            balance: lp?.point_balance || 0, // Added for burn rate
            totalSpend: userSpendMap.get(c.user_id) || 0,
        };
    });

    const topPerformers: TopPerformer[] = [...sortedCustomers]
        .sort((a, b) => b.totalSpend - a.totalSpend)
        .slice(0, 5);

    // E. Near Upgrade Customers
    const sortedLogicTiers = [...masterTiers].sort(
        (a, b) => a.min_spend_amount - b.min_spend_amount
    );
    const nearUpgradeCustomers: NearUpgradeCustomer[] = [];
    sortedCustomers.forEach(c => {
        let currentTierIndex = sortedLogicTiers.findIndex(t => t.name === c.tier) || 0;
        if (currentTierIndex >= 0 && currentTierIndex < sortedLogicTiers.length - 1) {
            const nextTier = sortedLogicTiers[currentTierIndex + 1];
            const spendNeeded = nextTier.min_spend_amount - c.totalSpend;
            // E.g., any customer needing > 0 to hit the next tier
            if (spendNeeded > 0) {
                nearUpgradeCustomers.push({
                    id: c.id,
                    name: c.name,
                    currentTier: c.tier,
                    nextTier: nextTier.name,
                    spendNeeded,
                });
            }
        }
    });

    // F. Churn Risk Customers
    const churnRiskCustomers: ChurnRiskCustomer[] = [];
    const userLastTxMap = new Map<string, Date>();
    allTxs.forEach(tx => {
        const txDate = new Date(tx.created_at);
        const lastTxDate = userLastTxMap.get(tx.user_id);
        if (!lastTxDate || txDate > lastTxDate) {
            userLastTxMap.set(tx.user_id, txDate);
        }
    });

    sortedCustomers.forEach(c => {
        if (c.tier === "Platinum" || c.tier === "Gold") {
            const lastTxDate = userLastTxMap.get(c.id);
            if (lastTxDate) {
                const daysInactive = Math.floor((new Date().getTime() - lastTxDate.getTime()) / (1000 * 3600 * 24));
                if (daysInactive >= 60) {
                    churnRiskCustomers.push({
                        id: c.id,
                        name: c.name,
                        tier: c.tier,
                        daysInactive,
                    });
                }
            }
        }
    });
    // Sort logic for insights
    nearUpgradeCustomers.sort((a, b) => a.spendNeeded - b.spendNeeded).splice(5); // Only keep top 5 closest
    churnRiskCustomers.sort((a, b) => b.daysInactive - a.daysInactive).splice(5); // Only keep 5 most inactive VIPs

    // G. Points Burn Rate
    let totalPointsEarned = 0;
    let totalPointsBalance = 0;
    sortedCustomers.forEach(c => {
        totalPointsEarned += c.points;
        totalPointsBalance += c.balance;
    });
    const pointsBurnRate = totalPointsEarned > 0 ? ((totalPointsEarned - totalPointsBalance) / totalPointsEarned) * 100 : 0;

    // D. Tier Movement — from real tier_history (upgrades AND downgrades)
    const endDate = new Date();
    const trendsMap = new Map<string, { up: number; down: number }>();

    let chartStartDate = new Date();

    if (timePeriod === "7d") {
        chartStartDate = new Date(endDate.getTime() - 7 * 24 * 3600 * 1000);
        for (let i = 6; i >= 0; i--) {
            const d = new Date(endDate.getTime() - i * 24 * 3600 * 1000);
            trendsMap.set(format(d, "d MMM", { locale: th }), { up: 0, down: 0 });
        }
    } else if (timePeriod === "30d") {
        chartStartDate = new Date(endDate.getTime() - 30 * 24 * 3600 * 1000);
        for (let i = 29; i >= 0; i--) {
            const d = new Date(endDate.getTime() - i * 24 * 3600 * 1000);
            trendsMap.set(format(d, "d MMM", { locale: th }), { up: 0, down: 0 });
        }
    } else if (timePeriod === "90d") {
        chartStartDate = subMonths(endDate, 3);
        for (let i = 2; i >= 0; i--) {
            const d = subMonths(endDate, i);
            trendsMap.set(format(d, "MMM yy", { locale: th }), { up: 0, down: 0 });
        }
    } else { // 1y
        chartStartDate = subMonths(endDate, 12);
        for (let i = 11; i >= 0; i--) {
            const d = subMonths(endDate, i);
            trendsMap.set(format(d, "MMM yy", { locale: th }), { up: 0, down: 0 });
        }
    }

    // Walk through real tier_history records — each row is one tier change event
    allTierHistory.forEach((event) => {
        const eventDate = new Date(event.created_at);
        if (eventDate < chartStartDate) return; // outside range

        const prevPriority: number = event.previous_tier?.priority_level ?? 0;
        const newPriority: number = event.new_tier?.priority_level ?? 0;

        // Higher priority_level = higher tier (Platinum > Gold > Silver > Bronze)
        const isUpgrade = newPriority > prevPriority;
        const isDowngrade = newPriority < prevPriority;

        if (!isUpgrade && !isDowngrade) return; // no change (shouldn't happen)

        let key = "";
        if (timePeriod === "7d" || timePeriod === "30d") {
            key = format(eventDate, "d MMM", { locale: th });
        } else {
            key = format(eventDate, "MMM yy", { locale: th });
        }

        const bucket = trendsMap.get(key);
        if (bucket) {
            if (isUpgrade) bucket.up++;
            else bucket.down++;
        }
    });

    const tierMovement: TierMovement[] = Array.from(trendsMap.entries()).map(
        ([month, data]) => ({ month, upgrades: data.up, downgrades: data.down })
    );

    // ── Overview: Gender, KPIs, Account Growth, Retention/Churn ─────────────────
    const normalizeGender = (g: string | null | undefined): string => {
        const v = (g ?? "").trim().toLowerCase();
        if (v === "male") return "Male";
        if (v === "female") return "Female";
        return "Not Specified";
    };

    const byGenderMap = new Map<string, number>();
    let totalForGender = 0;
    customers.forEach((c) => {
        const g = normalizeGender(c.gender);
        byGenderMap.set(g, (byGenderMap.get(g) || 0) + 1);
        totalForGender++;
    });
    const byGender: GenderSegment[] = ["Male", "Female", "Not Specified"].map((g) => {
        const count = byGenderMap.get(g) || 0;
        return { gender: g, count, percentage: totalForGender > 0 ? Math.round((count / totalForGender) * 100) : 0 };
    });

    const sixMonthsAgo = subMonths(endDate, 3);
    const monthLabels: string[] = [];
    for (let i = 5; i >= 0; i--) {
        const d = subMonths(endDate, i);
        monthLabels.push(format(d, "MMM yy", { locale: th }));
    }

    const genderTrend: GenderTrendPoint[] = monthLabels.map((label, idx) => {
        const monthEnd = endOfMonth(subMonths(endDate, 5 - idx));
        const counts = { Male: 0, Female: 0, "Not Specified": 0 };
        customers.forEach((c) => {
            const created = c.created_at ? new Date(c.created_at) : null;
            if (created && created <= monthEnd) {
                const g = normalizeGender(c.gender);
                counts[g as keyof typeof counts]++;
            }
        });
        return { month: label, ...counts };
    });

    const monthlyCreations = new Map<string, number>();
    const monthlyActive = new Map<string, number>();
    const monthlyChurned = new Map<string, number>();
    monthLabels.forEach((label) => {
        monthlyCreations.set(label, 0);
        monthlyActive.set(label, 0);
        monthlyChurned.set(label, 0);
    });

    customers.forEach((c) => {
        const created = c.created_at ? new Date(c.created_at) : null;
        const lastActive = c.last_active ? new Date(c.last_active) : userLastTxMap.get(c.user_id) ?? null;
        const lastActivity = lastActive ?? created;

        monthLabels.forEach((label, idx) => {
            const monthEnd = endOfMonth(subMonths(endDate, 5 - idx));
            const monthStart = startOfMonth(monthEnd);
            if (created && created >= monthStart && created <= monthEnd) {
                monthlyCreations.set(label, (monthlyCreations.get(label) || 0) + 1);
            }
            const activeThreshold = new Date(monthEnd.getTime() - 30 * 24 * 3600 * 1000);
            const churnThreshold = new Date(monthEnd.getTime() - 60 * 24 * 3600 * 1000);
            if (lastActivity && lastActivity >= activeThreshold) {
                monthlyActive.set(label, (monthlyActive.get(label) || 0) + 1);
            }
            if (lastActivity && lastActivity < churnThreshold && lastActivity >= monthStart) {
                monthlyChurned.set(label, (monthlyChurned.get(label) || 0) + 1);
            }
        });
    });

    const totalCustomersSparkline = monthLabels.map((label, idx) => {
        const monthEnd = endOfMonth(subMonths(endDate, 5 - idx));
        let count = 0;
        customers.forEach((c) => {
            const created = c.created_at ? new Date(c.created_at) : null;
            if (created && created <= monthEnd) count++;
        });
        return { date: label, value: count };
    });

    const newMonthlySparkline = monthLabels.map((label) => ({ date: label, value: monthlyCreations.get(label) || 0 }));
    const activeSparkline = monthLabels.map((label) => ({ date: label, value: monthlyActive.get(label) || 0 }));
    const churnedSparkline = monthLabels.map((label) => ({ date: label, value: monthlyChurned.get(label) || 0 }));

    const prevTotal = totalCustomersSparkline[4]?.value ?? totalCustomers;
    const currTotal = totalCustomersSparkline[5]?.value ?? totalCustomers;
    const prevNew = newMonthlySparkline[4]?.value ?? 0;
    const currNew = newMonthlySparkline[5]?.value ?? 0;
    const prevActive = activeSparkline[4]?.value ?? 0;
    const currActive = activeSparkline[5]?.value ?? 0;
    const prevChurned = churnedSparkline[4]?.value ?? 0;
    const currChurned = churnedSparkline[5]?.value ?? 0;

    const pct = (prev: number, curr: number) => (prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : 0);

    const kpiChange = {
        totalCustomers: pct(prevTotal, currTotal),
        newMonthly: pct(prevNew, currNew),
        active: pct(prevActive, currActive),
        churned: pct(prevChurned, currChurned),
    };

    const accountGrowth: AccountGrowthPoint[] = monthLabels.map((label) => ({
        month: label,
        creations: monthlyCreations.get(label) || 0,
        activations: monthlyActive.get(label) || 0,
    }));

    const retentionChurn: RetentionChurnPoint[] = monthLabels.map((label, idx) => {
        const monthEnd = endOfMonth(subMonths(endDate, 5 - idx));
        let countAsOf = 0;
        let activeCount = 0;
        let churnedCount = 0;
        const churnCutoff = new Date(monthEnd.getTime() - 60 * 24 * 3600 * 1000);
        const activeCutoff = new Date(monthEnd.getTime() - 30 * 24 * 3600 * 1000);
        customers.forEach((c) => {
            const created = c.created_at ? new Date(c.created_at) : null;
            if (!created || created > monthEnd) return;
            countAsOf++;
            const lastActive = c.last_active ? new Date(c.last_active) : userLastTxMap.get(c.user_id) ?? null;
            const lastActivity = lastActive ?? created;
            if (lastActivity >= activeCutoff) activeCount++;
            else if (lastActivity < churnCutoff) churnedCount++;
        });
        const retentionRate = countAsOf > 0 ? Math.round((activeCount / countAsOf) * 100) : 0;
        const churnRate = countAsOf > 0 ? Math.round((churnedCount / countAsOf) * 100) : 0;
        return { month: label, retentionRate, churnRate };
    });

    return {
        tierDistribution,
        revenueByTier,
        tierMovement,
        topPerformers,
        nearUpgradeCustomers,
        churnRiskCustomers,
        pointsBurnRate: Math.round(pointsBurnRate),
        totalCustomers,
        totalRevenue,
        avgSpendAll,
        platinumCount,
        byGender,
        genderTrend,
        kpiSparklines: {
            totalCustomers: totalCustomersSparkline,
            newMonthly: newMonthlySparkline,
            active: activeSparkline,
            churned: churnedSparkline,
        },
        kpiChange,
        accountGrowth,
        retentionChurn,
    };
}

export function useCustomerTiers(timePeriod: string = "30d") {
    return useQuery({
        queryKey: ["customer-tiers", timePeriod],
        queryFn: () => fetchCustomerTiersData(timePeriod),
        staleTime: 5 * 60 * 1000, // 5 minutes
    });
}
