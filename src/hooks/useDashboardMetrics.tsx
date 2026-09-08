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

/**
 * Return on ad spend over the whole selection — a **lower bound** — or null when
 * not even a bound can be stated.
 *
 * Exported and pure for the same reason as `computeReachStats`: the division is
 * trivial and the rule about when it may be performed at all is not.
 *
 * **1. Σrevenue ÷ Σspend, never the mean of per-row ratios.** The old code
 * averaged a stored `roas` column, which weighs a row that spent ฿1 exactly as
 * heavily as one that spent ฿1,000. That is not a return on anything.
 *
 * **2. The gate is per SOURCE, not per row — and the reason is measured.**
 * Meta omits `action_values` from any day it attributed no purchase value to,
 * so on the live account only 6 of 32 rows carry revenue while all 32 carry
 * spend. Requiring every row to report would withhold the figure permanently on
 * real data. But "absent means zero" is not safe either: two of those 26 rows
 * report a purchase *count* with no value at all (2025-07-17 and 2025-12-12),
 * so a purchase happened whose price Meta never stated.
 *
 * What survives both facts is a bound. Missing revenue is missing in one
 * direction only — whatever Meta did not state is ≥ 0 — while spend is complete
 * on every row. So the quotient can only **understate**: true attributed return
 * is at least this. The UI must render it with a `≥`, exactly as `minFrequency`
 * is, unless coverage happens to be complete.
 *
 * That bound is only worth stating when every source in the selection reports
 * revenue at all. Mixing 31 Meta rows with 273 imported rows that will never
 * carry revenue yields a technically-true bound near zero — true, useless, and
 * read as "your ads lose money". Which sources report is derived from the rows
 * themselves rather than from a hard-coded list of capable sources: enumerating
 * sources is how `meta_live` got missed by the delete guard, and a list would
 * silently exclude the next connector until someone remembered to edit it.
 */
export function computeRoas(
  rows: readonly { revenue: number | null; data_source: string }[],
  totalSpend: number
): Pick<
  DashboardMetrics,
  "totalRevenue" | "revenueCoverage" | "sourcesWithoutRevenue" | "minRoas"
> {
  // NULL and 0 are different claims: a source that reports revenue and reports
  // none has measured something. Only NULL is silence.
  const rowsWithRevenue = rows.filter((row) => row.revenue !== null);
  const totalRevenue = rowsWithRevenue.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  const revenueCoverage = { withRevenue: rowsWithRevenue.length, total: rows.length };

  // A source counts as reporting if it produced a revenue figure anywhere in
  // this selection. Ordered by AD_DATA_SOURCES so the sentence built from this
  // does not reword itself when rows come back in a different order.
  const reporting = new Set(rowsWithRevenue.map((row) => row.data_source));
  const present = new Set(rows.map((row) => row.data_source));
  const sourcesWithoutRevenue = AD_DATA_SOURCES.filter(
    (source) => present.has(source) && !reporting.has(source)
  );

  const everySourceReports = rows.length > 0 && sourcesWithoutRevenue.length === 0;
  const quotient = everySourceReports && totalSpend > 0 ? totalRevenue / totalSpend : null;

  return {
    totalRevenue,
    revenueCoverage,
    sourcesWithoutRevenue,
    // Null rather than 0 for a non-finite result. 0.0x reads as "every baht was
    // wasted", which is a measurement, and printing it for rows nobody measured
    // is the fabrication 9b12678 removed from this same dashboard.
    minRoas: quotient !== null && Number.isFinite(quotient) ? quotient : null,
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
  /**
   * Revenue summed over the rows that reported any, in THB.
   *
   * Read it with `revenueCoverage`, never alone: over a mixed selection this is
   * a total for part of the rows, not for the window. And whatever it totals,
   * it is revenue the *platform attributes* to its own ads — not confirmed
   * income, and not the True Net Profit the product is ultimately for.
   */
  totalRevenue: number;
  /**
   * How many of the aggregated rows carried a revenue value at all.
   *
   * Nullable and unevenly populated by construction: only the Meta connector
   * writes it (`action_values` under the purchase allow-list). Imported rows
   * and mock rows are NULL, because no one asked those sources the question.
   */
  revenueCoverage: { withRevenue: number; total: number };
  /**
   * Sources present in these rows that produced no revenue figure at all.
   *
   * Non-empty is exactly the condition that withholds `minRoas`, and it is what
   * the UI names when explaining the blank — "the uploaded files do not report
   * revenue" is actionable where "cannot be calculated" is not.
   */
  sourcesWithoutRevenue: AdDataSource[];
  /**
   * Σrevenue ÷ Σspend — a **lower bound** on the return, or null.
   *
   * Non-null only when every source in the selection reported revenue somewhere
   * and spend is positive. Render it with a `≥` (see `computeRoas` for why the
   * error has a known direction), and render null as "—" with the reason, never
   * as 0.0x. When `revenueCoverage` is complete the bound is tight and the `≥`
   * may be dropped.
   */
  minRoas: number | null;
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
/**
 * The read underneath `fetchScopedAdAccountIds`, deduplicated while in flight.
 *
 * Three hooks call the scoper inside their own queryFn — useDashboardMetrics,
 * useAdDataRange, useAdSourceCounts — and React Query starts those together, so
 * the same row set was fetched three to five times per dashboard load. The
 * request does not depend on `platformId` at all: the platform filter below
 * happens in memory, so every caller wants the identical rows.
 *
 * Only overlapping calls are shared, and nothing is retained afterwards. That
 * matters here more than it saves: connecting a platform writes an `ad_accounts`
 * row, and a cache held across time would leave the dashboard denying the
 * account exists until it expired. With no window there is nothing to
 * invalidate and nothing to get wrong.
 */
type AdAccountRow = { id: string; platform_id: string };
const adAccountsInFlight = new Map<string, Promise<AdAccountRow[]>>();

function fetchAdAccountsForWorkspace(workspaceId: string): Promise<AdAccountRow[]> {
  const pending = adAccountsInFlight.get(workspaceId);
  if (pending) return pending;

  const request = (async () => {
    const { data, error } = await supabase
      .from("ad_accounts")
      .select("id, platform_id")
      .eq("team_id", workspaceId);
    if (error) throw error;
    return (data ?? []) as AdAccountRow[];
  })().finally(() => {
    adAccountsInFlight.delete(workspaceId);
  });

  adAccountsInFlight.set(workspaceId, request);
  return request;
}

export async function fetchScopedAdAccountIds(
  workspaceId: string,
  platformId: string
): Promise<string[]> {
  const adAccounts = await fetchAdAccountsForWorkspace(workspaceId);

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
          totalRevenue: 0,
          revenueCoverage: { withRevenue: 0, total: 0 },
          sourcesWithoutRevenue: [],
          minRoas: null,
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
        //
        // `revenue` was added 2026-08-14 and `roas` is no longer read from the
        // row — see `computeRoas`. The column is still selected because
        // dropping it from this list is a schema-adjacent decision, and leaving
        // it visible keeps the next reader from assuming it was never there.
        .select("date, impressions, clicks, spend, conversions, reach, revenue, roas, data_source")
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

      // ROAS from the two money columns, not from the stored `roas` ratio.
      // `roas` is left in the table (the mock rows carry one) but is no longer
      // read here: it is NULL on every real Meta row and, where it exists, is a
      // per-row ratio that cannot be averaged into a portfolio return.
      const { totalRevenue, revenueCoverage, sourcesWithoutRevenue, minRoas } = computeRoas(
        insights ?? [],
        totalSpend
      );

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
        totalRevenue: safe(totalRevenue),
        revenueCoverage,
        sourcesWithoutRevenue,
        // Deliberately not passed through `safe`, which collapses to 0.
        minRoas,
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
