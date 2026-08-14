import { AD_DATA_SOURCE_NOUN } from "@/constants/adDataSource";
import type { DashboardMetrics } from "@/hooks/useDashboardMetrics";

/**
 * Why no ROAS is on screen — in the merchant's own language, naming the cause.
 *
 * `computeRoas` decides *whether* a figure may be stated; this decides what to
 * say when it may not. Kept together with the numbers it describes and shared
 * by every page that renders them, so the Dashboard and /analytics cannot end
 * up offering two different explanations of the same blank.
 *
 * "—" on its own is honest but useless: a merchant reads it as a bug in the app
 * rather than as a fact about their data, and the fix — look at a source that
 * reports revenue — is invisible. Each branch below names which condition
 * failed, and the middle one names the source by the same noun the filter uses.
 */
export function roasWithheldReason(
  metrics: Pick<DashboardMetrics, "revenueCoverage" | "sourcesWithoutRevenue" | "totalSpend">
): string {
  if (metrics.revenueCoverage.total === 0) {
    return "ยังไม่มีข้อมูลในช่วงเวลานี้";
  }

  if (metrics.sourcesWithoutRevenue.length > 0) {
    // Named, not counted. "2 sources do not report revenue" tells a merchant
    // nothing they can act on; "the uploaded files do not report revenue" tells
    // them to look at the Meta view instead.
    const names = metrics.sourcesWithoutRevenue.map((source) => AD_DATA_SOURCE_NOUN[source]);
    return `${names.join(" และ ")}ไม่ได้รายงานรายได้ จึงยังคำนวณ ROAS ไม่ได้`;
  }

  // Every source reported, so the only remaining gate is the denominator.
  return "ยังไม่มีค่าโฆษณาในช่วงนี้";
}

/**
 * The figure itself, carrying its own qualifier.
 *
 * The `≥` is not decoration. Meta omits `action_values` from days it attributed
 * no purchase value to, and two of the live account's rows report a purchase
 * whose price it never stated — so the revenue total is a floor while the spend
 * total is complete, and the quotient can only understate. Dropping the sign
 * would turn a bound into a claim.
 *
 * When every row did report, there is nothing missing to bound and the number
 * is stated plainly.
 */
export function formatRoas(
  metrics: Pick<DashboardMetrics, "revenueCoverage" | "minRoas">
): string | null {
  if (metrics.minRoas === null) return null;

  const { withRevenue, total } = metrics.revenueCoverage;
  const isComplete = total > 0 && withRevenue === total;

  return `${isComplete ? "" : "≥ "}${metrics.minRoas.toFixed(1)}x`;
}
