import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  AD_DATA_SOURCES,
  sourcesFor,
  type AdDataSource,
  type AdDataSourceFilter,
} from "@/constants/adDataSource";

/**
 * Reach totals and the frequency they do or do not support.
 *
 * Exported and pure so the rule can be tested without a database. The rule is
 * the whole point of the function — the addition is trivial, deciding when the
 * quotient may be shown at all is not.
 */
export function computeReachStats(
  rows: readonly { reach: number | null }[],
  totalImpressions: number
): Pick<DashboardMetrics, "summedDailyReach" | "reachCoverage" | "minFrequency"> {
  // Counted, not inferred from `rows.length`: a row whose reach is NULL has to
  // be distinguishable from one storing 0, because the first means the platform
  // never told us and the second means nobody was reached. Only the first
  // disqualifies the frequency.
  const rowsWithReach = rows.filter((row) => row.reach !== null);
  const summedDailyReach = rowsWithReach.reduce((sum, row) => sum + (row.reach || 0), 0);
  const reachCoverage = { withReach: rowsWithReach.length, total: rows.length };

  // Gated on complete coverage, not merely on a non-zero denominator. With
  // every row reporting, summing daily reach can only over-count people, so the
  // quotient can only understate — a lower bound the UI marks with `≥`. With
  // rows missing, the denominator is short by an unknown amount and the error
  // changes sign, so there is no bound left to state.
  const hasCompleteReach =
    reachCoverage.total > 0 && reachCoverage.withReach === reachCoverage.total;
  const quotient =
    hasCompleteReach && summedDailyReach > 0 ? totalImpressions / summedDailyReach : null;

  return {
    summedDailyReach,
    reachCoverage,
    // Null rather than 0 for a non-finite result: 0 would render as "≥ 0.0
    // times per person", which is a stated measurement. Null means "cannot be
    // stated".
    minFrequency: quotient !== null && Number.isFinite(quotient) ? quotient : null,
  };
}

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
  /**
   * Daily `reach` added up — NOT the number of people reached.
   *
   * The name is deliberately awkward because the short one would be a lie.
   * Reach is a distinct count of people, so it does not add across days: a
   * customer who saw the ad on Monday and again on Tuesday is one person and
   * two days' reach. Summing therefore returns an upper bound on the real
   * figure, and only a single-day window makes the two equal.
   *
   * Kept anyway because the ceiling is still informative next to impressions,
   * and because the honest alternative — asking Meta to deduplicate over the
   * window — is a different request than the one this hook makes.
   */
  summedDailyReach: number;
  /**
   * How many of the aggregated rows carried a reach value at all.
   *
   * `reach` is nullable and unevenly populated: measured 2026-08-14, `import`
   * has it on 150 of 273 rows while `meta_live` and `mock` have it on every
   * one. A partial column makes the sum too *small*, which is the opposite
   * error to the non-additivity above — so the two do not cancel into a safe
   * number, they make the direction of the error unknowable. Anything dividing
   * by the sum has to check this first.
   */
  reachCoverage: { withReach: number; total: number };
  /**
   * Impressions per person reached, or null when it cannot be stated soundly.
   *
   * Non-null only when every aggregated row carried reach. Under that
   * condition the sole remaining distortion is the double-counting above,
   * which inflates the denominator, so the quotient is a **lower bound** —
   * true frequency is at least this. The UI must render it with a `≥`.
   *
   * With partial coverage it is null rather than approximate: missing rows
   * shrink the denominator and push the quotient up, so the value could land
   * on either side of the truth and no honest qualifier exists for it.
   */
  minFrequency: number | null;
  /**
   * The distinct `data_source` values among the rows these totals were computed
   * from — not what the filter asked for, what actually arrived.
   *
   * This is what the "simulated data" badge reads. Deriving it from the filter
   * or from a build-time flag would let the badge disagree with the chart under
   * it: selecting "all" says nothing about whether any real row exists, and an
   * env var says nothing about what is in the database at all.
   */
  sourcesPresent: AdDataSource[];
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
          summedDailyReach: 0,
          reachCoverage: { withReach: 0, total: 0 },
          minFrequency: null,
          sourcesPresent: [],
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
        // Seven of the eighteen columns. Named rather than `*` because this is
        // the widest read on the hottest path — every dashboard load pulls the
        // whole date range — and the rest are either unused or recomputed here
        // from spend and clicks anyway (the stored ctr/cpc/cpm).
        //
        // `reach` was added 2026-08-14: it was being stored on every row and
        // read by nothing. `adds_to_cart` and `leads` are still left out, and
        // that is a measurement decision rather than an oversight — measured
        // the same day, `adds_to_cart` sums to zero across all 912 rows in the
        // database, and `leads` is non-zero only on `meta_live`, where it is
        // 29: exactly equal to `conversions`. Two action-type allow-lists
        // returning the identical total on a messaging account is far more
        // likely to be one set of events wearing two labels than two separate
        // outcomes, and showing both would read as 58. Resolving that needs a
        // look at the raw `actions` payload, not a column added here.
        //
        // `data_source` is the seventh, added for the badge: whether these
        // numbers are simulated has to be answered from the same rows the
        // numbers came from, and one short text column is a cheap way to never
        // have the badge and the chart disagree.
        .select("date, impressions, clicks, spend, conversions, reach, roas, data_source")
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

      const { summedDailyReach, reachCoverage, minFrequency } = computeReachStats(
        insights ?? [],
        totalImpressions
      );

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

      // Ordered by AD_DATA_SOURCES rather than by first appearance, so the
      // badge does not reword itself when the same data comes back in a
      // different row order.
      const present = new Set((insights ?? []).map((i) => i.data_source));
      const sourcesPresent = AD_DATA_SOURCES.filter((s) => present.has(s));

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
        summedDailyReach: safe(summedDailyReach),
        reachCoverage,
        // Deliberately not passed through `safe`, which collapses to 0.
        minFrequency,
        sourcesPresent,
      };
    },
  });
}
