import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";

/**
 * Revenue figures for the dashboard and the ROI report — measured only.
 *
 * ## Why this hook has no fallback
 *
 * It used to have one. When `revenue_metrics` held no row it invented the
 * whole panel from ad performance:
 *
 * ```
 * gross  = totalSpend * avgRoas
 * net    = gross * 0.85          // "rough estimate"
 * orders = totalConversions
 * new_customers = totalConversions * 0.6
 * margin = (net - spend) / gross
 * ```
 *
 * Three of those five are constants somebody chose. `0.85` is not a measured
 * deduction rate and `0.6` is not a measured new-customer share; they were
 * placeholders that reached the screen as `฿` and reached exported ROI reports
 * as "Net Profit". This product exists to replace exactly that kind of number,
 * so shipping it as our own output is the one thing it cannot do — and the
 * table is empty on every workspace today, which means the invented branch was
 * not a rare fallback, it was the only branch anyone ever saw.
 *
 * The arithmetic was unsound underneath as well. `avgRoas` is a mean of
 * per-row ROAS rather than `Σrevenue / Σspend`, so it weights a ฿5 day the
 * same as a ฿5,000 one, and `ad_insights` has no `revenue` column at all — the
 * import pipeline computes ROAS and discards the revenue it came from, and the
 * Meta connector stores `roas` NULL on purpose. So `spend × avgRoas` could not
 * have reconstructed revenue even with a correct average.
 *
 * The honest interface is therefore null: callers render an empty state that
 * names what is missing. Restoring a computed figure needs somewhere real to
 * compute it from — a `revenue` column, or the Shopee escrow leg that True Net
 * Profit is defined against. Until one of those lands, no number here is
 * better than a plausible one.
 */
export interface RevenueMetricsRow {
  gross_revenue: number | null;
  net_revenue: number | null;
  profit: number | null;
  profit_margin: number | null;
  revenue_growth_percent: number | null;
  total_orders: number | null;
  new_customers: number | null;
  metric_date: string | null;
}

/** A revenue reading. `source` has one member and is kept as a field so a
 *  future measured source has somewhere to declare itself, and so callers keep
 *  having to say which one they are showing. */
export interface DerivedRevenue {
  gross_revenue: number;
  net_revenue: number;
  profit_margin: number;
  revenue_growth_percent: number | null;
  total_orders: number;
  new_customers: number;
  metric_date: string;
  source: "revenue_metrics";
}

export function useRevenueMetrics() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id;

  const { data: revenueMetrics, isLoading } = useQuery({
    queryKey: ["revenue-metrics-dashboard", workspaceId],
    enabled: !!workspaceId,
    queryFn: async (): Promise<RevenueMetricsRow | null> => {
      if (!workspaceId) return null;

      const { data, error } = await supabase
        .from("revenue_metrics")
        .select("gross_revenue, net_revenue, profit, profit_margin, revenue_growth_percent, total_orders, new_customers, metric_date")
        .eq("team_id", workspaceId)
        .order("metric_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });

  const displayMetrics: DerivedRevenue | null = revenueMetrics
    ? {
        gross_revenue: Number(revenueMetrics.gross_revenue ?? 0),
        net_revenue: Number(revenueMetrics.net_revenue ?? 0),
        profit_margin: Number(revenueMetrics.profit_margin ?? 0),
        revenue_growth_percent: revenueMetrics.revenue_growth_percent != null ? Number(revenueMetrics.revenue_growth_percent) : null,
        total_orders: Number(revenueMetrics.total_orders ?? 0),
        new_customers: Number(revenueMetrics.new_customers ?? 0),
        metric_date: revenueMetrics.metric_date ?? "",
        source: "revenue_metrics",
      }
    : null;

  return {
    revenueMetrics: displayMetrics,
    isLoading,
  };
}
