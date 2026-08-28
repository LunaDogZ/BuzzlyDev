// PORTED from `mock-api/meta/client.ts` — the read-only Meta Graph layer.
//
// One deliberate difference from the original: `readEnv`, `metaConfigStatus`,
// `loadMetaConfig` and `makeRedactor` are NOT ported. Each of them assumed a
// single token living in one process's environment, which is exactly the
// assumption OAuth removes — here the token belongs to a workspace and is read
// per request from `platform_oauth_tokens`. Porting them would have left a
// second, tenant-blind way to reach Meta sitting next to the right one.
// Redaction moved to `_shared/meta.ts` for the same reason.
//
// Everything else is unchanged, including the paging loop guards. See
// `metaMapping.ts` on the duplication with mock-api.

// Read-only access to the Meta Marketing API.
//
// Every call here is a GET. Nothing is ever written to Meta.
//
// Token handling matches `scripts/meta-probe.mjs`, and the rule is absolute:
// the token is never logged, never returned to the browser, and never left in
// an error message. Meta echoes the full request URL back inside some error
// payloads, and hands the token back inline in every `paging.next` link, so
// redaction is applied to error bodies and paging URLs too — not just to the
// lines we write ourselves.
//
// Credentials live in `mock-api/.env` (gitignored), loaded into `process.env`
// by `server.ts` at boot. Never name one `VITE_*`: Vite compiles those into the
// browser bundle, which would publish the token to every visitor.

import { MetaSyncRefused, type MetaAccount, type MetaInsightRow } from "./metaMapping.ts";

const DEFAULT_VERSION = "v23.0";
/** Meta's own page ceiling for insights is 500; asking for more is silently
 *  clamped, so 500 is the largest honest page size. */
const PAGE_LIMIT = 500;

export interface MetaConfig {
  token: string;
  version: string;
  adAccountId: string;
}

export class MetaApiError extends Error {
  readonly code?: number;
  readonly subcode?: number;
  readonly status: number;
  constructor(message: string, status: number, code?: number, subcode?: number) {
    super(message);
    this.name = "MetaApiError";
    this.status = status;
    this.code = code;
    this.subcode = subcode;
  }
}

interface GraphPage<T> {
  data?: T[];
  paging?: { next?: string | null };
  error?: { message?: string; code?: number; error_subcode?: number };
}

function buildUrl(config: MetaConfig, path: string, params: Record<string, string>): string {
  const url = new URL(`https://graph.facebook.com/${config.version}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("access_token", config.token);
  return url.toString();
}

async function getJson<T>(
  url: string,
  redact: (value: unknown) => string,
): Promise<GraphPage<T> & Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (e) {
    throw new MetaApiError(`ติดต่อ Meta ไม่ได้: ${redact(e instanceof Error ? e.message : e)}`, 502);
  }
  const text = await response.text();
  let body: GraphPage<T> & Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    throw new MetaApiError(`Meta ตอบกลับไม่ใช่ JSON: ${redact(text.slice(0, 300))}`, 502);
  }
  if (!response.ok || body.error) {
    const error = body.error ?? {};
    throw new MetaApiError(
      redact(error.message ?? text.slice(0, 300)),
      response.status,
      error.code,
      error.error_subcode,
    );
  }
  return body;
}

/** Follow `paging.next` to the end.
 *
 *  `maxPages` is a stop, not a tuning knob: a paging bug that loops would
 *  otherwise spend the app's rate limit and hang the request. 200 pages × 500
 *  rows is 100k daily ad rows, far past anything this account can produce. */
async function getAllPages<T>(
  startUrl: string,
  redact: (value: unknown) => string,
  maxPages = 200,
): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = startUrl;
  let pages = 0;
  const seen = new Set<string>();
  while (url) {
    if (++pages > maxPages) {
      throw new MetaApiError(`Meta paging เกิน ${maxPages} หน้า — หยุดเพื่อกันลูป`, 502);
    }
    if (seen.has(url)) {
      throw new MetaApiError("Meta paging วนกลับมาที่หน้าเดิม — หยุดเพื่อกันลูป", 502);
    }
    seen.add(url);
    const body: GraphPage<T> = await getJson<T>(url, redact);
    out.push(...(body.data ?? []));
    url = body.paging?.next ?? null;
  }
  return out;
}

// ─── Calls ───────────────────────────────────────────────────────────────────

export async function fetchAccount(
  config: MetaConfig,
  redact: (value: unknown) => string,
): Promise<MetaAccount> {
  const url = buildUrl(config, `/${config.adAccountId}`, {
    fields: "id,name,currency,timezone_name,account_status",
  });
  return (await getJson<never>(url, redact)) as MetaAccount;
}

export interface MetaCampaign {
  id: string;
  name?: string | null;
  status?: string | null;
  objective?: string | null;
}

export async function fetchCampaigns(
  config: MetaConfig,
  redact: (value: unknown) => string,
): Promise<MetaCampaign[]> {
  const url = buildUrl(config, `/${config.adAccountId}/campaigns`, {
    fields: "id,name,status,objective",
    limit: String(PAGE_LIMIT),
  });
  return getAllPages<MetaCampaign>(url, redact);
}

export interface MetaAd {
  id: string;
  name?: string | null;
  effective_status?: string | null;
}

export async function fetchAds(
  config: MetaConfig,
  redact: (value: unknown) => string,
): Promise<MetaAd[]> {
  const url = buildUrl(config, `/${config.adAccountId}/ads`, {
    fields: "id,name,effective_status",
    limit: String(PAGE_LIMIT),
  });
  return getAllPages<MetaAd>(url, redact);
}

/** Daily, ad-level insights for a closed date range.
 *
 *  ⚠️ Two distinct things, and conflating them produces wrong averages:
 *
 *  1. Meta OMITS most days with no activity. A 30-day window commonly comes
 *     back with four rows. A missing day is NOT a zero and must never be filled
 *     in with one — an invented zero would drag every average the dashboard
 *     computes and would be indistinguishable from a day the advertiser really
 *     spent nothing.
 *  2. Meta also RETURNS some all-zero rows — measured on the live account:
 *     31 rows over its whole history, 7 of them impressions 0 / clicks 0 /
 *     spend 0. Those are kept, because a zero Meta stated is a measurement.
 *
 *  So "row count" is not "days advertised". See `MetaPayload.totals`. */
export async function fetchAdInsights(
  config: MetaConfig,
  redact: (value: unknown) => string,
  range: { since: string; until: string },
): Promise<MetaInsightRow[]> {
  const url = buildUrl(config, `/${config.adAccountId}/insights`, {
    level: "ad",
    time_increment: "1",
    time_range: JSON.stringify({ since: range.since, until: range.until }),
    fields: [
      "date_start",
      "date_stop",
      "campaign_id",
      "campaign_name",
      "adset_id",
      "adset_name",
      "ad_id",
      "ad_name",
      "impressions",
      "clicks",
      "reach",
      "spend",
      "ctr",
      "cpc",
      "cpm",
      "actions",
      // The money behind `actions`. A separate field, not a property of them:
      // ask for `actions` alone and revenue never arrives, which is why this
      // pipeline computed ROAS from nothing for as long as it did.
      "action_values",
    ].join(","),
    limit: String(PAGE_LIMIT),
  });
  return getAllPages<MetaInsightRow>(url, redact);
}

// ─── Window helpers ──────────────────────────────────────────────────────────

/** Today's date in a named timezone, as YYYY-MM-DD.
 *
 *  Meta interprets `time_range` in the ad account's own timezone, which for
 *  this account is Asia/Bangkok. Deriving the window from UTC instead would
 *  drop the current Bangkok day for seven hours out of every twenty-four. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function shiftDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/** The default window: a rolling 30 days ending today, in the account's
 *  timezone.
 *
 *  Re-fetched in full on every run rather than only the new days, because Meta
 *  restates attributed conversions for roughly 28 days after the fact. The
 *  unique key `(ad_account_id, ads_id, date)` makes the re-write idempotent, so
 *  the cost of re-reading is one request and the benefit is that a restated day
 *  is corrected instead of frozen at whatever it looked like the first time. */
export const ATTRIBUTION_WINDOW_DAYS = 30;

export function rollingWindow(timezone: string, now: Date = new Date()): {
  since: string;
  until: string;
} {
  const until = todayIn(timezone, now);
  return { since: shiftDays(until, -(ATTRIBUTION_WINDOW_DAYS - 1)), until };
}
