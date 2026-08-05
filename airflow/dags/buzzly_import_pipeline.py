"""Buzzly merchant-file ingestion pipeline.

Triggered once per uploaded file with ``conf = {"import_job_id": "<uuid>"}``,
either by the ``airflow-trigger`` Edge Function (DB webhook on INSERT) or by
``buzzly_import_sensor`` when that webhook does not land.

Shape::

    resolve_job -> verify_artifact -> hash_dedupe -> detect_format -> parse
                -> clean_thai -> validate -> quarantine_bad_rows -> upsert_target
                -> finalize -> cleanup_staging

Every stage is now implemented: an ad export uploaded on /imports is parsed,
cleaned, validated, quarantined row-by-row where it has to be, and stored in the
same ad tables a connected platform writes — so it reaches the dashboard through
the code that already draws the charts. The datasets that feed True Net Profit
(Shopee income, product costs) are read and reported but not yet stored: the
tables for them do not exist, and ``clean_thai`` says so rather than claiming an
import that did not happen.

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

from buzzly_common.mapping import detect_dataset
from buzzly_common.pipeline import (
    assert_consistent,
    clear_staging,
    new_ledger,
    read_intermediate,
    read_staged,
    run_stage,
    short_circuit,
    staging_path,
    terminal_status,
    write_intermediate,
    write_staged,
)
from buzzly_common.reader import UnreadableFile, detect_encoding
from buzzly_common.reader import detect_format as sniff_format
from buzzly_common.reader import read_table
from buzzly_common.records import (
    build_records,
    jsonable,
    rehydrate_records,
    summarize_mapping,
)
from buzzly_common.report import build_error_report, flatten_problems, report_filename
from buzzly_common.supabase import SupabaseClient, sha256_hex, utcnow_iso
from buzzly_common.targets import (
    DATASET_LABEL,
    build_ad_performance_payload,
    ingest_ad_performance,
    platform_slug_for,
    resolve_ad_account,
    sync_history_row,
    target_table_for,
)
from buzzly_common.validate import validate_records

log = logging.getLogger(__name__)

DAG_ID = "buzzly_import_pipeline"


def _run_id() -> str:
    return get_current_context()["dag_run"].run_id


def _staged_bytes(job: dict, ledger: dict) -> bytes:
    """The uploaded file, from staging or re-downloaded.

    Staging is a cache, never the record. A retry can land on a container that
    never wrote the file, and `read_staged` returning None is the expected way
    to find that out — so this re-downloads rather than failing, and re-stages
    so the stages after it do not each pay for the round trip.
    """
    data = read_staged(ledger["staging_path"])
    if data is not None:
        return data

    log.info("Staged file is gone; re-downloading %s", job["storage_path"])
    data = SupabaseClient.from_airflow_variables().download_import(job["storage_path"])
    write_staged(ledger["staging_path"], data)
    return data


def _fail_with_message(job: dict, message: str) -> None:
    """Fail the job with a message written for the merchant, then stop the run.

    The DAG-level callback writes a deliberately generic apology because it
    cannot know what went wrong. Here we do know — "the file is empty", "this is
    a legacy .xls" — and that sentence is worth far more than the generic one.
    Writing the terminal status first means the callback's `fail_job` finds a
    job that is already terminal and no-ops, so the specific message survives.
    """
    try:
        SupabaseClient.from_airflow_variables().fail_job(job["import_job_id"], message)
    except Exception:  # noqa: BLE001 — never mask the real failure
        log.exception("Could not write the failure message for %s", job["import_job_id"])
    raise AirflowFailException(message)


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
        """Decide csv vs xlsx and, for csv, the text encoding — from the bytes.

        The extension is a hint, never evidence: merchants rename exports. A
        wrong answer here is not a wrong row, it is a wrong *file* — a Thai CSV
        decoded as Latin-1 parses "successfully" into mojibake and maps no
        columns at all, so this is where a silent total loss is prevented.
        """
        if ledger.get("skipped"):
            return run_stage("detect_format", ledger)

        data = _staged_bytes(job, ledger)
        try:
            file_format = sniff_format(data, job["original_filename"])
            encoding = detect_encoding(data)[0] if file_format == "csv" else None
        except UnreadableFile as exc:
            # Deterministic and explainable — the merchant gets the real reason.
            _fail_with_message(job, str(exc))

        return run_stage(
            "detect_format", ledger,
            file_format=file_format, encoding=encoding,
            note=f"{file_format}" + (f" ({encoding})" if encoding else ""),
        )

    @task
    def parse(job: dict, ledger: dict) -> dict:
        """Read the file into a header row and numbered data rows.

        Blank spacers and `รวมทั้งหมด` totals rows are dropped here rather than
        counted as rejects — they are furniture, and reporting them as errors
        would tell a merchant with a perfectly good file that it had problems.

        The rows go to a staged intermediate, never XCom: a 3,458-row Shopee
        report is megabytes of JSON and XCom is the metadata database.
        """
        if ledger.get("skipped"):
            return run_stage("parse", ledger)

        data = _staged_bytes(job, ledger)
        try:
            table = read_table(data, job["original_filename"])
        except UnreadableFile as exc:
            _fail_with_message(job, str(exc))

        write_intermediate(_run_id(), "table", {
            "headers": table["headers"],
            "rows": jsonable(table["rows"]),
            "header_row": table["header_row"],
        })

        dropped = table["blank_rows"] + table["summary_rows"]
        note = f"{len(table['rows'])} data rows from {len(table['headers'])} columns"
        if dropped:
            note += (f"; skipped {table['blank_rows']} blank + "
                     f"{table['summary_rows']} summary rows")
        return run_stage("parse", ledger, rows_total=len(table["rows"]), note=note)

    @task
    def clean_thai(job: dict, ledger: dict) -> dict:
        """The Thai-locale cleaning module — the research core.

        Buddhist-era dates to Gregorian, Thai headings to canonical fields,
        `฿1,234.56` and `1,234.56 บาท` to exact decimals, accounting negatives,
        zero-width and non-breaking whitespace. The rules live in
        `buzzly_common.thai` and `buzzly_common.mapping`, which import neither
        Airflow nor pandas so they can be measured on their own — see
        `airflow/tests/test_thai.py` and `test_ingest.py`.

        Nothing is rejected here. A cell that will not parse records an issue on
        its row and leaves the field empty; `validate` decides what that costs.
        """
        if ledger.get("skipped"):
            return run_stage("clean_thai", ledger)

        run_id = _run_id()
        table = read_intermediate(run_id, "table")
        if table is None:
            # Staging vanished between tasks. Re-read rather than fail: the
            # source of truth is Storage, and this is a normal container event.
            log.info("Parsed table missing from staging — re-reading the file")
            table = read_table(_staged_bytes(job, ledger), job["original_filename"])
            table = {"headers": table["headers"], "rows": jsonable(table["rows"])}

        dataset, mapping = detect_dataset(table["headers"], job["platform"])
        mapping["headers"] = table["headers"]

        if target_table_for(dataset) is None:
            # We can read this file; we have nowhere to keep it. Stopping here
            # rather than at `upsert_target` is deliberate: validating first
            # would hand the merchant an error report for rows we then admit we
            # never took, and quarantine writes would outlive counters that the
            # short-circuit has to zero. Say so now, before any of that.
            return short_circuit(
                "clean_thai", ledger,
                f"this is {DATASET_LABEL[dataset]} — we read all "
                f"{ledger['rows_total']} rows of it, but the tables that store "
                "this kind of data are not built yet",
                rows_total=0,
            )

        records = build_records([(number, cells) for number, cells in table["rows"]], mapping)

        write_intermediate(run_id, "records", jsonable({
            "dataset": dataset,
            "mapping": mapping,
            "records": records,
        }))

        note = summarize_mapping(mapping)
        if mapping["missing_required"]:
            # Not fatal on its own — `validate` will reject the rows and the
            # merchant gets a per-row reason, which is more useful than a
            # file-level refusal that names no row.
            note += f"; missing required {mapping['missing_required']}"
        log.info("Header mapping: %s", mapping["columns"])
        return run_stage("clean_thai", ledger, note=note)

    @task
    def validate(job: dict, ledger: dict) -> dict:
        """Split the typed rows into what may be ingested and what may not.

        `rows_ok + rows_quarantined == rows_total` is enforced by `finalize`;
        this is the stage that has to make it true.
        """
        if ledger.get("skipped"):
            return run_stage("validate", ledger)

        run_id = _run_id()
        payload = read_intermediate(run_id, "records")
        if payload is None:
            raise AirflowFailException(
                "Cleaned records are missing from staging and cannot be rebuilt in "
                "this task — the run will be retried from `clean_thai`."
            )

        # Types must be restored before the rules run; see `rehydrate_records`.
        records = rehydrate_records(payload["records"])
        result = validate_records(records, payload["dataset"])
        counts = result["counts"]

        write_intermediate(run_id, "validated", jsonable({
            "dataset": payload["dataset"],
            "mapped_fields": list(payload["mapping"]["columns"]),
            "ok": result["ok"],
            "rejected": result["rejected"],
        }))

        note = f"{counts['rows_ok']} ok, {counts['rows_quarantined']} rejected"
        if counts["by_reason"]:
            note += " (" + ", ".join(
                f"{code}×{count}" for code, count in sorted(counts["by_reason"].items())
            ) + ")"
        return run_stage(
            "validate", ledger,
            rows_ok=counts["rows_ok"], rows_quarantined=counts["rows_quarantined"],
            note=note,
        )

    @task
    def quarantine_bad_rows(job: dict, ledger: dict) -> dict:
        """Record every rejected row, and give the merchant a file to act on.

        Two destinations because they serve two readers: `import_row_errors` is
        queryable by support, the CSV in the job's Storage folder is what the
        merchant downloads. Setting `error_report_path` is what makes the
        partial result actionable rather than merely reported.
        """
        if ledger.get("skipped") or not ledger.get("rows_quarantined"):
            return run_stage("quarantine_bad_rows", ledger, note="no rows rejected")

        payload = read_intermediate(_run_id(), "validated")
        if payload is None:
            raise AirflowFailException(
                "Validated rows are missing from staging; cannot write the error report."
            )

        rejected = payload["rejected"]
        client = SupabaseClient.from_airflow_variables()

        report = build_error_report(rejected, payload["mapped_fields"])
        report_path = "/".join([
            job["team_id"], job["import_job_id"], report_filename(job["original_filename"]),
        ])
        # Bare "text/csv" — the bucket's mime allowlist matches the whole header
        # string, so "text/csv; charset=utf-8" is rejected with a 415. The
        # encoding is announced by the report's BOM instead, which is what Excel
        # reads anyway.
        client.upload_object(report_path, report, "text/csv")

        stored = client.insert_row_errors(
            job["import_job_id"],
            flatten_problems(rejected, limit=client.MAX_STORED_ERRORS),
        )
        log.info("Wrote %s error rows and a %s-byte report to %s",
                 stored, len(report), report_path)

        return run_stage(
            "quarantine_bad_rows", ledger,
            error_report_path=report_path,
            note=f"{len(rejected)} rows reported ({stored} error records)",
        )

    @task
    def upsert_target(job: dict, ledger: dict) -> dict:
        """Store the accepted rows in the tables the connected path writes.

        Every write is an upsert on a key derived from the file's own contents
        (`buzzly_common.targets`), which is what makes this task safe to retry:
        a failure halfway through leaves rows that the next attempt overwrites
        rather than duplicates. That is also why the whole task can be retried
        at all — without it, a network blip during the insight batch would
        double a merchant's spend.

        The uploaded file, not the pipeline, is authoritative for the days it
        covers: a re-import of a corrected export overwrites those rows and
        leaves every other day alone.
        """
        if ledger.get("skipped") or not ledger.get("rows_ok"):
            return run_stage("upsert_target", ledger, note="nothing to store")

        started_at = utcnow_iso()
        payload = read_intermediate(_run_id(), "validated")
        if payload is None:
            raise AirflowFailException(
                "Validated rows are missing from staging; the run will be retried "
                "from `validate` rather than store an incomplete file."
            )
        if target_table_for(payload["dataset"]) is None:
            # Unreachable — `clean_thai` stops these files before validation.
            raise AirflowFailException(
                f"No target table for dataset {payload['dataset']!r}; "
                "clean_thai should have short-circuited this run."
            )

        client = SupabaseClient.from_airflow_variables()
        platform = job["platform"]
        slug = platform_slug_for(platform)
        platform_id = None
        if slug:
            found = client.select_rows("platforms", f"slug=eq.{slug}&select=id&limit=1")
            platform_id = found[0]["id"] if found else None

        ad_account_id = resolve_ad_account(
            client, team_id=job["team_id"], platform=platform, platform_id=platform_id
        )
        try:
            built = build_ad_performance_payload(
                # Types first: the staged JSON holds dates as text and money as
                # strings, and the arithmetic below is Decimal arithmetic.
                rehydrate_records(payload["ok"]),
                team_id=job["team_id"],
                platform=platform,
                ad_account_id=ad_account_id,
            )
        except ValueError as exc:
            # A row got past `validate` without the fields it guarantees. No
            # retry can fix that, and quietly storing the rest would report more
            # rows imported than were stored.
            raise AirflowFailException(str(exc)) from exc

        written = ingest_ad_performance(client, jsonable(built))

        if platform_id:
            # The merchant's own record that data arrived, in the same place a
            # platform sync reports itself (Settings -> integrations).
            client.upsert_rows(
                "sync_history",
                [sync_history_row(
                    import_job_id=job["import_job_id"],
                    team_id=job["team_id"],
                    platform_id=platform_id,
                    rows_synced=written["insights"],
                    started_at=started_at,
                    completed_at=utcnow_iso(),
                )],
                on_conflict="id",
            )
        else:
            # `sync_history.platform_id` is NOT NULL and "generic" is not a
            # platform. The data still lands; only the sync log entry is skipped.
            log.info("No platform maps to %r — skipping the sync_history entry", platform)

        note = (
            f"{written['insights']} daily rows into ad_insights across "
            f"{written['campaigns']} campaigns / {written['ads']} ads"
        )
        if written["insights"] != ledger["rows_ok"]:
            # Fewer stored rows than accepted rows is normal — an export split
            # by placement has several rows for one ad-day — but it is exactly
            # the kind of gap that looks like data loss in a log, so name it.
            note += f" (from {ledger['rows_ok']} accepted rows)"
        log.info("Ingested into ad account %s: %s", ad_account_id, written)
        return run_stage("upsert_target", ledger, note=note)

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
