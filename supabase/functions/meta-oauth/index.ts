/**
 * meta-oauth — the authorization-code half of connecting a Meta ad account.
 *
 *   browser -> POST /meta-oauth/start      (user JWT)  -> { authorizeUrl }
 *   browser -> facebook.com/dialog/oauth   (user consents)
 *   browser -> GET  /meta-oauth/callback   (no JWT)    -> 302 back into the app
 *   browser -> POST /meta-oauth/disconnect (user JWT)  -> revoke + delete token
 *
 * Deployed with JWT verification OFF, and read that as a deliberate choice
 * rather than a shortcut. It is declared in `supabase/config.toml`:
 *
 *   [functions.meta-oauth]
 *   verify_jwt = false
 *
 * Not as a `--no-verify-jwt` flag on the command line, which is what this note
 * used to say — a flag has to be remembered, and a plain
 * `supabase functions deploy` silently shipped this function with verification
 * on, which kills the callback below before a line of it runs.
 *
 * The callback is a plain browser navigation issued by Meta; it carries no
 * Supabase session, so the platform's own JWT gate would reject it before this
 * code ran. `/start` therefore verifies the caller itself — and has to anyway,
 * because a valid JWT only proves *who* is asking, not that they may connect a
 * platform for *this* workspace. Both checks live in `authoriseStart`.
 *
 * What ties the two halves together is the `state` row. The callback cannot ask
 * "who is this?" — the browser is anonymous by then — so the workspace, the
 * initiating user and the return URL are all pinned at /start and looked up by
 * state. It is consumed on first use: replaying a captured `code`, or luring a
 * merchant's browser onto the callback to graft a different Meta account onto
 * their workspace, both fail on the second lookup.
 *
 * Function secrets:
 *   META_APP_ID, META_APP_SECRET     the app; the secret never leaves the server
 *   META_API_VERSION                 optional, defaults to v25.0
 *   META_OAUTH_REDIRECT_URI          must match byte-for-byte between the
 *                                    authorize call and the token exchange, and
 *                                    must be listed in the Meta app's
 *                                    "Valid OAuth Redirect URIs"
 *   APP_BASE_URL                     where the callback sends the browser back
 *
 * The token this obtains is written to `platform_oauth_tokens`, a table with RLS
 * on and no policies, so it is reachable only by service_role. It is never
 * written to `workspace_api_keys`, whose `access_token` column any workspace
 * member can read.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  graph,
  META_PLATFORM_SLUG,
  MetaApiError,
  metaAppConfig,
  redactor,
} from "../_shared/meta.ts";

/** Only what the sync actually needs. Asking for more would have to be justified
 *  to App Review later, and an unused scope is a permission we cannot defend. */
const SCOPES = "ads_read";
const STATE_TTL_MINUTES = 10;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const serviceClient = () =>
  createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

/**
 * Turn a PostgREST error into something the catch block can actually print.
 *
 * `PostgrestError` is a plain object, not an `Error`, so `throw error` lands in
 * a handler that does `err instanceof Error ? err.message : String(err)` and
 * logs the literal string "[object Object]". Every write below is a step the
 * merchant's connection depends on; a log line that cannot name which one
 * failed, or why, is the difference between a five-minute fix and an afternoon.
 */
function writeFailed(step: string, error: { message?: string; code?: string }): Error {
  return new Error(`${step} failed${error.code ? ` (${error.code})` : ""}: ${error.message ?? "unknown"}`);
}

/**
 * Verify the caller and their right to connect a platform for this workspace.
 * Two separate questions, and the second is the one that matters: any logged-in
 * customer holds a valid JWT.
 */
async function authoriseStart(req: Request, teamId: string) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { error: "Missing Authorization header", status: 401 };

  const asUser = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );

  const { data: { user }, error } = await asUser.auth.getUser();
  if (error || !user) return { error: "Invalid or expired session", status: 401 };

  // Asked through the user's own client, so RLS answers it: `can_manage_team`
  // is the same predicate the settings pages already gate on.
  const { data: allowed, error: rpcError } = await asUser.rpc("can_manage_team", {
    _user_id: user.id,
    _team_id: teamId,
  });
  if (rpcError) return { error: rpcError.message, status: 500 };
  if (!allowed) {
    return { error: "You do not have permission to connect a platform for this workspace", status: 403 };
  }
  return { user };
}

// ── POST /meta-oauth/start ──────────────────────────────────────────────────
async function handleStart(req: Request): Promise<Response> {
  const { teamId, redirectTo } = await req.json().catch(() => ({}));
  if (!teamId) return json({ error: "teamId is required" }, 400);

  const auth = await authoriseStart(req, teamId);
  if ("error" in auth) return json({ error: auth.error }, auth.status);

  const app = metaAppConfig();
  const redirectUri = Deno.env.get("META_OAUTH_REDIRECT_URI");
  if (!redirectUri) return json({ error: "META_OAUTH_REDIRECT_URI is not set on the server" }, 500);

  // `redirectTo` decides where a browser is sent after Meta hands back a code, so
  // an unchecked value here is an open redirect wearing our domain. Anything not
  // on APP_BASE_URL's own origin is refused at creation rather than sanitised at
  // use: the value is stored, and a check that runs before storage cannot be
  // skipped by whatever reads it later.
  const appBase = Deno.env.get("APP_BASE_URL");
  let safeRedirect: string | null = null;
  if (redirectTo) {
    if (!appBase) return json({ error: "APP_BASE_URL is not set on the server" }, 500);
    let candidate: URL;
    try {
      candidate = new URL(redirectTo, appBase);
    } catch {
      return json({ error: "redirectTo is not a valid URL" }, 400);
    }
    if (candidate.origin !== new URL(appBase).origin) {
      return json({ error: "redirectTo must stay on this application's origin" }, 400);
    }
    safeRedirect = candidate.toString();
  }

  const state = crypto.randomUUID() + "." + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + STATE_TTL_MINUTES * 60_000).toISOString();

  const { error } = await serviceClient().from("platform_oauth_states").insert({
    state,
    team_id: teamId,
    user_id: auth.user.id,
    platform_slug: META_PLATFORM_SLUG,
    redirect_to: safeRedirect,
    expires_at: expiresAt,
  });
  if (error) return json({ error: error.message }, 500);

  const authorizeUrl = new URL(`https://www.facebook.com/${app.version}/dialog/oauth`);
  authorizeUrl.searchParams.set("client_id", app.appId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("scope", SCOPES);
  authorizeUrl.searchParams.set("response_type", "code");

  return json({ authorizeUrl: authorizeUrl.toString(), expiresAt });
}

// ── GET /meta-oauth/callback ────────────────────────────────────────────────
/** The browser is mid-navigation, so every outcome is a redirect. Failing to a
 *  JSON blob would strand the merchant on a blank page with an OAuth exchange in
 *  the URL bar. */
function bounce(back: string | null, params: Record<string, string>): Response {
  const target = back ?? Deno.env.get("APP_BASE_URL");
  if (!target) {
    // Misconfigured server: say so rather than emit a Location header pointing
    // at a relative path the browser will resolve against graph.facebook.com.
    return json({ ...params, error: "APP_BASE_URL is not set on the server" }, 500);
  }
  const url = new URL(target);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: url.toString() } });
}

async function handleCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");

  const db = serviceClient();

  // Claim the state first, whatever else happened. Even on a user-cancelled
  // consent we want the row spent rather than left waiting.
  let stateRow: {
    team_id: string; user_id: string; redirect_to: string | null; expires_at: string; consumed_at: string | null;
  } | null = null;
  if (state) {
    const { data } = await db
      .from("platform_oauth_states")
      .select("team_id, user_id, redirect_to, expires_at, consumed_at")
      .eq("state", state)
      .maybeSingle();
    stateRow = data ?? null;
    if (stateRow) {
      await db.from("platform_oauth_states")
        .update({ consumed_at: new Date().toISOString() })
        .eq("state", state)
        .is("consumed_at", null);
    }
  }
  const back = stateRow?.redirect_to ?? null;

  if (denied) return bounce(back, { connect: "facebook", status: "cancelled" });
  if (!code || !state) return bounce(back, { connect: "facebook", status: "error", reason: "missing_code" });
  if (!stateRow) return bounce(null, { connect: "facebook", status: "error", reason: "unknown_state" });
  if (stateRow.consumed_at) return bounce(back, { connect: "facebook", status: "error", reason: "state_replayed" });
  if (new Date(stateRow.expires_at) < new Date()) {
    return bounce(back, { connect: "facebook", status: "error", reason: "state_expired" });
  }

  const app = metaAppConfig();
  const redact = redactor([app.appSecret]);
  const redirectUri = Deno.env.get("META_OAUTH_REDIRECT_URI") ?? "";

  try {
    // 1. code -> short-lived user token. `redirect_uri` has to be identical to
    //    the one sent to the dialog or Meta rejects the exchange.
    const short = await graph<{ access_token: string }>("oauth/access_token", {
      client_id: app.appId,
      client_secret: app.appSecret,
      redirect_uri: redirectUri,
      code,
    }, { version: app.version, redact });

    // 2. short-lived (~1h) -> long-lived (~60d). Without this the connection
    //    dies the same afternoon it was made.
    const long = await graph<{ access_token: string; token_type?: string; expires_in?: number }>(
      "oauth/access_token",
      {
        grant_type: "fb_exchange_token",
        client_id: app.appId,
        client_secret: app.appSecret,
        fb_exchange_token: short.access_token,
      },
      { version: app.version, redact },
    );
    const token = long.access_token;
    const expiresAt = long.expires_in
      ? new Date(Date.now() + long.expires_in * 1000).toISOString()
      : null;

    // 3. Who consented, and which accounts did they bring? Both in one batch —
    //    the alternative is a call per account id, which is the N+1 shape.
    const [me, accounts] = await Promise.all([
      graph<{ id: string }>("me", { fields: "id" }, { version: app.version, token, redact }),
      graph<{ data: Array<{ id: string; name?: string; currency?: string; account_status?: number }> }>(
        "me/adaccounts",
        { fields: "id,name,currency,account_status", limit: "50" },
        { version: app.version, token, redact },
      ),
    ]);

    // account_status 1 is ACTIVE. A merchant with only disabled accounts has
    // nothing we can read, and saying so beats connecting to a dead account.
    const usable = (accounts.data ?? []).filter((a) => a.account_status === 1);
    const chosen = usable[0] ?? (accounts.data ?? [])[0];
    if (!chosen) return bounce(back, { connect: "facebook", status: "error", reason: "no_ad_accounts" });

    const { data: platform } = await db
      .from("platforms").select("id").eq("slug", META_PLATFORM_SLUG).maybeSingle();
    if (!platform) return bounce(back, { connect: "facebook", status: "error", reason: "platform_missing" });

    // 4. Store the token where the browser cannot reach it.
    const { error: tokenError } = await db.from("platform_oauth_tokens").upsert({
      team_id: stateRow.team_id,
      platform_id: platform.id,
      access_token: token,
      token_type: long.token_type ?? "bearer",
      scopes: SCOPES,
      expires_at: expiresAt,
      external_account_id: chosen.id,
      external_user_id: me.id,
      connected_by: stateRow.user_id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "team_id,platform_id" });
    if (tokenError) throw writeFailed("platform_oauth_tokens upsert", tokenError);

    // 5. Give the sync something to write into. `meta-sync` takes a Buzzly
    //    ad_accounts id and refuses one that belongs to another workspace, so
    //    the row has to exist before the first sync, not after it.
    // `ad_accounts` carries UNIQUE (team_id, platform_id) — one ad account per
    // workspace per platform. Looking the row up by `platform_account_id` and
    // inserting when none matched was the wrong key: a workspace that already
    // held a Facebook row from the fixture era (platform_account_id NULL) hit the
    // constraint instead, and because the insert's error was never read the
    // callback went on to report a healthy connection with nothing for the sync
    // to write into. Upserting on the constraint's own key updates that row.
    const { error: accountError } = await db.from("ad_accounts").upsert({
      team_id: stateRow.team_id,
      platform_id: platform.id,
      account_name: chosen.name ?? chosen.id,
      platform_account_id: chosen.id,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "team_id,platform_id" });
    if (accountError) throw writeFailed("ad_accounts upsert", accountError);

    // 6. Connection status only — deliberately no token. See the migration
    //    header for why this column is not a safe place for one.
    //
    // The error is read for the same reason step 5's is: this row is what
    // `usePlatformConnections.fetchPlatforms` reads to decide whether the
    // platform shows as connected. Letting it fail unnoticed and then
    // redirecting `status=connected` is exactly the failure 822c968 fixed one
    // statement higher up — a callback reporting a healthy connection the page
    // behind it then renders as disconnected. Failing here is recoverable: the
    // token is already stored, both upserts are keyed on
    // (team_id, platform_id), so pressing connect again repairs the row rather
    // than duplicating anything.
    const { error: statusError } = await db.from("workspace_api_keys").upsert({
      team_id: stateRow.team_id,
      platform_id: platform.id,
      access_token: null,
      scopes: SCOPES,
      account_id_on_platform: chosen.id,
      token_expires_at: expiresAt,
      sync_status: "pending",
      is_active: true,
      error_message: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "team_id,platform_id" });
    if (statusError) throw writeFailed("workspace_api_keys upsert", statusError);

    return bounce(back, { connect: "facebook", status: "connected", account: chosen.id });
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : String(err));
    console.error("[meta-oauth/callback] failed:", message);
    const reason = err instanceof MetaApiError ? "graph_error" : "server_error";
    return bounce(back, { connect: "facebook", status: "error", reason });
  }
}

// ── POST /meta-oauth/disconnect ─────────────────────────────────────────────
/**
 * The browser cannot do this itself, and that is the point: `platform_oauth_tokens`
 * has no policies, so a client `delete()` matches nothing and fails silently
 * clean. Without this endpoint "ยกเลิกการเชื่อมต่อ" would clear the row the UI
 * reads and leave the credential sitting on the server — the app would still
 * hold Graph access to a merchant who believes they revoked it. That is a
 * consent problem, not a tidiness one.
 *
 * Meta is told too, not just our own table. Deleting our copy stops *us* using
 * it; `DELETE /{user}/permissions` is what actually ends the grant on their
 * side, so a merchant who checks their Facebook settings sees it gone. It is
 * best-effort: if Meta refuses, the local token is still removed, because
 * failing to delete our copy is the worse outcome of the two.
 */
async function handleDisconnect(req: Request): Promise<Response> {
  const { teamId } = await req.json().catch(() => ({}));
  if (!teamId) return json({ error: "teamId is required" }, 400);

  const auth = await authoriseStart(req, teamId);
  if ("error" in auth) return json({ error: auth.error }, auth.status);

  const db = serviceClient();
  const { data: platform } = await db
    .from("platforms").select("id").eq("slug", META_PLATFORM_SLUG).maybeSingle();
  if (!platform) return json({ error: "platform not configured" }, 500);

  const { data: stored } = await db
    .from("platform_oauth_tokens")
    .select("access_token, external_user_id")
    .eq("team_id", teamId)
    .eq("platform_id", platform.id)
    .maybeSingle();

  // Already gone is a success, not an error: the caller asked for a state, not
  // an action, and a retry after a half-finished disconnect must not fail.
  if (!stored) return json({ revoked: false, alreadyDisconnected: true });

  const app = metaAppConfig();
  const redact = redactor([app.appSecret, stored.access_token]);
  let revoked = false;
  try {
    if (stored.external_user_id) {
      const res = await fetch(
        `https://graph.facebook.com/${app.version}/${stored.external_user_id}/permissions`,
        { method: "DELETE", headers: { Authorization: `Bearer ${stored.access_token}` } },
      );
      revoked = res.ok;
    }
  } catch (err) {
    console.error("[meta-oauth/disconnect] revoke failed:", redact(err));
  }

  const { error } = await db
    .from("platform_oauth_tokens")
    .delete()
    .eq("team_id", teamId)
    .eq("platform_id", platform.id);
  if (error) return json({ error: error.message }, 500);

  return json({ revoked, alreadyDisconnected: false });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const path = new URL(req.url).pathname.replace(/\/+$/, "");

  try {
    if (path.endsWith("/start") && req.method === "POST") return await handleStart(req);
    if (path.endsWith("/callback") && req.method === "GET") return await handleCallback(req);
    if (path.endsWith("/disconnect") && req.method === "POST") return await handleDisconnect(req);
    return json({ error: "Not found. Use POST /start, GET /callback or POST /disconnect." }, 404);
  } catch (err) {
    // Nothing below this point may echo an exception verbatim: the app secret
    // and the token both pass through this function.
    const redact = redactor([Deno.env.get("META_APP_SECRET")]);
    const message = redact(err instanceof Error ? err.message : String(err));
    console.error("[meta-oauth] unhandled:", message);
    return json({ error: message }, err instanceof MetaApiError ? err.status : 500);
  }
});
