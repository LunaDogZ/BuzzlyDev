import { MOCK_API_BASE_URL } from '@/lib/mockApiKeys';

export interface ValidateKeyPayload {
  valid: boolean;
  tenant?: string;
  shopLabel?: string;
  error?: string;
  /** True when the key selects a REAL platform connector rather than a fixture
   *  tenant. The two are ingested by different endpoints — `/api/meta/sync`
   *  writes `data_source = 'meta_live'` and deletes nothing, `/api/connect`
   *  delete-and-replaces fixtures — so the caller must branch on this and never
   *  guess from the platform slug, which is `facebook` for both. */
  live?: boolean;
  platform?: string;
  /** Meta's own account id (e.g. `act_123…`), echoed so the merchant can
   *  confirm which account is about to be read. Not a secret; the token that
   *  reads it never leaves the server. */
  adAccountId?: string;
}

/**
 * POST /validate-key on the mock-api server. Surfaces network / HTML error pages / 404 as clear failures.
 */
export async function postValidateMockApiKey(
  apiKey: string,
  platformSlug?: string
): Promise<
  | { ok: true; validation: ValidateKeyPayload }
  | { ok: false; userMessage: string; detail?: string }
> {
  const url = `${MOCK_API_BASE_URL}/validate-key`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, platformSlug }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      userMessage:
        'ไม่สามารถติดต่อ mock-api ได้ — ตรวจสอบ VITE_BACKEND_API_URL บน Vercel และว่า mock-api deploy ถูกต้อง',
      detail: msg,
    };
  }

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      userMessage:
        'mock-api ตอบกลับไม่ใช่ JSON (มักเป็น 404 จาก Vercel) — ตรวจสอบว่าโปรเจกต์ mock-api มี api/index.ts + vercel.json แล้ว redeploy',
      detail: `HTTP ${res.status} ${text.slice(0, 240)}`,
    };
  }

  if (!res.ok) {
    const err = (parsed as { error?: string })?.error ?? text.slice(0, 200);
    return {
      ok: false,
      userMessage: `mock-api ตอบ error (${res.status})`,
      detail: err,
    };
  }

  return { ok: true, validation: parsed as ValidateKeyPayload };
}
