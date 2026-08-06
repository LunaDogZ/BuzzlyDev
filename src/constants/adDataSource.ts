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
 * `"all"` is the UI's word for no filter and is never stored — the column holds
 * only `"api"` or `"import"`, and a CHECK constraint enforces it.
 */
export type AdDataSourceFilter = "all" | "import" | "api";

/** The stored values, i.e. everything `"all"` covers. */
export const AD_DATA_SOURCES = ["api", "import"] as const;

/**
 * The stored values a filter selects — `["api", "import"]` for `"all"`.
 *
 * Callers pass this to `.in("data_source", …)` rather than adding a conditional
 * `.eq`, because reassigning a Supabase query builder to append a filter defeats
 * its type inference (TS2589). Listing both values is equivalent to no filter:
 * the column is NOT NULL and a CHECK constraint admits nothing else.
 */
export function sourcesFor(
  value: AdDataSourceFilter
): readonly (typeof AD_DATA_SOURCES)[number][] {
  return value === "all" ? AD_DATA_SOURCES : [value];
}

export const AD_DATA_SOURCE_OPTIONS: { value: AdDataSourceFilter; label: string }[] = [
  { value: "all", label: "All sources" },
  { value: "import", label: "Imported files" },
  { value: "api", label: "Connected API" },
];

/** Names the active filter in prose, for empty states that must not overclaim. */
export const AD_DATA_SOURCE_NOUN: Record<AdDataSourceFilter, string> = {
  all: "ข้อมูลทั้งหมด",
  import: "ข้อมูลจากไฟล์ที่อัปโหลด",
  api: "ข้อมูลจากการเชื่อม API",
};
