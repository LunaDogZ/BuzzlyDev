/**
 * meta-sync — read a workspace's real Meta spend and write it into our tables.
 *
 *   POST /meta-sync   { workspaceId, adAccountId, since?, until? }   (user JWT)
 *
 * Ported from `POST /api/meta/sync` in mock-api, with one substantive change:
 * the mock server held a single token in its own environment and every caller
 * got that merchant's data. Here the token is looked up per workspace from
 * `platform_oauth_tokens`, which is what the OAuth flow in `meta-oauth` fills
 * in. There is deliberately no env-token fallback — one would silently serve
 * the developer's ad account to whoever called first.
 *
 * Deploy with JWT verification on (the default):
 *   supabase functions deploy meta-sync
 *
 * Three separate questions are asked before any Graph call, because passing the
 * first two does not answer the third:
 *   1. is the caller a real, signed-in user?        (getUser)
 *   2. do they belong to this workspace?            (is_team_member, via RLS)
 *   3. does this ad_account belong to that workspace? (service-role lookup)
 * Service role bypasses RLS on the write path, so (3) is the only thing keeping
 * a mistyped account id from writing one merchant's spend into another's
 * dashboard. It was in the original for the same reason.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { META_PLATFORM_SLUG, metaAppConfig, redactor } from "../_shared/meta.ts";
import {
  fetchAccount,
  fetchAdInsights,
  fetchAds,
  fetchCampaigns,
  MetaApiError,
  type MetaConfig,
  rollingWindow,
} from "../_shared/metaClient.ts";
import {
  assertSupportedCurrency,
  buildMetaPayload,
  derivedId,
  MetaSyncRefused,
} from "../_shared/metaMapping.ts";
import { resolvePlatformId, writeMetaPayload } from "../_shared/metaWrite.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** The service-role client, as one factory so its inferred type has a name to
 *  travel under. Naming `SupabaseClient` by hand instead widens the schema
 *  generics to `never` and every `.from(...)` stops type-checking — which is
 *  what the `as never` casts in `_shared/metaWrite.ts` are working around. */
const serviceClient = () =>
  createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

type ServiceClient = ReturnType<typeof serviceClient>;

/**
 * What a failed sync needs in order to be recorded against the right workspace.
 *
 * Held outside the `try` because the catch block is where a failure is known and
 * everything identifying it is declared inside. Null until the request has
 * proved *which* connection it is talking about — a 400 for a malformed body or
 * a 403 from someone else's workspace is not a failure of anybody's Meta
 * connection and must not mark one broken.
 */
interface SyncTarget {
  db: ServiceClient;
  workspaceId: string;
  adAccountId: string;
  platformId: string;
}

/**
 * Record that a sync attempt failed, in the two places the UI reads.
 *
 * Until this existed a failed sync wrote nothing at all: `workspace_api_keys`
 * kept `sync_status: "success"` and the `last_synced_at` of the previous run,
 * so the integrations page went on showing a healthy connection and a recent
 * sync time that no longer described anything that had happened. That is the
 * same shape as the fabricated connection states removed in 2cc696a/1c063ba —
 * a screen making a claim no code verified.
 *
 * Best-effort on purpose. The caller is already returning an error to the
 * browser with the real reason in it; if writing the post-mortem also fails,
 * the merchant must still get that reason rather than a second, less useful
 * one about our own bookkeeping.
 */
async function recordSyncFailure(
  target: SyncTarget,
  message: string,
  startedAt: string,
): Promise<void> {
  try {
    // `error_message` is what `fetchPlatforms` checks first, so setting it is
    // what actually turns the card red; `sync_status` is for anyone reading the
    // row directly. A later successful sync clears both (see step 6).
    await target.db.from("workspace_api_keys")
      .update({
        sync_status: "failed",
        error_message: message.slice(0, 1000),
        updated_at: new Date().toISOString(),
      })
      .eq("team_id", target.workspaceId)
      .eq("platform_id", target.platformId);

    // One history row per attempt — `startedAt` is minted per request, so a
    // retry is a new entry rather than an overwrite of the failure before it.
    // `last_synced_at` is deliberately NOT touched: it means "when data last
    // arrived", and no data arrived.
    await target.db.from("sync_history").upsert(
      {
        id: derivedId("sync-failure", target.workspaceId, target.adAccountId, startedAt),
        team_id: target.workspaceId,
        platform_id: target.platformId,
        sync_type: "manual",
        status: "failed",
        rows_synced: 0,
        error_message: message.slice(0, 1000),
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  } catch (err) {
    console.error("[meta-sync] could not record the failure:", String(err));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const startedAt = new Date().toISOString();
  // Until a config is loaded there is no token to hide, but an exception can
  // still be thrown before then — so start with a redactor that at least knows
  // the app secret.
  let redact = redactor([Deno.env.get("META_APP_SECRET")]);
  // Set once the request has proved which connection it is for. See SyncTarget.
  let target: SyncTarget | null = null;

  try {
    const { workspaceId, adAccountId, since, until } = await req.json().catch(() => ({}));
    if (!workspaceId || !adAccountId) {
      return json({ error: "workspaceId and adAccountId are required" }, 400);
    }
    for (const [name, value] of [["since", since], ["until", until]] as const) {
      if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return json({ error: `${name} must be YYYY-MM-DD, got "${value}"` }, 400);
      }
    }
    if ((since && !until) || (!since && until)) {
      return json({ error: "since and until must be given together" }, 400);
    }

    // 1 + 2. Who is asking, and is this their workspace?
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
    const asUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
    );
    const { data: { user }, error: userError } = await asUser.auth.getUser();
    if (userError || !user) return json({ error: "Invalid or expired session" }, 401);

    const { data: isMember, error: memberError } = await asUser.rpc("is_team_member", {
      _user_id: user.id,
      _team_id: workspaceId,
    });
    if (memberError) return json({ error: memberError.message }, 500);
    if (!isMember) return json({ error: "You are not a member of this workspace" }, 403);

    const db = serviceClient();

    // 3. Does the account belong to the workspace the caller just proved?
    const { data: account, error: accountError } = await db
      .from("ad_accounts")
      .select("id, team_id, platform_id, platform_account_id")
      .eq("id", adAccountId)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account) return json({ error: `ad_account ${adAccountId} not found` }, 404);
    if (account.team_id !== workspaceId) {
      return json({ error: "ad_account does not belong to this workspace" }, 403);
    }

    // 3b. Is it a *Meta* ad account? This function never asked before, because
    // nothing downstream needed the answer — a Shopee account would simply find
    // no token and get a 409. That stopped being harmless once a failure
    // started being written down: recording it against `account.platform_id`
    // would stamp "การเชื่อมต่อ Meta หมดอายุ" onto whatever platform the caller
    // actually named, turning another integration red for a reason that has
    // nothing to do with it. `adAccountId` is caller-supplied and every member
    // of the workspace can pass any of its accounts, so the guard belongs here
    // rather than in the one caller that currently gets it right.
    const metaPlatformId = await resolvePlatformId(db, META_PLATFORM_SLUG);
    if (!metaPlatformId) {
      return json({ error: "ระบบยังไม่ได้ตั้งค่าแพลตฟอร์ม Facebook", reason: "PLATFORM_MISSING" }, 500);
    }
    if (account.platform_id !== metaPlatformId) {
      return json(
        { error: `ad_account ${adAccountId} ไม่ใช่บัญชีโฆษณาของ Meta`, reason: "NOT_A_META_ACCOUNT" },
        400,
      );
    }

    // From here on the request has named a real Meta connection in a workspace
    // the caller belongs to, so anything that goes wrong is that connection's
    // failure and is worth recording against it. Everything above this line is
    // a bad request, not a broken sync.
    target = { db, workspaceId, adAccountId, platformId: metaPlatformId };

    // The workspace's own token. No fallback: a workspace that never completed
    // OAuth has nothing to sync, and saying so is the honest answer.
    const { data: stored, error: tokenError } = await db
      .from("platform_oauth_tokens")
      .select("access_token, expires_at, external_account_id")
      .eq("team_id", workspaceId)
      .eq("platform_id", account.platform_id)
      .maybeSingle();
    if (tokenError) throw tokenError;
    // The next three are returns rather than throws — they are answers, not
    // exceptions — but each one still means this connection cannot sync, so the
    // page that shows it must stop claiming otherwise. Recorded explicitly
    // because a `return` never reaches the catch block.
    if (!stored) {
      const message = "ยังไม่ได้เชื่อมต่อ Meta สำหรับ workspace นี้";
      if (target) await recordSyncFailure(target, message, startedAt);
      return json({ error: message, reason: "NOT_CONNECTED" }, 409);
    }
    if (stored.expires_at && new Date(stored.expires_at) <= new Date()) {
      const message = "การเชื่อมต่อ Meta หมดอายุแล้ว — กรุณาเชื่อมต่อใหม่";
      if (target) await recordSyncFailure(target, message, startedAt);
      return json({ error: message, reason: "TOKEN_EXPIRED" }, 409);
    }

    const app = metaAppConfig();
    redact = redactor([app.appSecret, stored.access_token]);

    const metaAccountId = account.platform_account_id ?? stored.external_account_id;
    if (!metaAccountId || !/^act_\d+$/.test(metaAccountId)) {
      const message = `ad account id ต้องอยู่ในรูป act_<ตัวเลข> แต่ได้ "${metaAccountId}"`;
      if (target) await recordSyncFailure(target, message, startedAt);
      return json({ error: message, reason: "BAD_ACCOUNT_ID" }, 400);
    }
    const config: MetaConfig = {
      token: stored.access_token,
      version: app.version,
      adAccountId: metaAccountId,
    };

    // 4. Identify the account and refuse anything we cannot store honestly.
    const metaAccount = await fetchAccount(config, redact);
    assertSupportedCurrency(metaAccount);
    const timezone = metaAccount.timezone_name || "Asia/Bangkok";
    const window = since && until ? { since, until } : rollingWindow(timezone);

    // 5. Read. Insights carry their own campaign/adset/ad names, so the other
    //    two calls only enrich — an ad archived mid-window is missing from /ads
    //    but its spend is still real and still gets a row.
    const [campaigns, ads, insights] = await Promise.all([
      fetchCampaigns(config, redact),
      fetchAds(config, redact),
      fetchAdInsights(config, redact, window),
    ]);

    const payload = buildMetaPayload(
      insights,
      { teamId: workspaceId, adAccountId, platform: META_PLATFORM_SLUG },
      {
        adStatus: new Map(ads.map((ad) => [ad.id, ad.effective_status ?? ""])),
        campaignMeta: new Map(
          campaigns.map((c) => [c.id, { status: c.status, objective: c.objective }]),
        ),
      },
    );

    // 6. Write in foreign-key order. Every row is keyed on a derived id, so
    //    re-running the same window updates instead of duplicating — which is
    //    what makes re-reading the full attribution window on every sync safe.
    const written = await writeMetaPayload(db, payload);

    // `metaPlatformId` rather than a second `resolvePlatformId` call: step 3b
    // already resolved it and refused the request if this account belonged to
    // another platform, so the `if (platformId)` that used to guard this block
    // can no longer be false — and a success silently skipping its own history
    // entry was never a good failure mode anyway.
    await db.from("sync_history").upsert(
      {
        id: derivedId("sync", workspaceId, adAccountId, window.since, window.until),
        team_id: workspaceId,
        platform_id: metaPlatformId,
        sync_type: "manual",
        status: "success",
        rows_synced: written.insights,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    await db.from("workspace_api_keys")
      .update({ sync_status: "success", last_synced_at: new Date().toISOString(), error_message: null })
      .eq("team_id", workspaceId)
      .eq("platform_id", metaPlatformId);

    return json({
      message: "Meta data synced",
      source: "meta_live",
      account: {
        // Not a secret — it is on the front of Ads Manager — and showing it is
        // how the merchant confirms which account they just read.
        id: metaAccount.id ?? metaAccountId,
        name: metaAccount.name ?? null,
        currency: metaAccount.currency ?? null,
        timezone,
      },
      window,
      fetchedRows: insights.length,
      // `days` counts the dates Meta returned and `activeDays` the dates that
      // cost money. Neither equals the window's length: Meta omits most quiet
      // days and returns a few as explicit zeros. Never fill the omitted ones in.
      ...payload.totals,
      written,
      skipped: payload.skipped,
    });
  } catch (err) {
    const status = err instanceof MetaSyncRefused
      ? 400
      : err instanceof MetaApiError
      ? err.status
      : 500;
    const message = redact(err instanceof Error ? err.message : String(err));
    const reason = err instanceof MetaSyncRefused ? err.reason : undefined;
    console.error("[meta-sync] failed:", message);
    // `message` has been through `redact`, which is why the recording happens
    // here rather than at each throw site: the app secret and the access token
    // both pass through this function, and the failure row is read by the
    // browser.
    if (target) await recordSyncFailure(target, message, startedAt);
    return json({ error: message, reason }, status);
  }
});
