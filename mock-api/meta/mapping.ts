// Meta Marketing API insights → Buzzly's ad tables.
//
// Pure functions only: no network, no Supabase, no clock, no randomness. Every
// rule the founder signed off on 2026-08-12 lives here so it can be tested
// without a token and re-read without tracing HTTP calls. `client.ts` fetches,
// `server.ts` writes, this file decides what the numbers mean.
//
// The one rule that shapes everything else: a number that came off Meta must
// reach Postgres as the same number. Money and rates therefore travel as
// STRINGS end to end — parsing "15.90" into a JS float and printing it back is
// how ฿0.01 goes missing, and the whole thesis claim is that these figures
// reconcile. Counts are parsed to integers because they are exact in a double
// up to 2^53 and the caller has to count them anyway.

import { createHash } from "node:crypto";

/** Namespace for derived ids. Mirrors `targets.IMPORT_NAMESPACE` in intent:
 *  a natural key maps to the same uuid forever, so a re-sync upserts rather
 *  than duplicates. It is a DIFFERENT constant from the import pipeline's on
 *  purpose — a Meta ad and an imported ad with the same name are not the same
 *  ad, and colliding them would merge real spend into a fixture's row. */
export const META_NAMESPACE = "9f1d6b8e-2c47-5a91-8e3f-7d0a4b6c1e52";

/** RFC 4122 v5 (SHA-1) uuid. Implemented here rather than pulled in as a
 *  dependency: `mock-api/package.json` has three deps and this is fifteen
 *  lines. */
export function uuid5(namespace: string, name: string): string {
  const hex = namespace.replace(/-/g, "");
  if (hex.length !== 32 || /[^0-9a-f]/i.test(hex)) {
    throw new Error(`uuid5: namespace is not a uuid: ${namespace}`);
  }
  const hash = createHash("sha1")
    .update(Buffer.concat([Buffer.from(hex, "hex"), Buffer.from(name, "utf8")]))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const s = bytes.toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** A stable uuid for a natural key. `\x1f` (unit separator) joins the parts so
 *  no part can impersonate a boundary — ("a", "b|c") and ("a|b", "c") must not
 *  produce the same id. */
export function derivedId(kind: string, ...parts: string[]): string {
  return uuid5(META_NAMESPACE, [kind, ...parts].join("\x1f"));
}

// ─── Exact decimal arithmetic ────────────────────────────────────────────────

/** Add fixed-point decimal strings exactly, via BigInt.
 *
 *  Used for the totals this endpoint reports back. `0.1 + 0.2` is the reason:
 *  a summary line that disagrees with `SELECT sum(spend)` by a rounding error
 *  is a measurement defect, not a display quirk, and KPI-1 compares totals. */
export function addDecimals(values: readonly string[]): string {
  let scale = 0;
  for (const v of values) {
    const dot = v.indexOf(".");
    if (dot !== -1) scale = Math.max(scale, v.length - dot - 1);
  }
  let total = 0n;
  for (const v of values) {
    const negative = v.startsWith("-");
    const body = negative ? v.slice(1) : v;
    const [whole, fraction = ""] = body.split(".");
    const digits = `${whole}${fraction.padEnd(scale, "0")}`;
    if (!/^\d+$/.test(digits)) {
      throw new Error(`addDecimals: not a decimal number: ${v}`);
    }
    const magnitude = BigInt(digits);
    total += negative ? -magnitude : magnitude;
  }
  if (scale === 0) return total.toString();
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
  const out = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${out}` : out;
}

// ─── Meta's shapes ───────────────────────────────────────────────────────────

export interface MetaAction {
  action_type?: string | null;
  value?: string | number | null;
}

/** One row of `/{account}/insights?level=ad&time_increment=1`. Every metric
 *  arrives as a string; Meta omits a field entirely when it has no value, which
 *  is not the same as zero. */
export interface MetaInsightRow {
  date_start?: string | null;
  date_stop?: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  adset_id?: string | null;
  adset_name?: string | null;
  ad_id?: string | null;
  ad_name?: string | null;
  impressions?: string | null;
  clicks?: string | null;
  reach?: string | null;
  spend?: string | null;
  ctr?: string | null;
  cpc?: string | null;
  cpm?: string | null;
  actions?: MetaAction[] | null;
}

export interface MetaAccount {
  id?: string | null;
  name?: string | null;
  currency?: string | null;
  timezone_name?: string | null;
  account_status?: number | null;
}

// ─── Conversion action types ─────────────────────────────────────────────────
//
// Allow-lists, never prefix matching. `omni_purchase` is Meta's cross-surface
// roll-up: it already contains both of the entries below, so adding it to the
// sum double-counts every purchase. It is excluded here deliberately and by
// name, because "sum everything that looks like a purchase" is exactly the bug.
//
// ⚠️ UNVERIFIED AGAINST LIVE DATA. The connected account
// (act_1025260845170202) has run messaging campaigns only — zero purchase,
// add-to-cart and lead actions across its whole history — so these three lists
// are built from Meta's documented action types and have never been exercised
// on a real payload. Say so when reporting conversion figures from it.

export const PURCHASE_ACTIONS = [
  "offsite_conversion.fb_pixel_purchase",
  "onsite_conversion.purchase",
] as const;

export const ADD_TO_CART_ACTIONS = [
  "offsite_conversion.fb_pixel_add_to_cart",
  "onsite_conversion.add_to_cart",
] as const;

/** `leadgen_grouped` is the lead-ads form submission; the other two are the
 *  pixel and on-site equivalents. The bare `lead` type is excluded for the same
 *  reason as `omni_purchase` — it aggregates the others. */
export const LEAD_ACTIONS = [
  "leadgen_grouped",
  "offsite_conversion.fb_pixel_lead",
  "onsite_conversion.lead",
] as const;

/** Sum the values of the named action types. Returns null — not 0 — when the
 *  row carries no `actions` array at all, because Meta omitting the field means
 *  "nothing reported", and a stored 0 would be a claim we did not measure. */
export function sumActions(
  actions: MetaAction[] | null | undefined,
  types: readonly string[],
): number | null {
  if (!Array.isArray(actions)) return null;
  const wanted = new Set(types);
  let total = 0;
  let matched = false;
  for (const action of actions) {
    if (!action?.action_type || !wanted.has(action.action_type)) continue;
    const value = Number(action.value);
    if (!Number.isFinite(value)) continue;
    total += value;
    matched = true;
  }
  return matched ? total : 0;
}

// ─── Field coercion ──────────────────────────────────────────────────────────

/** Meta sends counts as strings. Absent stays absent: see `sumActions`. */
export function toCount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/** Money and rates pass through untouched, as strings, all the way to
 *  PostgREST — which hands them to Postgres, which parses them into `numeric`
 *  at full precision. Routing them through `Number()` first would round-trip
 *  every value through a binary float for no reason at all. */
export function toDecimal(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return text;
}

// ─── Currency guard ──────────────────────────────────────────────────────────

export class MetaSyncRefused extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "MetaSyncRefused";
    this.reason = reason;
  }
}

/** `ad_insights` has no currency column. A USD account would be summed into the
 *  same ฿ totals as a THB one and nothing downstream could tell — the dashboard
 *  would show a confident, wrong number. Refusing with a stated reason is the
 *  only honest option until the schema can carry a currency. */
export function assertSupportedCurrency(account: MetaAccount): void {
  const currency = (account.currency ?? "").toUpperCase();
  if (currency !== "THB") {
    throw new MetaSyncRefused(
      "UNSUPPORTED_CURRENCY",
      `บัญชีโฆษณานี้ใช้สกุลเงิน ${currency || "(ไม่ทราบ)"} — Buzzly รองรับเฉพาะ THB ` +
        "เพราะตาราง ad_insights ไม่มีคอลัมน์สกุลเงิน การนำเข้าจะทำให้ยอดรวมผิดโดยไม่มีใครเห็น",
    );
  }
}

// ─── The mapping itself ──────────────────────────────────────────────────────

export interface MetaMappingContext {
  teamId: string;
  adAccountId: string;
  /** The platform slug the connection syncs under. A Meta connection is stored
   *  as `facebook`, which is also what the mock sync deletes by — hence the
   *  `meta:` prefix on `platform_ad_id` below, which is what keeps these rows
   *  out of that delete's blast radius (see server.ts §3). */
  platform: string;
}

export interface CampaignRow {
  id: string;
  team_id: string;
  ad_account_id: string;
  name: string;
  status: string;
  objective: string | null;
}

export interface AdGroupRow {
  id: string;
  team_id: string;
  name: string;
  source_platform: string;
  external_group_id: string;
  status: string;
}

export interface AdRow {
  id: string;
  team_id: string;
  ad_group_id: string | null;
  name: string;
  platform: string;
  platform_ad_id: string;
  status: string;
  external_status: string;
}

export interface InsightRow {
  ad_account_id: string;
  campaign_id: string;
  ads_id: string;
  date: string;
  impressions: number | null;
  clicks: number | null;
  reach: number | null;
  conversions: number | null;
  adds_to_cart: number | null;
  leads: number | null;
  spend: string | null;
  ctr: string | null;
  cpc: string | null;
  cpm: string | null;
  roas: null;
  data_source: "meta_live";
}

export interface MetaPayload {
  campaigns: CampaignRow[];
  campaignWindows: { id: string; start_date: string; end_date: string }[];
  adGroups: AdGroupRow[];
  ads: AdRow[];
  campaignAds: { campaign_id: string; ad_id: string }[];
  insights: InsightRow[];
  /** Rows Meta returned that could not be mapped, with the reason. Reported,
   *  never dropped in silence. */
  skipped: { reason: string; date: string | null; adId: string | null }[];
  totals: {
    spend: string;
    impressions: number;
    clicks: number;
    /** Distinct dates Meta returned a row for. */
    days: number;
    /** Distinct dates that actually cost money.
     *
     *  ⚠️ These two differ, and the difference was measured, not assumed: the
     *  live account's full history came back as 31 rows over 26 dates of which
     *  **7 rows were entirely zero** — impressions 0, clicks 0, spend 0. So the
     *  common shorthand "Meta only returns days that had delivery" is NOT true;
     *  it returns days the ad set was scheduled, some of which delivered
     *  nothing. Reporting `days` to a merchant as "days you advertised" would
     *  therefore overstate it by a quarter on this account. The zero rows are
     *  still stored — a zero Meta reported is a measurement, unlike a zero we
     *  would have invented for a date Meta omitted entirely. */
    activeDays: number;
  };
}

/** Meta's delivery vocabulary → the app's. Unknown values fall through to
 *  `paused` rather than `active`: claiming an ad is running when we do not
 *  recognise its state is the more expensive mistake. */
export function mapAdStatus(effectiveStatus: string | null | undefined): string {
  switch ((effectiveStatus ?? "").toUpperCase()) {
    case "ACTIVE":
      return "active";
    case "":
      return "active"; // not fetched — the insight itself proves it delivered
    case "ARCHIVED":
    case "DELETED":
      return "archived";
    case "CAMPAIGN_PAUSED":
    case "ADSET_PAUSED":
    case "PAUSED":
      return "paused";
    default:
      return "paused";
  }
}

export interface MetaEnrichment {
  /** `ad_id` → effective_status, from `/{account}/ads`. */
  adStatus?: Map<string, string>;
  /** `campaign_id` → { status, objective }, from `/{account}/campaigns`. */
  campaignMeta?: Map<string, { status?: string | null; objective?: string | null }>;
}

/**
 * Build every row a Meta sync writes, from the daily ad-level insight rows.
 *
 * Grain is ad-level daily and that is not a preference: the idempotency key is
 * `ad_insights (ad_account_id, ads_id, date)` with NULLS NOT DISTINCT, so
 * campaign-level rows would collide into one the first day two campaigns both
 * deliver, and the second campaign's spend would overwrite the first's.
 *
 * Everything is derived from the insight rows alone. The `/campaigns` and
 * `/ads` calls only enrich (status, objective) — an ad that Meta reports
 * insights for but excludes from `/ads` (archived mid-window) still gets a row,
 * because the spend happened whether or not the ad still exists.
 */
export function buildMetaPayload(
  rows: readonly MetaInsightRow[],
  context: MetaMappingContext,
  enrichment: MetaEnrichment = {},
): MetaPayload {
  const { teamId, adAccountId, platform } = context;
  const campaigns = new Map<string, CampaignRow>();
  const windows = new Map<string, { min: string; max: string }>();
  const adGroups = new Map<string, AdGroupRow>();
  const ads = new Map<string, AdRow>();
  const campaignAds = new Map<string, { campaign_id: string; ad_id: string }>();
  const insights = new Map<string, InsightRow>();
  const skipped: MetaPayload["skipped"] = [];

  for (const row of rows) {
    const date = (row.date_start ?? "").trim();
    const metaAdId = (row.ad_id ?? "").trim();
    const metaCampaignId = (row.campaign_id ?? "").trim();

    // No ad id means the row cannot take part in the unique key as anything
    // but a NULL, and NULLS NOT DISTINCT would merge it with every other such
    // row on the day. Refusing to store it beats storing one campaign's
    // numbers under all of them.
    if (!date || !metaAdId || !metaCampaignId) {
      skipped.push({
        reason: !date
          ? "missing date_start"
          : !metaAdId
            ? "missing ad_id"
            : "missing campaign_id",
        date: date || null,
        adId: metaAdId || null,
      });
      continue;
    }

    const campaignId = derivedId("campaign", teamId, metaCampaignId);
    const meta = enrichment.campaignMeta?.get(metaCampaignId);
    if (!campaigns.has(campaignId)) {
      campaigns.set(campaignId, {
        id: campaignId,
        team_id: teamId,
        ad_account_id: adAccountId,
        name: (row.campaign_name ?? "").trim() || `Meta campaign ${metaCampaignId}`,
        status: mapAdStatus(meta?.status),
        objective: meta?.objective ?? null,
      });
    }
    const window = windows.get(campaignId);
    if (!window) {
      windows.set(campaignId, { min: date, max: date });
    } else {
      if (date < window.min) window.min = date;
      if (date > window.max) window.max = date;
    }

    let adGroupId: string | null = null;
    const metaAdsetId = (row.adset_id ?? "").trim();
    if (metaAdsetId) {
      adGroupId = derivedId("ad_group", teamId, metaAdsetId);
      if (!adGroups.has(adGroupId)) {
        adGroups.set(adGroupId, {
          id: adGroupId,
          team_id: teamId,
          name: (row.adset_name ?? "").trim() || `Meta ad set ${metaAdsetId}`,
          source_platform: platform,
          external_group_id: `meta:${metaAdsetId}`,
          status: "active",
        });
      }
    }

    // Keyed on Meta's own ad id, not on the name: an advertiser renaming an ad
    // must not fork it into a second row, and two ads sharing a name must not
    // merge into one.
    const adId = derivedId("ad", teamId, metaAdId);
    if (!ads.has(adId)) {
      ads.set(adId, {
        id: adId,
        team_id: teamId,
        ad_group_id: adGroupId,
        name: (row.ad_name ?? "").trim() || `Meta ad ${metaAdId}`,
        platform,
        // THE guard. `mock-api`'s full-replace sync deletes ads on this exact
        // platform slug unless they carry an `import:` or `meta:` prefix, so
        // this string is what stops one click on "sync" from erasing real
        // spend. Never write an ad here without it.
        platform_ad_id: `meta:${metaAdId}`,
        status: mapAdStatus(enrichment.adStatus?.get(metaAdId)),
        external_status: "published",
      });
    }
    campaignAds.set(`${campaignId}\x1f${adId}`, { campaign_id: campaignId, ad_id: adId });

    // Meta returns at most one row per (ad, day) at this grain. A duplicate
    // would mean the window was paged twice; last write wins and the count of
    // stored rows will disagree with the count fetched, which the caller
    // reports.
    insights.set(`${adId}\x1f${date}`, {
      ad_account_id: adAccountId,
      campaign_id: campaignId,
      ads_id: adId,
      date,
      impressions: toCount(row.impressions),
      clicks: toCount(row.clicks),
      reach: toCount(row.reach),
      conversions: sumActions(row.actions, PURCHASE_ACTIONS),
      adds_to_cart: sumActions(row.actions, ADD_TO_CART_ACTIONS),
      leads: sumActions(row.actions, LEAD_ACTIONS),
      spend: toDecimal(row.spend),
      // Meta's `ctr` is already a percentage (1.70 means 1.70%), which is the
      // convention `targets.py` stores and the dashboard renders. No ×100.
      ctr: toDecimal(row.ctr),
      cpc: toDecimal(row.cpc),
      cpm: toDecimal(row.cpm),
      // Meta reports a ROAS of its own, from its own attribution. It is not the
      // wedge — True Net Profit needs the Shopee cost leg — and storing Meta's
      // claim in a column the dashboard labels as profit would be the exact
      // conflation this product exists to end. NULL until the Shopee leg lands.
      roas: null,
      data_source: "meta_live",
    });
  }

  const stored = [...insights.values()];
  const totals = {
    spend: addDecimals(stored.map((r) => r.spend ?? "0")),
    impressions: stored.reduce((sum, r) => sum + (r.impressions ?? 0), 0),
    clicks: stored.reduce((sum, r) => sum + (r.clicks ?? 0), 0),
    days: new Set(stored.map((r) => r.date)).size,
    activeDays: new Set(
      stored.filter((r) => r.spend !== null && Number(r.spend) > 0).map((r) => r.date),
    ).size,
  };

  return {
    campaigns: [...campaigns.values()],
    // Widening is enforced at write time (see server.ts): a rolling 30-day
    // re-sync knows nothing about the months before it, so replacing a
    // campaign's window with this fetch's range would shrink it every run.
    campaignWindows: [...windows.entries()].map(([id, w]) => ({
      id,
      start_date: `${w.min}T00:00:00Z`,
      end_date: `${w.max}T23:59:59Z`,
    })),
    adGroups: [...adGroups.values()],
    ads: [...ads.values()],
    campaignAds: [...campaignAds.values()],
    insights: stored,
    skipped,
    totals,
  };
}
