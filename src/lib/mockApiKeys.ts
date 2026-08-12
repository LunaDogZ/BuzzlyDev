/**
 * mockApiKeys.ts
 *
 * Client-side mirror of the mock API server's key dictionary.
 * Used by the UI to show developer hints about which keys are valid.
 *
 * Local dev: run mock-api (`cd mock-api && npm start`, port 3001).
 * Production: set VITE_BACKEND_API_URL on the frontend (e.g. https://your-mock-api.vercel.app) — no trailing slash.
 */

function normalizeBackendBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

// Backend/Mock API server URL — override via VITE_BACKEND_API_URL in .env / Vercel
const rawBackend =
  typeof import.meta.env.VITE_BACKEND_API_URL === 'string' && import.meta.env.VITE_BACKEND_API_URL.length > 0
    ? import.meta.env.VITE_BACKEND_API_URL
    : 'https://mock-api-sable.vercel.app/';

export const MOCK_API_BASE_URL = normalizeBackendBaseUrl(rawBackend);

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
