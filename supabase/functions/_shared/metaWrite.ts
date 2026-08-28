// PORTED from `mock-api/server.ts` — the write half of a Meta sync.
//
// Same rule as the other two ported modules: the arithmetic and the conflict
// targets are reproduced as they were. The campaign-window union inside
// `writeMetaPayload` is load-bearing and is exactly the kind of thing a
// "simplify while porting" pass would break silently.
//
// Only the imports and the source of the `SupabaseClient` type changed, plus
// `export` on the two helpers the sync function calls.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { MetaPayload } from "./metaMapping.ts";

const META_WRITE_CHUNK = 500;

function chunk<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export async function upsertChunked<T extends object>(
  supabase: SupabaseClient,
  table: string,
  rows: readonly T[],
  onConflict: string,
): Promise<number> {
  for (const part of chunk(rows, META_WRITE_CHUNK)) {
    const { error } = await supabase.from(table).upsert(part as never, { onConflict });
    // Never swallowed. A half-written sync that reports success is the failure
    // mode that makes a dashboard confidently wrong, which is the one outcome
    // this product cannot have.
    if (error) {
      throw new Error(`${table} upsert failed: ${error.message}`);
    }
  }
  return rows.length;
}

/**
 * Write a built Meta payload in foreign-key order.
 *
 * Campaign date windows only ever WIDEN. A sync re-reads a rolling 30 days and
 * knows nothing about the months before it, so writing this fetch's range
 * straight onto the campaign would shrink the window every single run — and the
 * dashboard's date pickers read those dates. The existing row is read first and
 * the union is written back.
 */
export async function writeMetaPayload(
  supabase: SupabaseClient,
  payload: MetaPayload,
): Promise<{ campaigns: number; adGroups: number; ads: number; links: number; insights: number }> {
  const windowById = new Map(payload.campaignWindows.map((w) => [w.id, w]));
  const campaignIds = payload.campaigns.map((c) => c.id);

  let existing: { id: string; start_date: string | null; end_date: string | null }[] = [];
  if (campaignIds.length > 0) {
    const { data, error } = await supabase
      .from("campaigns")
      .select("id, start_date, end_date")
      .in("id", campaignIds);
    if (error) throw error;
    existing = data ?? [];
  }
  const existingById = new Map(existing.map((row) => [row.id, row]));

  const campaignRows = payload.campaigns.map((campaign) => {
    const fetched = windowById.get(campaign.id);
    const prior = existingById.get(campaign.id);
    const starts = [fetched?.start_date, prior?.start_date].filter(Boolean) as string[];
    const ends = [fetched?.end_date, prior?.end_date].filter(Boolean) as string[];
    return {
      ...campaign,
      start_date: starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : null,
      end_date: ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : null,
    };
  });

  const counts = { campaigns: 0, adGroups: 0, ads: 0, links: 0, insights: 0 };
  counts.campaigns = await upsertChunked(supabase, "campaigns", campaignRows, "id");
  counts.adGroups = await upsertChunked(supabase, "ad_groups", payload.adGroups, "id");
  counts.ads = await upsertChunked(supabase, "ads", payload.ads, "id");
  counts.links = await upsertChunked(
    supabase,
    "campaign_ads",
    payload.campaignAds,
    "campaign_id,ad_id",
  );
  // The idempotency key from 20260723120000. It is a plain unique index, not a
  // partial one, so PostgREST's `?on_conflict=` can infer it — the 42P10 that
  // silently emptied the DLQ came from a PARTIAL index and does not apply here.
  counts.insights = await upsertChunked(
    supabase,
    "ad_insights",
    payload.insights,
    "ad_account_id,ads_id,date",
  );

  return counts;
}

export async function resolvePlatformId(supabase: SupabaseClient, platformSlug: string) {
  const { data, error } = await supabase
    .from("platforms")
    .select("id")
    .eq("slug", platformSlug)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.id ?? null;
}
