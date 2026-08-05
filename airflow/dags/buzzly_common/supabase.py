"""Minimal Supabase (PostgREST + Storage) client for the ingestion DAGs.

Why hand-rolled instead of `supabase-py`: the DAGs need exactly four things —
read a job, claim it atomically, move its status, download its file — and every
one of them is a plain HTTP call. Adding a client library would mean pinning a
dependency into the Airflow image for no gain.

Credentials come from Airflow Variables, never from DAG code or git:

    BUZZLY_SUPABASE_URL               https://<ref>.supabase.co
    BUZZLY_SUPABASE_SERVICE_ROLE_KEY  service_role key (bypasses RLS)

service_role is required, not a convenience: the import_jobs write model has no
UPDATE policy for `authenticated` on purpose — every status transition belongs
to the pipeline. See supabase/migrations/20260723120000_import_jobs_pipeline.sql.

    docker compose --profile debug run --rm airflow-cli \
        airflow variables set BUZZLY_SUPABASE_URL https://xxx.supabase.co
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import requests

log = logging.getLogger(__name__)

IMPORTS_BUCKET = "imports"
JOBS_TABLE = "import_jobs"
ROW_ERRORS_TABLE = "import_row_errors"
STAGING_TABLE = "ingestion_staging"
DLQ_TABLE = "ingestion_dlq"

# Statuses a job can be in before the pipeline takes it over.
CLAIMABLE_STATUS = "pending"
# Statuses the pipeline itself owns.
TERMINAL_STATUSES = ("succeeded", "partial", "failed", "cancelled")

DEFAULT_TIMEOUT = 60


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SupabaseError(RuntimeError):
    """Any non-2xx response from PostgREST or Storage."""


class SupabaseClient:
    """Thin service_role client. One instance per task — cheap to build."""

    def __init__(self, url: str, service_role_key: str) -> None:
        if not url or not service_role_key:
            raise ValueError("SupabaseClient needs both a URL and a service_role key")
        self.url = url.rstrip("/")
        self._session = requests.Session()
        self._session.headers.update(
            {
                "apikey": service_role_key,
                "Authorization": f"Bearer {service_role_key}",
                "Content-Type": "application/json",
            }
        )

    @classmethod
    def from_airflow_variables(cls) -> "SupabaseClient":
        """Build from Airflow Variables. Call inside a task, never at parse time."""
        from airflow.sdk import Variable

        return cls(
            url=Variable.get("BUZZLY_SUPABASE_URL"),
            service_role_key=Variable.get("BUZZLY_SUPABASE_SERVICE_ROLE_KEY"),
        )

    # ── plumbing ──────────────────────────────────────────────────────────────

    def _request(self, method: str, path: str, **kwargs: Any) -> requests.Response:
        response = self._session.request(
            method, f"{self.url}{path}", timeout=kwargs.pop("timeout", DEFAULT_TIMEOUT), **kwargs
        )
        if not response.ok:
            raise SupabaseError(f"{method} {path} -> {response.status_code}: {response.text[:500]}")
        return response

    # ── jobs ──────────────────────────────────────────────────────────────────

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        rows = self._request(
            "GET", f"/rest/v1/{JOBS_TABLE}?id=eq.{quote(job_id)}&select=*"
        ).json()
        return rows[0] if rows else None

    def list_pending_jobs(self, older_than_iso: str, limit: int = 25) -> list[dict[str, Any]]:
        """Jobs still `pending` and older than the webhook grace period.

        The age filter is what keeps the sensor from racing the DB webhook on a
        fresh upload: a job the webhook is about to claim is younger than the
        cutoff, so the sensor does not even look at it.
        """
        query = (
            f"/rest/v1/{JOBS_TABLE}"
            f"?status=eq.{CLAIMABLE_STATUS}"
            f"&created_at=lt.{quote(older_than_iso)}"
            f"&select=id,team_id,platform,storage_path,original_filename,created_at"
            f"&order=created_at.asc&limit={limit}"
        )
        return self._request("GET", query).json()

    def find_completed_import(
        self, team_id: str, file_hash: str, exclude_job_id: str
    ) -> dict[str, Any] | None:
        """The newest succeeded import of these exact bytes that actually took rows.

        Two filters, both load-bearing:

        * Only `succeeded` counts. A `partial` or `failed` predecessor is not a
          reason to skip: the file is identical, but the pipeline that read it
          may have changed, so re-running can legitimately recover more rows.
        * **Only `rows_ok > 0` counts.** "Succeeded with nothing ingested" is not
          evidence the data is already here — every job from before the parser
          existed looks exactly like that, and treating those as duplicates
          would silently refuse the merchant's re-upload forever.
        """
        query = (
            f"/rest/v1/{JOBS_TABLE}"
            f"?team_id=eq.{quote(team_id)}"
            f"&file_hash=eq.{quote(file_hash)}"
            f"&status=eq.succeeded"
            f"&rows_ok=gt.0"
            f"&id=neq.{quote(exclude_job_id)}"
            f"&select=id,original_filename,rows_ok,finished_at"
            f"&order=finished_at.desc.nullslast&limit=1"
        )
        rows = self._request("GET", query).json()
        return rows[0] if rows else None

    def claim_job(self, job_id: str) -> bool:
        """Atomically move `pending` -> `queued`. True only for the winner.

        Both trigger paths (DB webhook and sensor DAG) race for the same rows by
        design — the sensor exists so a dropped webhook self-heals. The race is
        settled here: PostgREST compiles this to a single conditional UPDATE, so
        exactly one caller sees a row come back and the loser sees an empty list.
        """
        rows = self._request(
            "PATCH",
            f"/rest/v1/{JOBS_TABLE}?id=eq.{quote(job_id)}&status=eq.{CLAIMABLE_STATUS}",
            json={"status": "queued", "updated_at": utcnow_iso()},
            headers={"Prefer": "return=representation"},
        ).json()
        return len(rows) == 1

    def release_job(self, job_id: str, error_message: str) -> None:
        """Hand a claimed-but-untriggered job back to `pending` for the sensor."""
        self._request(
            "PATCH",
            f"/rest/v1/{JOBS_TABLE}?id=eq.{quote(job_id)}&status=eq.queued",
            json={
                "status": CLAIMABLE_STATUS,
                "error_message": error_message[:1000],
                "updated_at": utcnow_iso(),
            },
        )

    def release_stale_claims(self, older_than_iso: str) -> list[dict[str, Any]]:
        """Return jobs claimed but never triggered to `pending`.

        A claim followed by a failed trigger leaves a job at `queued` with no
        dag_run_id and nothing watching it. `resolve_job` stamps dag_run_id the
        moment a run picks a job up, so `queued` + NULL dag_run_id + untouched
        for a while is an unambiguous orphan.
        """
        query = (
            f"/rest/v1/{JOBS_TABLE}"
            f"?status=eq.queued&dag_run_id=is.null&updated_at=lt.{quote(older_than_iso)}"
        )
        return self._request(
            "PATCH",
            query,
            json={
                "status": CLAIMABLE_STATUS,
                "error_message": "Claimed but never triggered; returned to the queue.",
            },
            headers={"Prefer": "return=representation"},
        ).json()

    def mark_running(self, job_id: str, dag_run_id: str) -> None:
        self._request(
            "PATCH",
            f"/rest/v1/{JOBS_TABLE}?id=eq.{quote(job_id)}",
            json={
                "status": "running",
                "dag_run_id": dag_run_id,
                "started_at": utcnow_iso(),
                "error_message": None,
                "updated_at": utcnow_iso(),
            },
        )

    def set_stage(self, job_id: str, stage: str) -> None:
        """Publish which stage this job is in. Never raises.

        `status` tells the merchant whether their import is done; this tells
        them what it is doing, which is the difference between a two-minute wait
        and an apparent hang. The DAG already runs one stage per task, so this
        is publishing a boundary that exists rather than inventing one.

        **Errors are swallowed on purpose.** A progress label that can fail an
        import is worth less than no label at all — the merchant loses their
        data over a cosmetic column. A failure is therefore logged and the run
        carries on; the symptom is a stage that stops moving, which is visible
        on /imports precisely because the timestamp is stored next to it.

        The status filter keeps a straggling write from stamping a stage onto a
        job the failure callback has already finished.
        """
        not_terminal = ",".join(TERMINAL_STATUSES)
        try:
            self._request(
                "PATCH",
                f"/rest/v1/{JOBS_TABLE}?id=eq.{quote(job_id)}&status=not.in.({not_terminal})",
                json={
                    "current_stage": stage,
                    "stage_updated_at": utcnow_iso(),
                    "updated_at": utcnow_iso(),
                },
                headers={"Prefer": "return=minimal"},
            )
        except Exception:  # noqa: BLE001 — see the docstring; progress is not worth a failed import
            log.warning("Could not record stage %r for job %s", stage, job_id, exc_info=True)

    def finalize_job(
        self,
        job_id: str,
        status: str,
        *,
        rows_total: int | None = None,
        rows_ok: int | None = None,
        rows_quarantined: int | None = None,
        error_message: str | None = None,
        error_report_path: str | None = None,
    ) -> None:
        if status not in TERMINAL_STATUSES:
            raise ValueError(f"{status!r} is not a terminal status {TERMINAL_STATUSES}")
        payload: dict[str, Any] = {
            "status": status,
            "finished_at": utcnow_iso(),
            "updated_at": utcnow_iso(),
        }
        for key, value in (
            ("rows_total", rows_total),
            ("rows_ok", rows_ok),
            ("rows_quarantined", rows_quarantined),
            ("error_message", error_message[:1000] if error_message else None),
            ("error_report_path", error_report_path),
        ):
            if value is not None:
                payload[key] = value
        self._request(
            "PATCH", f"/rest/v1/{JOBS_TABLE}?id=eq.{quote(job_id)}", json=payload
        )

    def fail_job(self, job_id: str, error_message: str) -> None:
        """Terminal-fail a job unless it already reached a terminal status.

        Used by the DAG-level failure callback, which can fire after finalize
        has already run (e.g. a later task blew up) — the status filter keeps it
        from overwriting a real outcome.
        """
        not_terminal = ",".join(TERMINAL_STATUSES)
        self._request(
            "PATCH",
            f"/rest/v1/{JOBS_TABLE}?id=eq.{quote(job_id)}&status=not.in.({not_terminal})",
            json={
                "status": "failed",
                "error_message": error_message[:1000],
                "finished_at": utcnow_iso(),
                "updated_at": utcnow_iso(),
            },
        )

    # ── quarantine ────────────────────────────────────────────────────────────

    # Rows are sent in batches so one 3,458-row report does not become a single
    # multi-megabyte request that times out halfway and leaves the job's error
    # record half-written.
    ERROR_BATCH_SIZE = 500

    # Above this, the stored rows stop being a diagnosis and start being a
    # second copy of the file. The downloadable CSV always holds every rejected
    # row; this cap only limits what is queryable in Postgres.
    MAX_STORED_ERRORS = 5_000

    def insert_row_errors(self, job_id: str, errors: list[dict[str, Any]]) -> int:
        """Record rejected rows in `import_row_errors`. Returns rows written.

        Rows are keyed to the job and cascade-deleted with it, so no cleanup is
        needed when a merchant deletes an import.
        """
        if not errors:
            return 0

        capped = errors[: self.MAX_STORED_ERRORS]
        written = 0
        for start in range(0, len(capped), self.ERROR_BATCH_SIZE):
            batch = [
                {
                    "import_job_id": job_id,
                    "row_number": entry.get("row_number"),
                    "raw_row": entry.get("raw_row"),
                    "column_name": entry.get("column_name"),
                    "error_code": entry.get("error_code"),
                    "error_message": (entry.get("error_message") or "")[:500],
                }
                for entry in capped[start : start + self.ERROR_BATCH_SIZE]
            ]
            self._request(
                "POST",
                f"/rest/v1/{ROW_ERRORS_TABLE}",
                json=batch,
                headers={"Prefer": "return=minimal"},
            )
            written += len(batch)
        return written

    # ── target tables ─────────────────────────────────────────────────────────

    # Insight rows are small (13 numeric columns), so the limit here is the
    # request, not the row: one 150-row ad export is a single call, and a year
    # of daily rows for a large account still moves in a handful.
    UPSERT_BATCH_SIZE = 500

    def select_rows(self, table: str, query: str) -> list[dict[str, Any]]:
        """Raw PostgREST read. `query` is everything after the `?`."""
        return self._request("GET", f"/rest/v1/{table}?{query}").json()

    def patch_rows(self, table: str, query: str, values: dict[str, Any]) -> None:
        """Conditional update. `query` is everything after the `?`.

        The filter is the point: PostgREST turns it into one UPDATE with a WHERE
        clause, so "only if this makes the range wider" is decided by the
        database rather than by a read the caller performed a moment ago.
        """
        self._request(
            "PATCH", f"/rest/v1/{table}?{query}", json=values,
            headers={"Prefer": "return=minimal"},
        )

    def upsert_rows(self, table: str, rows: list[dict[str, Any]], *, on_conflict: str) -> int:
        """Insert-or-update rows on a unique key. Returns rows sent.

        `resolution=merge-duplicates` is what makes a re-run of the same file an
        update rather than a duplicate; the ids and unique keys the callers
        compute are what make it hit the *same* row (see `buzzly_common.targets`).

        Every object in a batch must carry the same keys — PostgREST builds one
        statement from the whole array and rejects a ragged payload (PGRST102).
        """
        if not rows:
            return 0

        written = 0
        for start in range(0, len(rows), self.UPSERT_BATCH_SIZE):
            batch = rows[start : start + self.UPSERT_BATCH_SIZE]
            self._request(
                "POST",
                f"/rest/v1/{table}?on_conflict={quote(on_conflict, safe=',')}",
                json=batch,
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            )
            written += len(batch)
        return written

    # ── atomic ingestion: stage, then promote ─────────────────────────────────

    # Staged rows are single jsonb payloads, so the limit is request size rather
    # than statement complexity. 500 keeps a 3,458-row report to seven requests.
    STAGE_BATCH_SIZE = 500

    def stage_rows(self, batch_id: str, target_table: str, rows: list[dict[str, Any]]) -> int:
        """Buffer rows for a batch. Returns rows sent.

        **These inserts are deliberately not atomic.** They are several requests
        and a run that dies halfway leaves a partial buffer — which is harmless,
        because staging is not production: nothing reads it but `promote_batch`,
        and only ever one batch id at a time. A batch that never promotes leaves
        rows that are garbage by construction, not half a merchant's file.

        `row_index` only has to be unique within (batch, target_table); it is
        the row's position, which also makes the buffer readable when a promote
        fails and someone goes looking.
        """
        if not rows:
            return 0

        sent = 0
        for start in range(0, len(rows), self.STAGE_BATCH_SIZE):
            chunk = rows[start : start + self.STAGE_BATCH_SIZE]
            self._request(
                "POST",
                f"/rest/v1/{STAGING_TABLE}",
                json=[
                    {
                        "batch_id": batch_id,
                        "target_table": target_table,
                        "row_index": start + offset,
                        "payload": row,
                    }
                    for offset, row in enumerate(chunk)
                ],
                headers={"Prefer": "return=minimal"},
            )
            sent += len(chunk)
        return sent

    def promote_batch(self, batch_id: str, import_job_id: str, team_id: str) -> dict[str, Any]:
        """Commit a staged batch. **This one call is the transaction.**

        PostgREST runs each request in a single transaction, so every table the
        function writes commits together or not at all. That is the whole reason
        the write path moved here from six chained upserts: a fault partway
        through those left half a file in the merchant's dashboard, with counts
        that said the import had failed.

        Returns the function's own report — `already_promoted` is true when this
        batch has been committed before, which is how an Airflow retry of the
        promote task avoids writing the same file twice.
        """
        return self._request(
            "POST",
            "/rest/v1/rpc/promote_batch",
            json={
                "p_batch_id": batch_id,
                "p_import_job_id": import_job_id,
                "p_team_id": team_id,
            },
        ).json()

    def discard_staging_batch(self, batch_id: str) -> int:
        """Drop a refused batch's buffer. Returns rows removed."""
        return self._request(
            "POST", "/rest/v1/rpc/discard_staging_batch", json={"p_batch_id": batch_id}
        ).json()

    # ── dead-letter queue ─────────────────────────────────────────────────────

    def write_dlq(self, record: dict[str, Any]) -> None:
        """Record a refused file in the engineers' queue.

        Called *after* a promote has rolled back, and deliberately as its own
        request: a separate request is a separate transaction, so the row saying
        why the commit failed is not destroyed by the failure it describes.

        Upserted on `import_job_id` because the database enforces one DLQ row
        per job — a retried task must rewrite its own record rather than fail on
        the unique index and lose the diagnosis entirely.

        This is the engineers' view, never the merchant's: `import_jobs.status`
        is what /imports renders, and the two say different things about a
        duplicate upload on purpose (a DLQ row here, a friendly "already
        imported" there).
        """
        self._request(
            "POST",
            f"/rest/v1/{DLQ_TABLE}?on_conflict=import_job_id",
            json=[record],
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )

    # ── storage ───────────────────────────────────────────────────────────────

    def download_import(self, storage_path: str) -> bytes:
        """Fetch an uploaded file. `storage_path` excludes the bucket name."""
        path = "/".join(quote(seg) for seg in storage_path.split("/"))
        return self._request("GET", f"/storage/v1/object/{IMPORTS_BUCKET}/{path}").content

    def upload_object(self, storage_path: str, data: bytes, content_type: str) -> str:
        """Write an object into the imports bucket, replacing any prior version.

        Used for the error report, which lands in the job's own folder next to
        the upload. Uploads themselves are immutable by policy; this is
        service_role, and `x-upsert` makes a retry idempotent rather than a
        duplicate-key failure.
        """
        path = "/".join(quote(seg) for seg in storage_path.split("/"))
        self._request(
            "POST",
            f"/storage/v1/object/{IMPORTS_BUCKET}/{path}",
            data=data,
            headers={"Content-Type": content_type, "x-upsert": "true"},
        )
        return storage_path


def sha256_hex(data: bytes) -> str:
    """Match the browser-side hash written to import_jobs.file_hash on upload."""
    return hashlib.sha256(data).hexdigest()
