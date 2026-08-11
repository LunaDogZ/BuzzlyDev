import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { sourcesFor, type AdDataSourceFilter } from "@/constants/adDataSource";

export interface DashboardMetrics {
  totalImpressions: number;
  totalClicks: number;
  totalSpend: number;
  totalConversions: number;
  avgCtr: number;
  avgCpc: number;
  avgCpm: number;
  avgRoas: number;
  trendData: { date: string; impressions: number; clicks: number; spend: number }[];
}

export function parseDateRange(dateRange: string): { start: string; end: string } {
  const now = new Date();
  const toYMD = (d: Date) => d.toISOString().split("T")[0]!;

  if (dateRange.startsWith("week:")) {
    const m = dateRange.match(/^week:(\d{4}-\d{2}-\d{2})$/);
    if (m) {
      const start = new Date(m[1]!);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return { start: toYMD(start), end: toYMD(end) };
    }
  }
  if (dateRange.startsWith("month:")) {
    const m = dateRange.match(/^month:(\d{4}-\d{2})$/);
    if (m) {
      const [y, mo] = m[1]!.split("-").map(Number);
      const start = new Date(y!, mo! - 1, 1);
      const end = new Date(y!, mo!, 0);
      return { start: toYMD(start), end: toYMD(end) };
    }
  }
  if (dateRange.startsWith("year:")) {
    const m = dateRange.match(/^year:(\d{4})$/);
    if (m) {
      const y = parseInt(m[1]!, 10);
      return { start: `${y}-01-01`, end: `${y}-12-31` };
    }
  }
  if (dateRange.startsWith("custom:")) {
    const parts = dateRange.split(":");
    if (parts.length === 3 && parts[1] && parts[2]) {
      const start = parts[1];
      const end = parts[2];
      if (/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
        return { start, end };
      }
    }
  }

  let startDate = new Date(now);
  switch (dateRange) {
    case "today":
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      return { start: toYMD(startDate), end: toYMD(now) };
    case "7d":
      startDate.setDate(startDate.getDate() - 7);
      return { start: toYMD(startDate), end: toYMD(now) };
    case "30d":
      startDate.setDate(startDate.getDate() - 30);
      return { start: toYMD(startDate), end: toYMD(now) };
    case "90d":
      startDate.setDate(startDate.getDate() - 90);
      return { start: toYMD(startDate), end: toYMD(now) };
    case "1y":
      startDate.setFullYear(startDate.getFullYear() - 1);
      return { start: toYMD(startDate), end: toYMD(now) };
    case "all":
      return { start: "2000-01-01", end: toYMD(now) };
    default:
      startDate.setDate(startDate.getDate() - 30);
      return { start: toYMD(startDate), end: toYMD(now) };
  }
}

/**
 * The ad accounts a workspace's insights may be read through, after the
 * platform filter.
 *
 * Scoping insights by ad account matches both the ad_insights RLS policy
 * (authorizes via ad_account -> team) and the actual data shape: insights carry
 * ad_account_id while campaign_id is null for ingested rows, so we must NOT
 * require campaigns/campaign_ads here.
 *
 * Exported because `useAdDataRange` reports which dates these same rows cover.
 * If the two scoped differently, the dashboard could claim data exists in a
 * range that its own numbers then render as empty.
 */
export async function fetchScopedAdAccountIds(
  workspaceId: string,
  platformId: string
): Promise<string[]> {
  const { data: adAccounts, error } = await supabase
    .from("ad_accounts")
    .select("id, platform_id")
    .eq("team_id", workspaceId);

  if (error) throw error;

  const scoped =
    platformId !== "all"
      ? (adAccounts ?? []).filter((a) => a.platform_id === platformId)
      : (adAccounts ?? []);

  return scoped.map((a) => a.id);
}

export function useDashboardMetrics(
  dateRange: string = "7d",
  platformId: string = "all",
  dataSource: AdDataSourceFilter = "all"
) {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id;

  return useQuery({
    queryKey: ["dashboard-metrics", dateRange, platformId, dataSource, workspaceId],
    enabled: !!workspaceId,
    queryFn: async (): Promise<DashboardMetrics> => {
      const { start, end } = parseDateRange(dateRange);

      let accountIds: string[];
      try {
        accountIds = await fetchScopedAdAccountIds(workspaceId!, platformId);
      } catch (adAccountsError) {
        console.error("DASHBOARD FETCH ERROR (ad_accounts):", adAccountsError);
        throw adAccountsError;
      }

      // No ad accounts for this workspace/platform -> nothing to aggregate
      if (accountIds.length === 0) {
        return {
          totalImpressions: 0,
          totalClicks: 0,
          totalSpend: 0,
          totalConversions: 0,
          avgCtr: 0,
          avgCpc: 0,
          avgCpm: 0,
          avgRoas: 0,
          trendData: [],
        };
      }

      // The source filter is applied in the query rather than over the result,
      // so every number below — totals, averages and the trend series alike —
      // is derived from the same filtered set. Splitting them would let a card
      // and the chart under it disagree about what they are counting.
      //
      // `.in` over a one- or two-value list rather than a conditional `.eq`:
      // reassigning the builder to add a filter makes TypeScript give up on it
      // (TS2589, "type instantiation is excessively deep"), and a single chain
      // keeps the row type inferred.
      const { data: insights, error } = await supabase
        .from("ad_insights")
        // The six this function reads, out of eighteen on the table. Named
        // rather than `*` because this is the widest read on the hottest path —
        // every dashboard load pulls the whole date range — and the twelve
        // unused columns include the ones that keep growing (leads,
        // adds_to_cart, reach, and the pre-computed ctr/cpc/cpm this recomputes
        // from spend and clicks anyway).
        .select("date, impressions, clicks, spend, conversions, roas")
        .in("ad_account_id", accountIds)
        .in("data_source", sourcesFor(dataSource))
        .gte("date", start)
        .lte("date", end)
        .order("date", { ascending: true });

      if (error) {
        console.error("DASHBOARD FETCH ERROR (ad_insights):", error);
        throw error;
      }

      console.log(`DASHBOARD FETCH SUCCESS: Found ${insights?.length || 0} insights for ${start} to ${end}`);


      // Aggregate metrics
      const totalImpressions = insights?.reduce((sum, i) => sum + (i.impressions || 0), 0) || 0;
      const totalClicks = insights?.reduce((sum, i) => sum + (i.clicks || 0), 0) || 0;
      const totalSpend = insights?.reduce((sum, i) => sum + Number(i.spend || 0), 0) || 0;
      const totalConversions = insights?.reduce((sum, i) => sum + (i.conversions || 0), 0) || 0;

      const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
      const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
      const avgCpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;

      // Calculate ROAS
      const totalRoas = insights?.reduce((sum, i) => sum + Number(i.roas || 0), 0) || 0;
      const avgRoas = insights?.length ? totalRoas / insights.length : 0;

      // Group by date for trend data
      const trendMap: Record<string, { impressions: number; clicks: number; spend: number }> = {};
      insights?.forEach((i) => {
        const date = i.date;
        if (!trendMap[date]) {
          trendMap[date] = { impressions: 0, clicks: 0, spend: 0 };
        }
        trendMap[date].impressions += i.impressions || 0;
        trendMap[date].clicks += i.clicks || 0;
        trendMap[date].spend += Number(i.spend || 0);
      });

      const trendData = Object.entries(trendMap).map(([date, data]) => ({
        date,
        impressions: Number.isFinite(data.impressions) ? data.impressions : 0,
        clicks: Number.isFinite(data.clicks) ? data.clicks : 0,
        spend: Number.isFinite(data.spend) ? data.spend : 0,
      }));

      const safe = (n: number) => (Number.isFinite(n) ? n : 0);

      return {
        totalImpressions: safe(totalImpressions),
        totalClicks: safe(totalClicks),
        totalSpend: safe(totalSpend),
        totalConversions: safe(totalConversions),
        avgCtr: safe(avgCtr),
        avgCpc: safe(avgCpc),
        avgCpm: safe(avgCpm),
        avgRoas: safe(avgRoas),
        trendData,
      };
    },
  });
}
