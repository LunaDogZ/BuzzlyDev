/**
 * airflow-trigger
 *
 * Push half of the ingestion trigger path: a DB webhook fires on every
 * `import_jobs` INSERT and this function turns it into an Airflow DAG run.
 *
 *   upload UI -> import_jobs INSERT -> [DB webhook] -> airflow-trigger
 *             -> POST /api/v2/dags/buzzly_import_pipeline/dagRuns
 *
 * It is deliberately not the only path. `buzzly_import_sensor` polls for
 * `pending` jobs every two minutes, so a job this function never sees — or
 * fails on — still gets processed. That also makes this function the *optional*
 * one in local development, where Supabase's cloud cannot reach an Airflow
 * running on the developer's machine.
 *
 * Ordering is claim-then-trigger, never the reverse: the claim is a conditional
 * UPDATE (`pending` -> `queued`) so only one caller can ever own a job, and the
 * claim is rolled back if the trigger fails, handing the job to the sensor.
 *
 * Function secrets:
 *   AIRFLOW_BASE_URL, AIRFLOW_USERNAME, AIRFLOW_PASSWORD   (see _shared/airflow.ts)
 *   BUZZLY_TRIGGER_SECRET   shared secret the DB webhook sends as
 *                           `x-buzzly-trigger-secret`; required
 *   AIRFLOW_DAG_ID          optional, defaults to buzzly_import_pipeline
 *
 * Deploy with JWT verification off — the caller is Postgres, which has no user
 * JWT; the shared secret is what authenticates it:
 *   supabase functions deploy airflow-trigger --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  airflowConfigFromEnv,
  getAirflowToken,
  isDagPaused,
  triggerDagRun,
} from "../_shared/airflow.ts";

const DEFAULT_DAG_ID = "buzzly_import_pipeline";
const CLAIMABLE_STATUS = "pending";

interface WebhookPayload {
  type?: string;
  table?: string;
  record?: { id?: string; status?: string };
  import_job_id?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Constant-time-ish comparison so the secret cannot be probed byte by byte. */
function secretsMatch(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** Accept both the Supabase webhook envelope and a bare {import_job_id}. */
function extractJobId(payload: WebhookPayload): string | null {
  const id = payload.import_job_id ?? payload.record?.id ?? null;
  return id && typeof id === "string" ? id.trim() || null : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ── Authenticate the caller ───────────────────────────────────────────────
  const expectedSecret = Deno.env.get("BUZZLY_TRIGGER_SECRET") ?? "";
  if (!expectedSecret) {
    // Fail closed. An unset secret must never mean "let everyone through".
    console.error("[airflow-trigger] BUZZLY_TRIGGER_SECRET is not configured");
    return json({ error: "Function is not configured" }, 500);
  }
  const providedSecret = req.headers.get("x-buzzly-trigger-secret") ?? "";
  if (!secretsMatch(providedSecret, expectedSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  // ── Parse ─────────────────────────────────────────────────────────────────
  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  const jobId = extractJobId(payload);
  if (!jobId) {
    return json({ error: "No import_job_id in payload" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const dagId = Deno.env.get("AIRFLOW_DAG_ID") ?? DEFAULT_DAG_ID;

  // ── Claim ─────────────────────────────────────────────────────────────────
  // The `.eq("status", pending)` is the whole concurrency story: PostgREST turns
  // this into one conditional UPDATE, so if the sensor DAG already took the job
  // we get zero rows back and stop instead of triggering a second run.
  const { data: claimed, error: claimError } = await supabase
    .from("import_jobs")
    .update({ status: "queued" })
    .eq("id", jobId)
    .eq("status", CLAIMABLE_STATUS)
    .select("id, team_id, platform, original_filename")
    .maybeSingle();

  if (claimError) {
    console.error(`[airflow-trigger] Claim failed for ${jobId}:`, claimError.message);
    return json({ error: "Could not claim job", detail: claimError.message }, 500);
  }
  if (!claimed) {
    // Already claimed, already finished, or never existed. All are no-ops, and
    // a 200 stops pg_net retrying something that will never change.
    console.log(`[airflow-trigger] Job ${jobId} was not claimable — skipping`);
    return json({ skipped: true, reason: "not_claimable", import_job_id: jobId });
  }

  // ── Trigger ───────────────────────────────────────────────────────────────
  try {
    const config = airflowConfigFromEnv();
    const token = await getAirflowToken(config);

    if (await isDagPaused(config, token, dagId) === true) {
      // Airflow would accept this and queue a run that never starts, which looks
      // exactly like "nothing happened". Refuse instead and say why.
      throw new Error(`DAG ${dagId} is paused in Airflow — unpause it to accept imports`);
    }

    const run = await triggerDagRun(
      config,
      token,
      dagId,
      { import_job_id: jobId },
      {
        runId: `webhook__${jobId}__${Date.now()}`,
        note: `Import ${claimed.original_filename} (${claimed.platform})`,
      },
    );

    const { error: stampError } = await supabase
      .from("import_jobs")
      .update({ dag_run_id: run.dag_run_id })
      .eq("id", jobId);

    if (stampError) {
      // The run is live and will stamp its own dag_run_id in resolve_job, so
      // this is worth logging and not worth failing over.
      console.error(`[airflow-trigger] Could not record dag_run_id: ${stampError.message}`);
    }

    console.log(`[airflow-trigger] Job ${jobId} -> ${dagId} run ${run.dag_run_id}`);
    return json({
      triggered: true,
      import_job_id: jobId,
      dag_id: dagId,
      dag_run_id: run.dag_run_id,
      state: run.state,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[airflow-trigger] Trigger failed for ${jobId}: ${message}`);

    // Hand the job back so the sensor DAG retries it. Only our own claim is
    // released — if the row moved on since, the guard leaves it alone.
    const { error: releaseError } = await supabase
      .from("import_jobs")
      .update({
        status: CLAIMABLE_STATUS,
        error_message: `Airflow trigger failed: ${message}`.slice(0, 1000),
      })
      .eq("id", jobId)
      .eq("status", "queued");

    if (releaseError) {
      console.error(`[airflow-trigger] Could not release ${jobId}: ${releaseError.message}`);
    }

    // 5xx so pg_net's own retry gets a chance before the sensor's 2-minute tick.
    return json({ error: "Airflow trigger failed", detail: message, released: true }, 502);
  }
});
