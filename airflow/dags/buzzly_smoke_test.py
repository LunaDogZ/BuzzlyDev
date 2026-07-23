"""Smoke test for the Buzzly Airflow stack.

Not part of the ingestion pipeline. It exists so that after a `docker compose up`
you can prove in one DAG run that the scheduler picks up tasks, the executor runs
them, XCom passes values between tasks, and the merchant-upload fixtures are
actually visible inside the containers — which is the mount the real import DAG
will depend on.

Trigger it from the UI (http://localhost:8081) or:
    docker compose --profile debug run --rm airflow-cli \\
        airflow dags test buzzly_smoke_test
"""

from __future__ import annotations

from pathlib import Path

from airflow.sdk import dag, task

FIXTURES_DIR = Path("/opt/airflow/fixtures/imports")


@dag(
    dag_id="buzzly_smoke_test",
    schedule=None,
    catchup=False,
    tags=["buzzly", "smoke"],
    doc_md=__doc__,
)
def buzzly_smoke_test():
    @task
    def list_fixture_files() -> list[str]:
        """Confirm the fixtures mount is present and readable from a worker."""
        if not FIXTURES_DIR.is_dir():
            raise FileNotFoundError(
                f"{FIXTURES_DIR} is not mounted — check the fixtures volume in docker-compose.yaml"
            )
        files = sorted(str(p.relative_to(FIXTURES_DIR)) for p in FIXTURES_DIR.rglob("*.csv"))
        if not files:
            raise FileNotFoundError(f"No .csv fixtures under {FIXTURES_DIR}")
        return files

    @task
    def report(files: list[str]) -> str:
        for name in files:
            print(f"  found: {name}")
        summary = f"Airflow stack OK — {len(files)} fixture files reachable"
        print(summary)
        return summary

    report(list_fixture_files())


buzzly_smoke_test()
