/**
 * mockApiKeys.ts
 *
 * Client-side mirror of the mock API server's key dictionary.
 * Used by the UI to show developer hints about which keys are valid.
 *
 * Local dev: run mock-api (`cd mock-api && npm start`, port 3001).
 * Production: VITE_BACKEND_API_URL must be set on the frontend — no trailing slash.
 * If it is unset the connect/sync path fails closed; it never falls back to a host.
 */

function normalizeBackendBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

const rawBackend =
  typeof import.meta.env.VITE_BACKEND_API_URL === 'string'
    ? import.meta.env.VITE_BACKEND_API_URL.trim()
    : '';

/**
 * The backend base URL, or `null` when none is configured.
 *
 * **There is deliberately no fallback host.** This used to default to
 * `https://mock-api-sable.vercel.app/` — a stale auto-named deployment that
 * this project neither owns nor lists in its own CSP `connect-src`. That
 * default was wrong in both directions: in production the browser would refuse
 * the request anyway, and had the CSP allowed it, API keys would have been
 * posted to a host nobody here controls. Recorded as finding **A05-1** in
 * `evidence/kpi7-security/da02849…/matrix.md`.
 *
 * Unconfigured therefore means *unavailable*, not *guess a host*. Callers must
 * go through {@link backendUrl}, which fails closed.
 */
export const MOCK_API_BASE_URL: string | null =
  rawBackend.length > 0 ? normalizeBackendBaseUrl(rawBackend) : null;

/** True when `VITE_BACKEND_API_URL` is set, i.e. connect/sync can be attempted. */
export const isBackendConfigured = MOCK_API_BASE_URL !== null;

/** Thrown instead of contacting a host that was never configured. */
export class BackendNotConfiguredError extends Error {
  constructor() {
    super(
      'ยังไม่ได้ตั้งค่า VITE_BACKEND_API_URL — ระบบจะไม่เดาปลายทางเอง ' +
        'กรุณาตั้งค่าบน Vercel (หรือใน .env สำหรับเครื่องพัฒนา) ก่อนใช้งานการเชื่อมต่อ',
    );
    this.name = 'BackendNotConfiguredError';
  }
}

/**
 * Build a backend URL, or throw. Every call into the connect/sync backend goes
 * through here so that a missing configuration can never silently become a
 * request to somewhere else.
 */
export function backendUrl(path: string): string {
  if (MOCK_API_BASE_URL === null) throw new BackendNotConfiguredError();
  return `${MOCK_API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export interface MockKeyInfo {
  tenant: "shop-a" | "shop-b";
  platform: string;
  shopLabel: string;
}

/** Full key → info mapping (mirrors mock-api/server.ts) */
export const MOCK_API_KEYS: Record<string, MockKeyInfo> = {
  FB_TEST_KEY_SHOP_A:  { tenant: "shop-a", platform: "facebook",  shopLabel: "Shop A – High Volume" },
  FB_TEST_KEY_SHOP_B:  { tenant: "shop-b", platform: "facebook",  shopLabel: "Shop B – Niche/High-Conv" },
  IG_TEST_KEY_SHOP_A:  { tenant: "shop-a", platform: "instagram", shopLabel: "Shop A – High Volume" },
  IG_TEST_KEY_SHOP_B:  { tenant: "shop-b", platform: "instagram", shopLabel: "Shop B – Niche/High-Conv" },
  TT_TEST_KEY_SHOP_A:  { tenant: "shop-a", platform: "tiktok",    shopLabel: "Shop A – High Volume" },
  TT_TEST_KEY_SHOP_B:  { tenant: "shop-b", platform: "tiktok",    shopLabel: "Shop B – Niche/High-Conv" },
  SHP_TEST_KEY_SHOP_A: { tenant: "shop-a", platform: "shopee",    shopLabel: "Shop A – High Volume" },
  SHP_TEST_KEY_SHOP_B: { tenant: "shop-b", platform: "shopee",    shopLabel: "Shop B – Niche/High-Conv" },
  GG_TEST_KEY_SHOP_A:  { tenant: "shop-a", platform: "google",    shopLabel: "Shop A – High Volume" },
  GG_TEST_KEY_SHOP_B:  { tenant: "shop-b", platform: "google",    shopLabel: "Shop B – Niche/High-Conv" },
};

/**
 * The one key that is NOT a fixture. It selects the real Meta Marketing API
 * connector, which reads the ad account configured server-side and writes rows
 * labelled `meta_live`. Kept out of MOCK_API_KEYS above so nothing that
 * enumerates the fixtures can pick it up by accident — the server keeps the
 * same separation, and refuses this key at the fixture endpoint.
 */
export const LIVE_API_KEY = "META_LIVE";

/** Valid keys grouped by platform slug — used for the per-card dev hint */
export const KEYS_BY_PLATFORM: Record<string, { key: string; shopLabel: string; live?: boolean }[]> = {
  facebook:  [
    { key: LIVE_API_KEY,          shopLabel: "Meta Ads — บัญชีจริง (live)", live: true },
    { key: "FB_TEST_KEY_SHOP_A",  shopLabel: "Shop A – High Volume" },
    { key: "FB_TEST_KEY_SHOP_B",  shopLabel: "Shop B – Niche" },
  ],
  instagram: [
    { key: "IG_TEST_KEY_SHOP_A",  shopLabel: "Shop A – High Volume" },
    { key: "IG_TEST_KEY_SHOP_B",  shopLabel: "Shop B – Niche" },
  ],
  tiktok: [
    { key: "TT_TEST_KEY_SHOP_A",  shopLabel: "Shop A – High Volume" },
    { key: "TT_TEST_KEY_SHOP_B",  shopLabel: "Shop B – Niche" },
  ],
  shopee: [
    { key: "SHP_TEST_KEY_SHOP_A", shopLabel: "Shop A – High Volume" },
    { key: "SHP_TEST_KEY_SHOP_B", shopLabel: "Shop B – Niche" },
  ],
  google: [
    { key: "GG_TEST_KEY_SHOP_A",  shopLabel: "Shop A – High Volume" },
    { key: "GG_TEST_KEY_SHOP_B",  shopLabel: "Shop B – Niche" },
  ],
};
