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
 * `"all"` is the UI's word for no filter and is never stored — a CHECK
 * constraint admits only the four values above.
 */

/** The stored values, i.e. everything `"all"` covers. */
export const AD_DATA_SOURCES = ["mock", "meta_live", "import", "api"] as const;

export type AdDataSource = (typeof AD_DATA_SOURCES)[number];

export type AdDataSourceFilter = "all" | AdDataSource;

/**
 * The stored values a filter selects — every one of them for `"all"`.
 *
 * Callers pass this to `.in("data_source", …)` rather than adding a conditional
 * `.eq`, because reassigning a Supabase query builder to append a filter defeats
 * its type inference (TS2589). Listing every value is equivalent to no filter:
 * the column is NOT NULL and a CHECK constraint admits nothing else.
 *
 * `"api"` stays in this list even though it should match nothing. If a writer
 * ever forgets to declare its source, the row still has to appear in totals —
 * a number that silently stops summing is worse than one that looks wrong.
 */
export function sourcesFor(
  value: AdDataSourceFilter
): readonly AdDataSource[] {
  return value === "all" ? AD_DATA_SOURCES : [value];
}

/**
 * The filter dropdown. `"api"` is deliberately absent: it is a bug signal, not
 * a source a merchant should be asked to choose between.
 */
export const AD_DATA_SOURCE_OPTIONS: { value: AdDataSourceFilter; label: string }[] = [
  { value: "all", label: "ทุกแหล่งข้อมูล" },
  { value: "meta_live", label: "Meta (ข้อมูลจริง)" },
  { value: "import", label: "ไฟล์ที่อัปโหลด" },
  { value: "mock", label: "เซิร์ฟเวอร์จำลอง" },
];

/** Names the active filter in prose, for empty states that must not overclaim. */
export const AD_DATA_SOURCE_NOUN: Record<AdDataSourceFilter, string> = {
  all: "ข้อมูลทั้งหมด",
  import: "ข้อมูลจากไฟล์ที่อัปโหลด",
  mock: "ข้อมูลจำลองจากเซิร์ฟเวอร์ทดสอบ",
  meta_live: "ข้อมูลจริงจาก Meta",
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
