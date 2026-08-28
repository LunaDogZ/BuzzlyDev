/**
 * Client half of the Meta OAuth flow. Everything secret stays on the server:
 * this module only asks for an authorize URL, sends the browser to it, and
 * afterwards asks the sync function to fetch. No token ever reaches this file —
 * that is the whole point of `meta-oauth` and `platform_oauth_tokens`.
 */
import { supabase } from "@/integrations/supabase/client";

export const META_CONNECT_PARAM = "connect";

export interface MetaOAuthReturn {
  status: "connected" | "cancelled" | "error";
  account?: string;
  reason?: string;
}

/** Why the connection failed, in words a merchant can act on. The reason codes
 *  come from `meta-oauth`; anything unrecognised falls through to a generic
 *  message rather than showing the raw code. */
const RETURN_MESSAGES: Record<string, string> = {
  state_expired: "ลิงก์เชื่อมต่อหมดอายุ (เกิน 10 นาที) — กรุณากดเชื่อมต่อใหม่",
  state_replayed: "ลิงก์เชื่อมต่อนี้ถูกใช้ไปแล้ว — กรุณากดเชื่อมต่อใหม่",
  unknown_state: "ไม่พบคำขอเชื่อมต่อนี้ — กรุณากดเชื่อมต่อใหม่",
  missing_code: "Meta ไม่ได้ส่งรหัสยืนยันกลับมา — กรุณาลองใหม่",
  no_ad_accounts: "บัญชี Meta นี้ไม่มีบัญชีโฆษณาที่ใช้งานได้",
  platform_missing: "ระบบยังไม่ได้ตั้งค่าแพลตฟอร์ม Facebook",
  graph_error: "Meta ปฏิเสธคำขอ — กรุณาลองใหม่อีกครั้ง",
};

export function describeReturn(ret: MetaOAuthReturn): string {
  if (ret.status === "connected") return `เชื่อมต่อ Meta สำเร็จ${ret.account ? ` · ${ret.account}` : ""}`;
  if (ret.status === "cancelled") return "ยกเลิกการเชื่อมต่อ Meta";
  return (ret.reason && RETURN_MESSAGES[ret.reason]) || "เชื่อมต่อ Meta ไม่สำเร็จ — กรุณาลองใหม่";
}

/**
 * Read the params `meta-oauth` redirected back with, if this page load is a
 * return leg. Returns null on an ordinary visit.
 */
export function readOAuthReturn(search: string): MetaOAuthReturn | null {
  const params = new URLSearchParams(search);
  if (params.get(META_CONNECT_PARAM) !== "facebook") return null;
  const status = params.get("status");
  if (status !== "connected" && status !== "cancelled" && status !== "error") return null;
  return {
    status,
    account: params.get("account") ?? undefined,
    reason: params.get("reason") ?? undefined,
  };
}

/**
 * Ask the server for an authorize URL and hand the browser over to Meta.
 *
 * `redirectTo` is where the merchant lands afterwards. The server refuses any
 * value outside its own origin, so this is not the security boundary — it is
 * just the convenience of returning to the page they started from.
 */
export async function startMetaOAuth(teamId: string, redirectTo: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{ authorizeUrl: string }>(
    "meta-oauth/start",
    { body: { teamId, redirectTo } },
  );
  if (error) throw new Error(error.message);
  if (!data?.authorizeUrl) throw new Error("เซิร์ฟเวอร์ไม่ได้ส่ง URL สำหรับเชื่อมต่อกลับมา");

  // A full navigation, not a popup: a popup would be blocked whenever this is
  // reached from anything but a direct click, and the flow has to survive the
  // merchant finishing consent on their phone.
  window.location.assign(data.authorizeUrl);
}

/**
 * End the connection. The browser cannot delete the token itself —
 * `platform_oauth_tokens` has no policies, so a client delete matches nothing
 * and reports success — so this has to go through the server, which also tells
 * Meta to drop the grant.
 */
export async function disconnectMetaOAuth(teamId: string): Promise<{ revoked: boolean }> {
  const { data, error } = await supabase.functions.invoke<{ revoked: boolean; error?: string }>(
    "meta-oauth/disconnect",
    { body: { teamId } },
  );
  if (error) throw new Error((data as { error?: string } | null)?.error ?? error.message);
  return { revoked: Boolean(data?.revoked) };
}

export interface MetaSyncResult {
  spend: string;
  impressions: number;
  days: number;
  activeDays: number;
  window: { since: string; until: string };
  written: { insights: number };
  account: { id: string; name: string | null; currency: string | null };
}

/** Pull the workspace's real Meta spend. The token lives on the server; this
 *  only names the workspace and the ad account to write into. */
export async function syncMetaLive(
  teamId: string,
  adAccountId: string,
  range?: { since: string; until: string },
): Promise<MetaSyncResult> {
  const { data, error } = await supabase.functions.invoke<MetaSyncResult & { error?: string }>(
    "meta-sync",
    { body: { workspaceId: teamId, adAccountId, ...(range ?? {}) } },
  );
  // A non-2xx from an edge function arrives as `error` with the body attached;
  // the body's own message is the useful one, so prefer it.
  if (error) throw new Error((data as { error?: string } | null)?.error ?? error.message);
  if (!data) throw new Error("meta-sync ไม่ได้ส่งผลลัพธ์กลับมา");
  return data;
}
