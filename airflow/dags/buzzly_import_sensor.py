"""Fallback trigger for merchant file imports — polls for jobs the webhook missed.

The primary trigger path is push: a DB webhook on ``import_jobs`` INSERT calls
the ``airflow-trigger`` Edge Function, which calls the Airflow REST API. That
path has three ways to drop a job — pg_net delivery, the Edge Function, and the
network between Supabase and Airflow — and none of them retry forever. This DAG
is the backstop, and in local development (cloud Supabase, Airflow on
localhost) it is the *only* path that works, because nothing on the internet can
reach the developer's machine.

Every two minutes it:

  1. returns orphans (claimed, never triggered) to the queue,
  2. claims every ``pending`` job older than the webhook grace period,
  3. triggers one ``buzzly_import_pipeline`` run per claimed job.

Claiming is a conditional UPDATE, so a job the webhook grabs first is simply
invisible here — the two paths can run together without double-processing.

Requires ``buzzly_import_pipeline`` to be **unpaused**: triggering a paused DAG
returns success and queues a run that never executes, which from the merchant's
side is indistinguishable from nothing happening. Jobs left that way are
recovered by the orphan reaper rather than lost, but they will not progress
until the pipeline is unpaused.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from airflow.providers.standard.operators.trigger_dagrun import TriggerDagRunOperator
from airflow.sdk import dag, task

from buzzly_common.supabase import SupabaseClient

log = logging.getLogger(__name__)

TARGET_DAG_ID = "buzzly_import_pipeline"

# How long a fresh job is left alone for the webhook to claim it.
#
# This is not a correctness mechanism — the conditional claim already makes a
# double trigger impossible — it only avoids doing work the webhook is about to
# do. So it is tuned for latency instead: at 90s a job uploaded just after a
# tick missed the *next* tick too, giving a ~4 minute worst case. 30s keeps the
# whole thing under ~2.5 minutes when the webhook is not wired up at all, which
# is the normal state in local development.
WEBHOOK_GRACE = timedelta(seconds=30)

# How long a job may sit claimed-but-untriggered before it is treated as an orphan.
STALE_CLAIM_AFTER = timedelta(minutes=10)

# Cap per sensor run, so a backlog drains in waves instead of flooding the executor.
MAX_JOBS_PER_RUN = 25


@dag(
    dag_id="buzzly_import_sensor",
    schedule="*/2 * * * *",
    catchup=False,
    max_active_runs=1,
    tags=["buzzly", "imports"],
    doc_md=__doc__,
    default_args={"retries": 1},
)
def buzzly_import_sensor():
    @task
    def release_stale_claims() -> int:
        client = SupabaseClient.from_airflow_variables()
        cutoff = (datetime.now(timezone.utc) - STALE_CLAIM_AFTER).isoformat()
        released = client.release_stale_claims(cutoff)
        if released:
            log.warning(
                "Returned %d orphaned job(s) to the queue: %s",
                len(released), [row["id"] for row in released],
            )
        return len(released)

    @task
    def find_and_claim_jobs() -> list[dict]:
        """Claim every eligible pending job; emit TriggerDagRunOperator kwargs.

        The claim — not the run id — is what stops a file being ingested twice,
        so the run id carries a timestamp: a job that legitimately comes back
        around (returned by the orphan reaper) must be able to get a fresh run
        instead of colliding with its own dead one forever.
        """
        client = SupabaseClient.from_airflow_variables()
        now = datetime.now(timezone.utc)
        stamp = now.strftime("%Y%m%dT%H%M%S")
        cutoff = (now - WEBHOOK_GRACE).isoformat()

        candidates = client.list_pending_jobs(cutoff, limit=MAX_JOBS_PER_RUN)
        if not candidates:
            log.info("No pending import jobs older than %s", cutoff)
            return []

        claimed: list[dict] = []
        for job in candidates:
            job_id = job["id"]
            if not client.claim_job(job_id):
                log.info("Job %s was already claimed elsewhere — skipping", job_id)
                continue
            claimed.append(
                {
                    "conf": {"import_job_id": job_id},
                    "trigger_run_id": f"sensor__{job_id}__{stamp}",
                }
            )
            log.info("Claimed job %s (%s)", job_id, job["original_filename"])

        log.info("Claimed %d of %d candidate job(s)", len(claimed), len(candidates))
        return claimed

    trigger_pipeline = TriggerDagRunOperator.partial(
        task_id="trigger_pipeline",
        trigger_dag_id=TARGET_DAG_ID,
        wait_for_completion=False,
        # A run for this id already exists => the job is being handled. Not an error.
        skip_when_already_exists=True,
        # NOTE: `fail_when_dag_is_paused=True` looks like the right guard here and
        # is accepted by __init__, but Airflow 3.2.2 raises
        # `NotImplementedError: ... not yet supported for Airflow 3.x` when the
        # task actually runs. The paused-pipeline case is instead handled by the
        # orphan reaper above (jobs return to `pending` and are retried) and
        # checked explicitly by the airflow-trigger Edge Function, which has REST
        # credentials to ask. Keep this DAG's pipeline unpaused.
    ).expand_kwargs(find_and_claim_jobs())

    release_stale_claims() >> trigger_pipeline


buzzly_import_sensor()
