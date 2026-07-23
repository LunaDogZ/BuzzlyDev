"""Buzzly merchant-file ingestion pipeline.

Triggered once per uploaded file with ``conf = {"import_job_id": "<uuid>"}``,
either by the ``airflow-trigger`` Edge Function (DB webhook on INSERT) or by
``buzzly_import_sensor`` when that webhook does not land.

Shape::

    resolve_job -> verify_artifact -> hash_dedupe -> detect_format -> parse
                -> clean_thai -> validate -> quarantine_bad_rows -> upsert_target
                -> finalize -> cleanup_staging

Build state (step 4 of the plan). Real: ``resolve_job``, ``verify_artifact``,
``hash_dedupe``, ``finalize``, ``cleanup_staging``. Placeholders that pass their
ledger through unchanged: ``detect_format`` and everything after it, which land
in steps 5-7. A run therefore still finishes ``succeeded`` with zero rows, but
it now does so *through* the real stage graph, so the status transitions, the
row-count accounting and the short-circuit path are exercised before the first
parser exists.

**One stage per task, on purpose.** Fewer, fatter tasks would run faster (no
XCom round-trip between them), but each stage boundary is a retry boundary, a
log boundary and a measurement point — Airflow records duration per task, which
is the per-stage throughput the research write-up needs, at no extra cost. What
crosses those boundaries is defined in ``buzzly_common.pipeline``; the uploaded
file itself never does, it is staged on disk and referenced by path.

Status transitions owned here (service_role — clients have no UPDATE policy)::

    pending|queued -> running -> succeeded | partial | failed

Trigger by hand while testing::

    docker compose --profile debug run --rm airflow-cli \
        airflow dags trigger buzzly_import_pipeline \
        --conf '{"import_job_id": "<uuid>"}'
"""

from __future__ import annotations

import logging
from datetime import timedelta

from airflow.sdk import dag, get_current_context, task
from airflow.sdk.exceptions import AirflowFailException, AirflowSkipException

from buzzly_common.pipeline import (
    assert_consistent,
    clear_staging,
    new_ledger,
    run_stage,
    short_circuit,
    staging_path,
    terminal_status,
    write_staged,
)
from buzzly_common.supabase import SupabaseClient, sha256_hex

log = logging.getLogger(__name__)

DAG_ID = "buzzly_import_pipeline"


def _job_id_from_context(context) -> str:
    """Pull import_job_id out of the DagRun conf, or fail loudly.

    A run without one is a bug in whatever triggered it, not a data problem —
    there is nothing to retry and nothing to report against, so it stops here.
    """
    conf = (context["dag_run"].conf or {}) if context.get("dag_run") else {}
    job_id = (conf.get("import_job_id") or "").strip()
    if not job_id:
        raise AirflowFailException(
            "This DAG must be triggered with conf {'import_job_id': '<uuid>'}; got "
            f"conf={conf!r}"
        )
    return job_id


def mark_job_failed(context) -> None:
    """DAG-level failure callback — never leave a job stuck at `running`.

    A `running` job the UI polls forever is worse than a visible failure, so any
    DagRun failure writes a terminal status. `fail_job` no-ops when the job
    already reached one, so a real outcome is never overwritten.
    """
    try:
        job_id = _job_id_from_context(context)
    except AirflowFailException:
        log.warning("DagRun failed with no import_job_id in conf — nothing to mark")
        return

    reason = str(context.get("reason") or "task failure")
    # `error_message` is shown to the merchant on /imports, so it says what they
    # can do about it. The diagnosis lives here in the log, and the run is
    # already linked from the job's own `dag_run_id` column.
    log.error("Job %s failed in run %s: %s", job_id, context["run_id"], reason)
    try:
        SupabaseClient.from_airflow_variables().fail_job(
            job_id,
            "We could not finish reading this file. Please try uploading it again — "
            "if it keeps failing, the file may be in a format we cannot read yet.",
        )
    except Exception:  # noqa: BLE001 — a broken callback must not mask the real error
        log.exception("Could not mark import job %s as failed", job_id)


@dag(
    dag_id=DAG_ID,
    schedule=None,
    catchup=False,
    max_active_runs=4,
    tags=["buzzly", "imports"],
    doc_md=__doc__,
    params={"import_job_id": ""},
    on_failure_callback=mark_job_failed,
    # Retries are for transient faults only — a flaky network hop to Supabase or
    # Storage. Everything deterministic (missing job, hash mismatch, unbalanced
    # counts) raises AirflowFailException and skips them, because retrying a
    # decision that cannot change just makes the merchant wait longer to be told
    # it failed. 30s over Airflow's 5-minute default for the same reason.
    default_args={"retries": 2, "retry_delay": timedelta(seconds=30)},
)
def buzzly_import_pipeline():
    @task
    def resolve_job() -> dict:
        """Take ownership of the job and move it to `running`.

        Accepts a job that is still `pending` (a hand-trigger from the Airflow
        UI, which bypasses the claim both trigger paths perform) as well as one
        already `queued`. Anything else means a second run is looking at a job
        that is not its own, so this run *skips* rather than fails: a failure
        here would fire `mark_job_failed` and stamp `failed` on a job the run
        that legitimately owns it is still working on.
        """
        context = get_current_context()
        job_id = _job_id_from_context(context)
        run_id = context["dag_run"].run_id
        client = SupabaseClient.from_airflow_variables()

        job = client.get_job(job_id)
        if job is None:
            # Deleted between trigger and pickup, or a bad conf. Never appears.
            raise AirflowFailException(f"import_jobs row {job_id} does not exist")

        status = job["status"]
        if status == "pending":
            # Hand-triggered: claim it now so the sensor cannot pick it up too.
            if not client.claim_job(job_id):
                raise AirflowSkipException(
                    f"Job {job_id} was claimed by another trigger mid-flight"
                )
        elif status == "running" and job.get("dag_run_id") == run_id:
            # This task is retrying after it already flipped the job to running.
            log.info("Re-entering job %s, already owned by this run", job_id)
        elif status != "queued":
            raise AirflowSkipException(
                f"Job {job_id} is {status!r}, expected 'pending' or 'queued' — "
                "another run already owns it"
            )

        client.mark_running(job_id, run_id)
        log.info(
            "Claimed import job %s (team=%s platform=%s file=%s) as run %s",
            job_id, job["team_id"], job["platform"], job["original_filename"], run_id,
        )
        return {
            "import_job_id": job_id,
            "team_id": job["team_id"],
            "platform": job["platform"],
            "storage_path": job["storage_path"],
            "original_filename": job["original_filename"],
            "file_hash": job.get("file_hash"),
            "file_size_bytes": job.get("file_size_bytes"),
        }

    @task
    def verify_artifact(job: dict) -> dict:
        """Download the object, check it against the upload, stage it on disk.

        A job row only ever exists after its object is in Storage (the upload UI
        writes the object first and deletes it if the row insert fails), so a
        missing object here is a real fault, not a race.

        The bytes are written to the run's staging directory rather than
        returned: later stages need the file, and XCom is the metadata database,
        not a file store.
        """
        context = get_current_context()
        client = SupabaseClient.from_airflow_variables()
        data = client.download_import(job["storage_path"])

        # Uploads are immutable (no Storage UPDATE policy), so neither of these
        # can come right on a retry — fail permanently rather than wait twice.
        expected_size = job.get("file_size_bytes")
        if expected_size is not None and len(data) != expected_size:
            raise AirflowFailException(
                f"Size mismatch for {job['storage_path']}: "
                f"stored {len(data)} bytes, job row says {expected_size}"
            )

        digest = sha256_hex(data)
        expected_hash = job.get("file_hash")
        if expected_hash and digest != expected_hash:
            raise AirflowFailException(
                f"Hash mismatch for {job['storage_path']}: "
                f"computed {digest}, job row says {expected_hash}"
            )

        staged = write_staged(
            staging_path(context["dag_run"].run_id, job["original_filename"]), data
        )
        log.info("Artifact verified (%s bytes, sha256=%s) and staged at %s",
                 len(data), digest, staged)
        return new_ledger(job, staging_path=str(staged), size_bytes=len(data), sha256=digest)

    @task
    def hash_dedupe(job: dict, ledger: dict) -> dict:
        """Skip bytes this workspace has already ingested rows from.

        The hash is the one the browser computed at upload time and
        `verify_artifact` has just re-derived from the stored object, so equal
        hashes really do mean equal files. Re-ingesting would be harmless once
        the upserts of step 7 land, but it costs the merchant a wait and muddies
        `sync_history`; telling them which import already covers this file is
        the more useful answer.

        "Already ingested rows from" is stricter than "already succeeded" on
        purpose — see `find_completed_import`.
        """
        digest = ledger.get("sha256")
        if not digest:
            return run_stage("hash_dedupe", ledger, note="no hash to compare")

        previous = SupabaseClient.from_airflow_variables().find_completed_import(
            job["team_id"], digest, job["import_job_id"]
        )
        if previous is None:
            return run_stage("hash_dedupe", ledger, note="no earlier import of these bytes")

        # The predecessor's id goes in the log, not in the reason: the reason is
        # rendered to the merchant on /imports, and a uuid tells them nothing.
        log.info("Job %s duplicates import %s", job["import_job_id"], previous["id"])
        return short_circuit(
            "hash_dedupe", ledger,
            f"this file was already imported as {previous.get('original_filename')} "
            f"({previous.get('rows_ok')} rows)",
        )

    @task
    def detect_format(job: dict, ledger: dict) -> dict:
        """TODO step 5 — sniff csv vs xlsx, delimiter, encoding, BOM.

        Extension is a hint, not evidence: merchants rename exports, and the
        dirty fixtures include a UTF-8-BOM CSV. xlsx is a ZIP (`50 4B 03 04`).
        Sets `file_format` and `encoding`.
        """
        return run_stage("detect_format", ledger, todo="step 5 — format/encoding detection")

    @task
    def parse(job: dict, ledger: dict) -> dict:
        """TODO step 5 — read the staged file into rows.

        pandas/openpyxl over `ledger["staging_path"]`; re-download via
        `read_staged` returning None if a retry lands on a fresh container.
        Sets `rows_total` and hands the rows on out-of-band (a staged intermediate,
        not XCom).
        """
        return run_stage("parse", ledger, todo="step 5 — parse to rows")

    @task
    def clean_thai(job: dict, ledger: dict) -> dict:
        """TODO step 5 — the Thai-locale cleaning module. This is the research core.

        Buddhist Era dates -> Gregorian, Thai column headers -> canonical fields,
        `฿1,234.56` and `1,234.56 บาท` -> numbers, parenthesised negatives,
        zero-width/non-breaking whitespace, Shopee fee column synonyms. Its own
        package with unit tests independent of Airflow; Thai numerals ๐-๙ are
        explicitly out of scope.
        """
        return run_stage("clean_thai", ledger, todo="step 5 — Thai-locale cleaning")

    @task
    def validate(job: dict, ledger: dict) -> dict:
        """TODO step 6 — per-row validation; splits rows_ok from rows_quarantined.

        Whatever it decides, `rows_ok + rows_quarantined` must equal
        `rows_total`; `finalize` refuses to report counts that do not balance.
        """
        return run_stage("validate", ledger, todo="step 6 — row validation")

    @task
    def quarantine_bad_rows(job: dict, ledger: dict) -> dict:
        """TODO step 6 — write rejects to import_row_errors + a downloadable CSV.

        The CSV goes in the job's own Storage folder (uploads are immutable, but
        the folder accepts new objects) and its path lands in
        `error_report_path`, which is what turns the job `partial`.
        """
        return run_stage("quarantine_bad_rows", ledger, todo="step 6 — quarantine + error report")

    @task
    def upsert_target(job: dict, ledger: dict) -> dict:
        """TODO step 7 — idempotent upsert into the tables the mock path writes.

        Ad exports go to the existing campaign/ad tables via
        `ad_insights_account_ad_date_key` (`on_conflict=ad_account_id,ads_id,date`,
        `Prefer: resolution=merge-duplicates`) so a re-run overwrites rather than
        duplicates; then log to `sync_history`. Shopee income needs the wedge
        tables, which do not exist yet — that is step 10.
        """
        return run_stage("upsert_target", ledger, todo="step 7 — idempotent upsert")

    @task
    def finalize(job: dict, ledger: dict) -> str:
        """Write the one terminal status for this job."""
        try:
            assert_consistent(ledger)
        except ValueError as exc:
            # A stage lost rows. Retrying replays the same ledger, so fail now
            # and let the DAG callback mark the job failed — a visible failure
            # beats reporting counts that do not add up.
            raise AirflowFailException(str(exc)) from exc

        status, message = terminal_status(ledger)

        SupabaseClient.from_airflow_variables().finalize_job(
            job["import_job_id"],
            status,
            rows_total=ledger["rows_total"],
            rows_ok=ledger["rows_ok"],
            rows_quarantined=ledger["rows_quarantined"],
            error_message=message,
            error_report_path=ledger.get("error_report_path"),
        )

        for entry in ledger.get("trail", []):
            log.info("  %-20s %s", entry["stage"], entry["note"])
        summary = (
            f"Import job {job['import_job_id']} {status} — "
            f"{ledger['rows_ok']}/{ledger['rows_total']} rows ingested"
            + (f" ({message})" if message else "")
        )
        log.info(summary)
        return summary

    @task
    def cleanup_staging() -> None:
        """Drop the run's staged file however the run ended.

        Wired as a **teardown** (see below), which is what makes it run after a
        failure as well as a success — a failed run is exactly when a staged
        upload would otherwise be left behind, and 50 MB per abandoned run adds
        up.
        """
        run_id = get_current_context()["dag_run"].run_id
        log.info("Staging for %s %s", run_id, "removed" if clear_staging(run_id) else "was empty")

    job = resolve_job()
    ledger = verify_artifact(job)
    for stage in (hash_dedupe, detect_format, parse, clean_thai, validate,
                  quarantine_bad_rows, upsert_target):
        ledger = stage(job, ledger)

    # `.as_teardown()`, not `trigger_rule=ALL_DONE`. Airflow derives the DagRun
    # state from its *leaf* tasks, so a plain ALL_DONE cleanup hanging off the
    # end swallows the run's failure: cleanup succeeds, the run is marked
    # successful, `on_failure_callback` never fires, and the job the failure was
    # supposed to report sits at `running` forever. Teardown tasks are excluded
    # from that calculation, so the failure still surfaces — verified by running
    # both wirings against a deliberately broken stage.
    finalize(job, ledger) >> cleanup_staging().as_teardown()


buzzly_import_pipeline()
