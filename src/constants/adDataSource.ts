/**
 * Where a workspace's ad numbers came from.
 *
 * A merchant reading a ROAS figure needs to know whether it arrived from a live
 * platform connection or from a spreadsheet they uploaded last month — the two
 * answer different questions, and until `ad_insights.data_source` existed
 * (migration 20260806090000) they were indistinguishable, because
 * `ad_accounts` is UNIQUE (team_id, platform_id) and an import has to adopt the
 * account the merchant connected.
 *
 * Migration 20260812060000 then split the old `"api"` value in two, because it
 * was making one claim while meaning another: every `"api"` row was written by
 * the mock server from fixtures, and a real Meta connector writing into the
 * same value would have made invented numbers and real spend indistinguishable.
 *
 *   "mock"       fixtures from mock-api — simulated, proves nothing
 *   "meta_live"  fetched from the Meta Marketing API for a real ad account
 *   "import"     a file the merchant uploaded through /imports
 *   "api"        legacy/unattributed; matches no row after 20260812060000
 *
 * `"all"` is the UI's word for the combined view and is never stored — a CHECK
 * constraint admits only the four values above. It does **not** mean "every
 * stored value"; see `UNAGGREGATED_SOURCES`.
 */

/** Every stored value the column can hold. */
export const AD_DATA_SOURCES = ["mock", "meta_live", "import", "api"] as const;

export type AdDataSource = (typeof AD_DATA_SOURCES)[number];

export type AdDataSourceFilter = "all" | AdDataSource;

/**
 * Sources deliberately left OUT of the combined view.
 *
 * `"mock"` is fixture data. Summing it together with real spend produces a
 * total that is part measurement and part fiction, and nothing on screen can
 * tell a reader which part is which — so the combined view carries real
 * sources only, and fixtures are reachable only by asking for them by name.
 *
 * This is a deliberate departure from "the unfiltered view sums everything".
 * The rule that replaces it is narrower but still load-bearing: a source is
 * summed unless it is listed here, so adding a fifth *real* source to the
 * column joins the total automatically rather than silently dropping out.
 */
export const UNAGGREGATED_SOURCES: readonly AdDataSource[] = ["mock"];

/** What `"all"` actually aggregates — every stored value except the fixtures. */
export const AGGREGATED_AD_DATA_SOURCES: readonly AdDataSource[] =
  AD_DATA_SOURCES.filter((value) => !UNAGGREGATED_SOURCES.includes(value));

/**
 * The stored values a filter selects.
 *
 * Callers pass this to `.in("data_source", …)` rather than adding a conditional
 * `.eq`, because reassigning a Supabase query builder to append a filter defeats
 * its type inference (TS2589).
 *
 * `"api"` stays in the aggregate even though it should match no row after
 * 20260812060000. If a writer ever forgets to declare its source, the row still
 * has to appear in the total — a number that silently stops summing is worse
 * than one that looks wrong. It is excluded from the *picker*, not from the sum.
 */
export function sourcesFor(
  value: AdDataSourceFilter
): readonly AdDataSource[] {
  return value === "all" ? AGGREGATED_AD_DATA_SOURCES : [value];
}

/**
 * The filter dropdown. `"api"` is deliberately absent: it is a bug signal, not
 * a source a merchant should be asked to choose between.
 */
export const AD_DATA_SOURCE_OPTIONS: { value: AdDataSourceFilter; label: string }[] = [
  // Each label names the ingestion *path*, not just the origin. "Meta API" vs
  // "mock-api" is the distinction that has to survive being read quickly: both
  // arrive over an API, and only one of them is real money.
  { value: "all", label: "ข้อมูลจริงทั้งหมด" },
  { value: "meta_live", label: "Meta API (บัญชีจริง)" },
  { value: "import", label: "ไฟล์ที่อัปโหลด (Airflow)" },
  { value: "mock", label: "เซิร์ฟเวอร์จำลอง (mock-api)" },
];

/** Names the active filter in prose, for empty states that must not overclaim. */
export const AD_DATA_SOURCE_NOUN: Record<AdDataSourceFilter, string> = {
  // Spells out the exclusion. Calling this "ทุกแหล่งข้อมูล" while it withholds
  // the fixtures would be a false claim in the one place a reader checks.
  all: "ข้อมูลจริงทั้งหมด (ไม่รวมเซิร์ฟเวอร์จำลอง)",
  import: "ข้อมูลจากไฟล์ที่อัปโหลด",
  mock: "ข้อมูลจำลองจากเซิร์ฟเวอร์ทดสอบ",
  meta_live: "ข้อมูลจริงจาก Meta API",
  api: "ข้อมูลที่ไม่ระบุแหล่งที่มา",
};

/**
 * Whether a set of rows contains anything a merchant must not read as real.
 *
 * `"api"` counts as not-real: it means a writer failed to say what it was, and
 * an unattributed number is not evidence of anything.
 */
export const SIMULATED_SOURCES: readonly AdDataSource[] = ["mock", "api"];

export function isSimulated(source: AdDataSource): boolean {
  return SIMULATED_SOURCES.includes(source);
}
