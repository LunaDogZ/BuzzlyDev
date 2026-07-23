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

    # ── storage ───────────────────────────────────────────────────────────────

    def download_import(self, storage_path: str) -> bytes:
        """Fetch an uploaded file. `storage_path` excludes the bucket name."""
        path = "/".join(quote(seg) for seg in storage_path.split("/"))
        return self._request("GET", f"/storage/v1/object/{IMPORTS_BUCKET}/{path}").content


def sha256_hex(data: bytes) -> str:
    """Match the browser-side hash written to import_jobs.file_hash on upload."""
    return hashlib.sha256(data).hexdigest()
