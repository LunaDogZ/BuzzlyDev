/**
 * Shared Meta Graph API helpers for the edge functions.
 *
 * The app secret and every access token pass through here, so the one rule this
 * module exists to enforce is that neither ever reaches a log line or a response
 * body: `redactor()` is applied to every string on its way out, and callers are
 * expected to use it rather than `String(err)`.
 */

export const META_PLATFORM_SLUG = "facebook";

export class MetaApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "MetaApiError";
  }
}

/** Config that is the same for every workspace: it identifies *our app*, not a merchant. */
export interface MetaAppConfig {
  appId: string;
  appSecret: string;
  version: string;
}

export function metaAppConfig(): MetaAppConfig {
  const appId = Deno.env.get("META_APP_ID");
  const appSecret = Deno.env.get("META_APP_SECRET");
  const missing = [
    ["META_APP_ID", appId],
    ["META_APP_SECRET", appSecret],
  ].filter(([, v]) => !v).map(([k]) => k as string);
  if (missing.length) {
    throw new MetaApiError(
      `Meta is not configured on the server — missing ${missing.join(", ")}`,
      500,
    );
  }
  return {
    appId: appId!,
    appSecret: appSecret!,
    version: Deno.env.get("META_API_VERSION") ?? "v25.0",
  };
}

/**
 * Strip the app secret and any access token out of a string before it is logged
 * or returned. The generic `access_token=` rule is deliberate belt-and-braces:
 * Meta echoes tokens back inside paging URLs, and those are tokens we never held
 * a copy of to substring-match against.
 */
export function redactor(secrets: Array<string | undefined>) {
  const present = secrets.filter((s): s is string => typeof s === "string" && s.length > 8);
  return (value: unknown): string => {
    let out = String(value);
    for (const s of present) out = out.split(s).join("<REDACTED>");
    return out.replace(/access_token=[^&\s"']+/g, "access_token=<REDACTED>");
  };
}

/**
 * One Graph call. The token goes in the Authorization header rather than the
 * query string so it cannot end up in an intermediary's access log.
 */
export async function graph<T = unknown>(
  path: string,
  params: Record<string, string>,
  opts: { version: string; token?: string; redact: (v: unknown) => string },
): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${opts.version}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
  });
  const body = await res.json().catch(() => null);

  if (!res.ok || body?.error) {
    const detail = body?.error?.message ?? `HTTP ${res.status}`;
    throw new MetaApiError(opts.redact(detail), res.status === 200 ? 502 : res.status);
  }
  return body as T;
}
