"""Buzzly merchant-file ingestion pipeline.

Triggered once per uploaded file with ``conf = {"import_job_id": "<uuid>"}``,
either by the ``airflow-trigger`` Edge Function (DB webhook on INSERT) or by
``buzzly_import_sensor`` when that webhook does not land.

Shape::

    resolve_job -> verify_artifact -> hash_dedupe -> detect_format -> parse
                -> clean_thai -> validate -> quarantine_bad_rows -> upsert_target
                -> finalize -> cleanup_staging

Every stage is now implemented: an ad export uploaded on /imports is parsed,
cleaned, validated, diagnosed row-by-row where it has to be, and stored in the
same ad tables a connected platform writes — so it reaches the dashboard through
the code that already draws the charts. The datasets that feed True Net Profit
(Shopee income, product costs) are read and reported but not yet stored: the
tables for them do not exist, and ``clean_thai`` says so rather than claiming an
import that did not happen.

All of it, or none of it
------------------------
A file is committed in full or not at all. Every accepted row is buffered into
``ingestion_staging`` and then moved into the ad tables by a single
``promote_batch`` call — one request, one transaction, six tables. One rejected
row refuses the whole file.

Row-level *diagnosis* is unaffected: every rejected row still gets its reason in
``import_row_errors`` and in the downloadable CSV, which under this rule is the
only thing a merchant gets back and is therefore critical path rather than a
nicety. A refused file also gets exactly one record in ``ingestion_dlq`` saying
which kind of refusal it was — the engineers' view, not the merchant's, and the
two disagree about duplicates on purpose.

**One stage per task, on purpose.** Fewer, fatter tasks would run faster (no
XCom round-trip between them), but each stage boundary is a retry boundary, a
log boundary and a measurement point — Airflow records duration per task, which
is the per-stage throughput the research write-up needs, at no extra cost. What
crosses those boundaries is defined in ``buzzly_common.pipeline``; the uploaded
file itself never does, it is staged on disk and referenced by path.

Status transitions owned here (service_role — clients have no UPDATE policy)::

    pending|queued -> running -> succeeded | failed

Trigger by hand while testing::

    docker compose --profile debug run --rm airflow-cli \
        airflow dags trigger buzzly_import_pipeline \
        --conf '{"import_job_id": "<uuid>"}'
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from datetime import timedelta

from airflow.sdk import dag, get_current_context, task
from airflow.sdk.exceptions import AirflowFailException, AirflowSkipException

from buzzly_common import dlq
from buzzly_common.mapping import detect_dataset
from buzzly_common.pipeline import (
    assert_consistent,
    clear_staging,
    new_ledger,
    read_intermediate,
    read_staged,
    reported_counts,
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
    batch_id_for,
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


def _set_stage(job: dict, stage: str) -> None:
    """Tell /imports which stage this job is in. Best-effort, never fatal.

    Called at the top of each task rather than from `run_stage`, because
    `buzzly_common.pipeline` is deliberately stdlib-only — it holds the stage
    contract and is unit-tested without Airflow or `requests`, and giving it an
    HTTP dependency to save nine lines here would cost that.

    Reporting where a job *is* only helps if it cannot stop the job getting
    there, so every failure below is swallowed (`SupabaseClient.set_stage`
    handles the request, this handles a missing Variable).
    """
    try:
        SupabaseClient.from_airflow_variables().set_stage(job["import_job_id"], stage)
    except Exception:  # noqa: BLE001 — progress reporting must never fail an import
        log.warning("Could not record stage %r", stage, exc_info=True)


def _safe_run_id() -> str | None:
    """This run's id, or None when there is no context to read it from."""
    try:
        return get_current_context()["dag_run"].run_id
    except Exception:  # noqa: BLE001 — an id for a log line is not worth a failure
        return None


def _write_dlq(
    job: dict,
    *,
    error_code: str,
    error_message: str,
    stage: str,
    rows_attempted: int = 0,
    rows_rejected: int = 0,
    rejected: list[dict] | None = None,
    batch_id: str | None = None,
) -> None:
    """Record a refused file in the engineers' dead-letter queue.

    Deliberately cannot fail the run. The DLQ is diagnostic infrastructure, and
    a merchant's import must not end differently because our own ledger was
    unreachable — the merchant's outcome is `import_jobs.status`, which is
    written elsewhere and by then already decided.

    The trade that follows is worth stating: a DLQ write that silently fails
    shows up as a *missing* record, and "every refused file produces exactly one
    record" is a graded measurement. That is the right way round. The harness
    reading a gap and failing is a true report; an import failing because its
    post-mortem could not be filed would not be.
    """
    try:
        record = dlq.build_record(
            job=job,
            error_code=error_code,
            error_message=error_message,
            stage=stage,
            rows_attempted=rows_attempted,
            rows_rejected=rows_rejected,
            rejected=rejected,
            batch_id=batch_id,
            dag_run_id=_safe_run_id(),
        )
        SupabaseClient.from_airflow_variables().write_dlq(record)
        log.info("DLQ: job %s recorded as %s at %s", job["import_job_id"], error_code, stage)
    except Exception:  # noqa: BLE001 — see the docstring
        log.exception("Could not write the DLQ record for %s", job["import_job_id"])


def _record_refusal(job: dict, ledger: dict, status: str) -> None:
    """File a dead-letter record when a run stored nothing. No-op otherwise.

    Called from `finalize`, once, for the outcomes the earlier stages did not
    already record themselves:

    * **Rows were rejected.** The file is refused whole. The code says whether
      the *headers* were unusable (every row then fails for the same reason, and
      calling that a row problem would point the merchant at the wrong thing) or
      the rows themselves were.
    * **The file held no data rows.** A success to the merchant — there is
      nothing wrong with their file, there is just nothing in it — and an
      EMPTY_PAYLOAD here, because a file that produced no rows is worth counting.

    Two cases are deliberately silent. A duplicate already wrote its own record
    in `hash_dedupe`, where the evidence is. And a file we read perfectly but
    have nowhere to keep — a Shopee income report, a COGS sheet — is neither
    ingested nor refused: none of the seven codes describes it, and inventing an
    eighth to make the arithmetic tidy would put a fiction in the measurement.
    It is an open question for the fixture manifest, not something to paper over
    here.
    """
    if ledger.get("skipped"):
        return
    if status == "succeeded" and ledger.get("rows_total"):
        return  # a real commit

    if not ledger.get("rows_total"):
        _write_dlq(
            job,
            error_code=dlq.EMPTY_PAYLOAD,
            error_message="The file was readable but contained no data rows.",
            stage="finalize",
        )
        return

    if not ledger.get("rows_quarantined"):
        return

    missing = ledger.get("missing_required") or []
    rejected = []
    payload = read_intermediate(_run_id(), "validated")
    if payload:
        rejected = payload.get("rejected") or []
    elif not missing:
        log.warning("Validated rows are gone from staging; classifying the refusal blind")

    if missing:
        code = dlq.SCHEMA_MISMATCH
        reason = (
            f"Required column(s) {missing} were not found in this file's headers, "
            f"so all {ledger['rows_total']} rows were rejected."
        )
    else:
        code = dlq.classify_rejections(rejected)
        reason = (
            f"{ledger['rows_quarantined']} of {ledger['rows_total']} rows were rejected; "
            "the file is imported only in full, so nothing was stored."
        )

    _write_dlq(
        job,
        error_code=code,
        error_message=reason,
        stage="validate",
        rows_attempted=ledger["rows_total"],
        rows_rejected=ledger["rows_quarantined"],
        rejected=rejected,
    )


def _fail_with_message(job: dict, message: str, *, stage: str,
                       error_code: str | None = None, detail: str | None = None) -> None:
    """Fail the job with a message written for the merchant, then stop the run.

    The DAG-level callback writes a deliberately generic apology because it
    cannot know what went wrong. Here we do know — "the file is empty", "this is
    a legacy .xls" — and that sentence is worth far more than the generic one.
    Writing the terminal status first means the callback's `fail_job` finds a
    job that is already terminal and no-ops, so the specific message survives.

    The same sentence is what classifies the file for the DLQ: `reader` raises
    one exception type from several places, so the message is the only thing
    distinguishing "0 bytes" from "we cannot decode this". A caller that already
    knows the code passes it, with an engineer-facing `detail` for the DLQ.
    """
    _write_dlq(
        job,
        error_code=error_code or dlq.classify_unreadable(message),
        error_message=detail or message,
        stage=stage,
    )
    try:
        SupabaseClient.from_airflow_variables().fail_job(job["import_job_id"], message)
    except Exception:  # noqa: BLE001 — never mask the real failure
        log.exception("Could not write the failure message for %s", job["import_job_id"])
    raise AirflowFailException(message)


_CRASH_MESSAGES = {
    dlq.ENCODING_ERROR: (
        "We could not read this file's text encoding. Please save it as a UTF-8 "
        "CSV and upload it again."
    ),
}
_CRASH_FALLBACK = (
    "Something in this file stopped us reading it. Nothing was imported. Please "
    "check the file and upload it again — if it keeps failing, contact support."
)


@contextmanager
def _refuse_on_crash(job: dict, stage: str):
    """Turn any exception from file-reading logic into a refused file.

    Every file must end committed or quarantined. A bare exception escaping a
    parse/validate stage used to crash the task before `_write_dlq` ran, so the
    file vanished from the DLQ (fix_13). Here it is classified, recorded, and
    the job is failed with nothing stored — no stage after this one runs.

    Wrap only the *deterministic* work. Storage and staging I/O stay outside,
    so a transient network fault still gets Airflow's retries instead of a
    permanent refusal.
    """
    try:
        yield
    except (AirflowFailException, AirflowSkipException):
        raise
    except UnreadableFile as exc:
        _fail_with_message(job, str(exc), stage=stage)
    except Exception as exc:  # noqa: BLE001 — classified and recorded, never swallowed
        code = dlq.classify_exception(exc)
        log.exception("Stage %s crashed on job %s; refusing the file as %s",
                      stage, job["import_job_id"], code)
        _fail_with_message(
            job, _CRASH_MESSAGES.get(code, _CRASH_FALLBACK), stage=stage,
            error_code=code, detail=f"{type(exc).__name__} in {stage}: {exc}",
        )


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
        # Only now — before the ownership check above, this run could stamp its
        # progress onto a job another run legitimately owns.
        client.set_stage(job_id, "resolve_job")
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
        client.set_stage(job["import_job_id"], "verify_artifact")
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
        _set_stage(job, "hash_dedupe")
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

        # The two views of this event disagree on purpose. To the merchant a
        # duplicate is a *success* that stored nothing — their data is already
        # here, and telling them their upload failed would be false and would
        # invite them to try again. To the engineers it is a file that went in
        # and produced no rows, which is worth counting, so it gets a DLQ record.
        _write_dlq(
            job,
            error_code=dlq.DUPLICATE_BATCH,
            error_message=(
                f"Byte-identical to import {previous['id']} "
                f"({previous.get('original_filename')}, {previous.get('rows_ok')} rows). "
                "Not re-ingested."
            ),
            stage="hash_dedupe",
        )
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
        _set_stage(job, "detect_format")
        if ledger.get("skipped"):
            return run_stage("detect_format", ledger)

        data = _staged_bytes(job, ledger)
        # Deterministic and explainable — the merchant gets the real reason.
        with _refuse_on_crash(job, "detect_format"):
            file_format = sniff_format(data, job["original_filename"])
            encoding = detect_encoding(data)[0] if file_format == "csv" else None

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
        _set_stage(job, "parse")
        if ledger.get("skipped"):
            return run_stage("parse", ledger)

        data = _staged_bytes(job, ledger)
        with _refuse_on_crash(job, "parse"):
            table = read_table(data, job["original_filename"])

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
        _set_stage(job, "clean_thai")
        if ledger.get("skipped"):
            return run_stage("clean_thai", ledger)

        run_id = _run_id()
        table = read_intermediate(run_id, "table")
        if table is None:
            # Staging vanished between tasks. Re-read rather than fail: the
            # source of truth is Storage, and this is a normal container event.
            log.info("Parsed table missing from staging — re-reading the file")
            data = _staged_bytes(job, ledger)
            with _refuse_on_crash(job, "clean_thai"):
                table = read_table(data, job["original_filename"])
                table = {"headers": table["headers"], "rows": jsonable(table["rows"])}

        with _refuse_on_crash(job, "clean_thai"):
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

        with _refuse_on_crash(job, "clean_thai"):
            records = build_records(
                [(number, cells) for number, cells in table["rows"]], mapping)

        write_intermediate(run_id, "records", jsonable({
            "dataset": dataset,
            "mapping": mapping,
            "records": records,
        }))

        note = summarize_mapping(mapping)
        missing = list(mapping["missing_required"])
        if missing:
            # Still not fatal here — `validate` rejects the rows and the merchant
            # gets a per-row reason, which is more useful than a file-level
            # refusal that names no row. But it is carried forward, because it
            # changes what the refusal is *called*: when a required column is
            # absent every row fails for one reason, and "these headers are not a
            # shape we can store" is the true diagnosis rather than "your rows
            # broke the rules".
            note += f"; missing required {missing}"
        log.info("Header mapping: %s", mapping["columns"])
        return run_stage("clean_thai", ledger, missing_required=missing, note=note)

    @task
    def validate(job: dict, ledger: dict) -> dict:
        """Split the typed rows into what may be ingested and what may not.

        `rows_ok + rows_quarantined == rows_total` is enforced by `finalize`;
        this is the stage that has to make it true.
        """
        _set_stage(job, "validate")
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
        with _refuse_on_crash(job, "validate"):
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
        outcome actionable rather than merely reported.

        This runs even though the file will not be committed, and that is the
        point. Under all-or-nothing the merchant gets no rows back, so this
        report is the *entire* return on their upload — it is critical path, not
        a diagnostic extra. It is also what keeps the quarantine precision and
        recall measurement alive now that rejected rows no longer change what is
        stored.
        """
        _set_stage(job, "quarantine_bad_rows")
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
        """Commit the file — every accepted row, in one transaction, or none.

        Two phases. The rows are buffered into `ingestion_staging` over as many
        requests as the file needs, and then a single `promote_batch` call moves
        all of them into the ad tables. PostgREST runs one request in one
        transaction, so that call is the commit boundary for six tables at once.

        The shape this replaced wrote each table in its own request, and a fault
        partway through left campaigns and ads in the merchant's dashboard
        without the insights that give them numbers — beside a job status that
        said the import had failed.

        **A file with any rejected row is not committed at all.** The guard
        below is where all-or-nothing actually happens; `quarantine_bad_rows`
        has already run, so the merchant still gets every reason in their error
        report, they just do not get a partial import.

        Retry-safe by construction: the batch id is derived from the job id, so
        a second attempt promotes the same batch, and `promote_batch` reports it
        as already promoted rather than writing the file twice.
        """
        _set_stage(job, "upsert_target")
        if ledger.get("skipped") or not ledger.get("rows_ok"):
            return run_stage("upsert_target", ledger, note="nothing to store")
        if ledger.get("rows_quarantined"):
            # The refusal itself, and the DLQ record for it, are written by
            # `finalize` — one task decides the outcome, as it always has.
            return run_stage(
                "upsert_target", ledger,
                note=(f"not committed — {ledger['rows_quarantined']} of "
                      f"{ledger['rows_total']} rows were rejected and a file is "
                      "imported only in full"),
            )

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

        # The merchant's own record that data arrived, in the same place a
        # platform sync reports itself (Settings -> integrations). Staged with
        # everything else rather than written afterwards, so it cannot survive
        # as evidence of a sync whose data did not commit.
        #
        # `sync_history.platform_id` is NOT NULL and "generic" names no platform,
        # so those imports store their data and skip the log entry.
        history = None
        if platform_id:
            history = jsonable(sync_history_row(
                import_job_id=job["import_job_id"],
                team_id=job["team_id"],
                platform_id=platform_id,
                rows_synced=len(built["insights"]),
                started_at=started_at,
                completed_at=utcnow_iso(),
            ))
        else:
            log.info("No platform maps to %r — skipping the sync_history entry", platform)

        batch_id = batch_id_for(job["import_job_id"])
        try:
            result = ingest_ad_performance(
                client, jsonable(built),
                batch_id=batch_id,
                import_job_id=job["import_job_id"],
                team_id=job["team_id"],
                sync_history=history,
            )
        except Exception as exc:  # noqa: BLE001 — the reason is recorded, then re-raised
            # The promote rolled back, so production is untouched; what is left
            # is a buffer nobody will read. Recording *why* takes its own
            # request, which is its own transaction — that is the only reason
            # this record survives the failure it describes.
            _write_dlq(
                job,
                error_code=dlq.UNKNOWN,
                error_message=f"The commit failed and nothing was stored: {exc}",
                stage="upsert_target",
                rows_attempted=ledger.get("rows_total", 0),
                batch_id=batch_id,
            )
            try:
                client.discard_staging_batch(batch_id)
            except Exception:  # noqa: BLE001 — leftover buffer is not worth masking the fault
                log.warning("Could not discard the staging buffer for %s", batch_id)
            raise

        promoted = result["promoted"]
        stored = result["rows_promoted"]
        note = (
            f"{stored} daily rows into ad_insights across "
            f"{promoted.get('campaigns', 0)} campaigns / {promoted.get('ads', 0)} ads"
        )
        if result["already_promoted"]:
            # A retry, or a run that raced its own duplicate. Either way the data
            # is in and writing it again would be the bug.
            note += " (batch was already committed; nothing rewritten)"
        elif stored != ledger["rows_ok"]:
            # Fewer stored rows than accepted rows is normal — an export split
            # by placement has several rows for one ad-day — but it is exactly
            # the kind of gap that looks like data loss in a log, so name it.
            note += f" (from {ledger['rows_ok']} accepted rows)"
        log.info("Committed batch %s into ad account %s: %s", batch_id, ad_account_id, result)
        return run_stage("upsert_target", ledger, note=note)

    @task
    def finalize(job: dict, ledger: dict) -> str:
        """Write the one terminal status for this job — and, if it was refused, why.

        Both views are written here because both are decisions about the same
        thing and one task should make them: `import_jobs` is what the merchant
        reads on /imports, `ingestion_dlq` is what an engineer and the KPI
        harness read. They agree on every outcome except a duplicate upload,
        which is a success to one and a refusal to the other.
        """
        _set_stage(job, "finalize")
        try:
            assert_consistent(ledger)
        except ValueError as exc:
            # A stage lost rows. Retrying replays the same ledger, so fail now
            # and let the DAG callback mark the job failed — a visible failure
            # beats reporting counts that do not add up.
            raise AirflowFailException(str(exc)) from exc

        status, message = terminal_status(ledger)
        counts = reported_counts(ledger)

        _record_refusal(job, ledger, status)

        SupabaseClient.from_airflow_variables().finalize_job(
            job["import_job_id"],
            status,
            rows_total=counts["rows_total"],
            rows_ok=counts["rows_ok"],
            rows_quarantined=counts["rows_quarantined"],
            error_message=message,
            error_report_path=ledger.get("error_report_path"),
        )

        for entry in ledger.get("trail", []):
            log.info("  %-20s %s", entry["stage"], entry["note"])
        summary = (
            f"Import job {job['import_job_id']} {status} — "
            f"{counts['rows_ok']}/{counts['rows_total']} rows ingested"
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
