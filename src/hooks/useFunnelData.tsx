import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type FunnelStage = Database["public"]["Tables"]["funnel_stages"]["Row"];
export type AARRRCategory = Database["public"]["Tables"]["aarrr_categories"]["Row"];
// kept for backward compatibility with any import sites
export type CustomerActivity = Database["public"]["Tables"]["customer_activities"]["Row"];

export interface FunnelStageWithMetrics extends FunnelStage {
  value: number;
  percentage: number;
  metrics: Record<string, number | string>;
  category?: AARRRCategory;
}

// Shape of aggregated data from ad_insights
interface AdInsightsTotals {
  impressions: number;
  clicks: number;
  leads: number;
  adds_to_cart: number;
  conversions: number;
}

export function useFunnelData(period?: string, platformId?: string) {
  // Convert "7d" / "30d" / "90d" → ISO date string for filtering
  const dateFrom = period
    ? (() => {
        const days = parseInt(period, 10);
        const d = new Date();
        d.setDate(d.getDate() - days);
        return d.toISOString().split("T")[0];
      })()
    : undefined;

  // ── AARRR Categories ──────────────────────────────────────────────
  const { data: aarrrCategories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ["aarrr_categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aarrr_categories")
        .select("*")
        .order("display_order", { ascending: true });
      if (error) throw error;
      return data as AARRRCategory[];
    },
  });

  // ── Funnel Stages ─────────────────────────────────────────────────
  const { data: funnelStages = [], isLoading: stagesLoading } = useQuery({
    queryKey: ["funnel_stages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("funnel_stages")
        .select("*")
        .order("display_order", { ascending: true });
      if (error) throw error;
      return data as FunnelStage[];
    },
  });

  // ── Ad Insights Aggregation via Backend RPC (estimation logic in DB) ─
  // Falls back to direct query when RPC is not available.
  interface AdInsightsResult {
    totals: AdInsightsTotals;
    usedFallback: { leads: boolean; adds_to_cart: boolean; conversions: boolean };
  }
  const { data: adResult, isLoading: insightsLoading } = useQuery<AdInsightsResult>({
    queryKey: ["ad_insights_funnel_totals", period, platformId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_customer_journey_funnel_totals", {
        p_date_from: dateFrom ?? null,
        p_platform_id: platformId ?? null,
      });

      if (!error && data && typeof data === "object" && "totals" in data) {
        const result = data as unknown as {
          totals: AdInsightsTotals;
          used_fallback: { leads: boolean; adds_to_cart: boolean; conversions: boolean };
        };
        return {
          totals: result.totals,
          usedFallback: result.used_fallback,
        };
      }

      // Fallback: RPC not available — use direct query
      if (error && typeof window !== "undefined" && process.env.NODE_ENV === "development") {
        console.warn("[useFunnelData] RPC fallback:", error.message);
      }

      let query = supabase
        .from("ad_insights")
        .select("impressions, clicks, leads, adds_to_cart, conversions, ad_accounts!inner(is_active, platform_id)")
        .eq("ad_accounts.is_active", true);

      if (dateFrom) query = query.gte("date", dateFrom);
      if (platformId) query = query.eq("ad_accounts.platform_id", platformId);

      const { data: rows, error: queryError } = await query;
      if (queryError) throw queryError;

      const raw = ((rows as unknown as Record<string, number | null>[]) || []).reduce(
        (acc: AdInsightsTotals, row: Record<string, number | null>) => ({
          impressions: acc.impressions + (row.impressions ?? 0),
          clicks: acc.clicks + (row.clicks ?? 0),
          leads: acc.leads + (row.leads ?? 0),
          adds_to_cart: acc.adds_to_cart + (row.adds_to_cart ?? 0),
          conversions: acc.conversions + (row.conversions ?? 0),
        }),
        { impressions: 0, clicks: 0, leads: 0, adds_to_cart: 0, conversions: 0 }
      );

      const usedFallback = { leads: false, adds_to_cart: false, conversions: false };
      if (raw.leads === 0 && raw.clicks > 0) {
        raw.leads = Math.round(raw.clicks * 0.05);
        usedFallback.leads = true;
      }
      if (raw.adds_to_cart === 0 && (raw.leads > 0 || raw.conversions > 0)) {
        raw.adds_to_cart = Math.max(
          Math.round(raw.leads * 0.25),
          Math.round(raw.conversions * 2.5)
        );
        usedFallback.adds_to_cart = true;
      }
      if (raw.conversions === 0 && raw.adds_to_cart > 0) {
        raw.conversions = Math.round(raw.adds_to_cart * 0.35);
        usedFallback.conversions = true;
      }

      return { totals: raw, usedFallback };
    },
  });

  const adTotals = adResult?.totals;

  // ── Stage slug → metric mapping ───────────────────────────────────
  const getStageValue = (slug: string): number => {
    if (!adTotals) return 0;
    switch (slug) {
      case "landing":          return adTotals.impressions;
      case "signup-start":     return adTotals.clicks;
      case "email-verified":   return adTotals.leads;
      case "profile-complete": return adTotals.adds_to_cart;
      case "first-campaign":
      case "active":
      case "first-payment":    return adTotals.conversions;
      case "referral":         return Math.round(adTotals.conversions * 0.15);
      default:                 return 0;
    }
  };

  // ── Build stages with waterfall constraint ─────────────────────────
  let previousStageValue = adTotals?.impressions ?? 0;

  const stagesWithMetrics: FunnelStageWithMetrics[] = funnelStages.map((stage, index) => {
    const category = aarrrCategories.find(c => c.id === stage.aarrr_categories_id);
    let stageValue = getStageValue(stage.slug ?? "");

    if (index > 0) stageValue = Math.min(stageValue, previousStageValue);
    previousStageValue = stageValue;

    return {
      ...stage,
      value: stageValue,
      percentage: 0,
      metrics: { users: stageValue },
      category,
    };
  });

  const firstStageValue = stagesWithMetrics[0]?.value || 0;

  const finalStages = stagesWithMetrics.map(s => ({
    ...s,
    percentage: firstStageValue > 0 ? Math.round((s.value / firstStageValue) * 100) : 0,
  }));

  // ── AARRR category summaries ───────────────────────────────────────
  const categoriesWithMetrics = aarrrCategories.map((category, index) => {
    const categoryStages = finalStages.filter(s => s.aarrr_categories_id === category.id);
    const categoryValue =
      categoryStages.length > 0 ? Math.max(...categoryStages.map(s => s.value)) : 0;

    const acquisitionCategory = aarrrCategories.find(c => c.display_order === 1);
    const acqStages = finalStages.filter(s => s.aarrr_categories_id === acquisitionCategory?.id);
    const firstCategoryValue =
      index === 0
        ? categoryValue
        : acqStages.length > 0
          ? Math.max(...acqStages.map(s => s.value))
          : 0;

    return {
      ...category,
      value: categoryValue,
      percentage: firstCategoryValue > 0
        ? Math.round((categoryValue / firstCategoryValue) * 100)
        : 0,
      metrics: { users: categoryValue, stages: categoryStages.length },
    };
  });

  return {
    aarrrCategories: categoriesWithMetrics,
    funnelStages: finalStages,
    activities: [], // deprecated; kept for backward compatibility
    isLoading: categoriesLoading || stagesLoading || insightsLoading,
    adTotals,
    usedFallback: adResult?.usedFallback ?? { leads: false, adds_to_cart: false, conversions: false },
  };
}
