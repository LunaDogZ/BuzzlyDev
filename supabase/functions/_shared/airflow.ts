/**
 * Airflow 3.x REST client (API v2).
 *
 * Airflow 3 dropped the basic-auth-per-request model of 2.x: you exchange
 * credentials for a JWT at `POST /auth/token`, then send it as a bearer token.
 * Verified against a live Airflow 3.2.2 instance on 2026-07-23.
 *
 * Config comes from function secrets — never hard-code an Airflow URL or
 * password here:
 *
 *   AIRFLOW_BASE_URL   e.g. https://airflow.example.com  (NO trailing slash)
 *   AIRFLOW_USERNAME
 *   AIRFLOW_PASSWORD
 *
 * Note for local development: Supabase Edge Functions run in Supabase's cloud,
 * which cannot reach an Airflow on your laptop. Either expose Airflow through a
 * tunnel and point AIRFLOW_BASE_URL at it, or rely on the `buzzly_import_sensor`
 * DAG, which polls outbound and needs no inbound reachability.
 */

export interface AirflowConfig {
  baseUrl: string;
  username: string;
  password: string;
}

export interface DagRunResponse {
  dag_run_id: string;
  dag_id: string;
  state: string;
  conf: Record<string, unknown>;
}

/** Thrown for any non-2xx from Airflow, with the status attached for the caller. */
export class AirflowError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AirflowError";
  }
}

export function airflowConfigFromEnv(): AirflowConfig {
  const baseUrl = Deno.env.get("AIRFLOW_BASE_URL") ?? "";
  const username = Deno.env.get("AIRFLOW_USERNAME") ?? "";
  const password = Deno.env.get("AIRFLOW_PASSWORD") ?? "";

  const missing = [
    ["AIRFLOW_BASE_URL", baseUrl],
    ["AIRFLOW_USERNAME", username],
    ["AIRFLOW_PASSWORD", password],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Missing Airflow function secrets: ${missing.join(", ")}`);
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), username, password };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Exchange username/password for a bearer token. */
export async function getAirflowToken(
  config: AirflowConfig,
  timeoutMs = 10_000,
): Promise<string> {
  const response = await fetchWithTimeout(
    `${config.baseUrl}/auth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: config.username, password: config.password }),
    },
    timeoutMs,
  );

  if (!response.ok) {
    throw new AirflowError(
      `Airflow auth failed: ${response.status} ${await response.text()}`,
      response.status,
    );
  }

  const { access_token } = await response.json();
  if (!access_token) {
    throw new AirflowError("Airflow auth returned no access_token", 502);
  }
  return access_token;
}

/**
 * Trigger a DAG run.
 *
 * `logical_date: null` marks the run as event-driven rather than tied to a
 * schedule interval — correct for a run created by a file upload.
 *
 * Caveat worth knowing: Airflow accepts a trigger for a **paused** DAG and
 * returns 200 with state `queued`, but the run never executes. Callers that
 * care should check `is_paused` (see `isDagPaused`).
 */
export async function triggerDagRun(
  config: AirflowConfig,
  token: string,
  dagId: string,
  conf: Record<string, unknown>,
  options: { runId?: string; note?: string; timeoutMs?: number } = {},
): Promise<DagRunResponse> {
  const body: Record<string, unknown> = { conf, logical_date: null };
  if (options.runId) body.dag_run_id = options.runId;
  if (options.note) body.note = options.note;

  const response = await fetchWithTimeout(
    `${config.baseUrl}/api/v2/dags/${encodeURIComponent(dagId)}/dagRuns`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
    options.timeoutMs ?? 15_000,
  );

  if (!response.ok) {
    throw new AirflowError(
      `Triggering ${dagId} failed: ${response.status} ${await response.text()}`,
      response.status,
    );
  }
  return await response.json() as DagRunResponse;
}

/** True when the DAG exists and is paused; null when it cannot be determined. */
export async function isDagPaused(
  config: AirflowConfig,
  token: string,
  dagId: string,
  timeoutMs = 10_000,
): Promise<boolean | null> {
  try {
    const response = await fetchWithTimeout(
      `${config.baseUrl}/api/v2/dags/${encodeURIComponent(dagId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
      timeoutMs,
    );
    if (!response.ok) return null;
    const dag = await response.json();
    return Boolean(dag.is_paused);
  } catch {
    return null;
  }
}
