"""Run the measurement harness and write both the record and the reading of it.

    cd airflow
    python3 -m research.run                # fixtures + the live Airflow history
    python3 -m research.run --offline-only # fixtures only, no Airflow needed

Two outputs, deliberately: ``results.json`` is the record — every number,
including the ones no table quotes — and ``report.md`` is the reading of it.
A report with no machine-readable counterpart cannot be diffed between runs,
and a JSON blob with no report will not be read.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import sys
from decimal import Decimal
from pathlib import Path

# The DAG modules live in `dags/`, which Airflow puts on sys.path at parse time
# but a plain interpreter does not.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dags"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from research import report as report_renderer  # noqa: E402
from research.measure import LABELLED, measure_all  # noqa: E402
from research.orchestration import measure_orchestration  # noqa: E402

DEFAULT_OUT = Path(__file__).resolve().parent / "results"


def _commit() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=5, check=True,
        ).stdout.strip()
    except (subprocess.SubprocessError, OSError):
        return "unknown"


def _jsonable(value):
    """Decimals to strings, never floats — see `records.jsonable` for why."""
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (dt.date, dt.datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if isinstance(value, set):
        return sorted(str(item) for item in value)
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline-only", action="store_true",
                        help="skip the Airflow history measurements")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT,
                        help=f"output directory (default: {DEFAULT_OUT})")
    parser.add_argument("--runs", type=int, default=100,
                        help="how many DagRuns of history to read (default: 100)")
    args = parser.parse_args(argv)

    print("Measuring the fixtures…")
    offline = measure_all()

    if args.offline_only:
        live = {"available": False, "reason": "--offline-only", "hint": "drop the flag"}
    else:
        print("Reading the Airflow run history…")
        # The compute-stage comparison needs the in-process timings for the same
        # file the DAG has been running, so they come from the labelled fixture.
        phases = offline["files"][LABELLED]["throughput_ms"]
        live = measure_orchestration(phases, limit=args.runs)
        if not live["available"]:
            print(f"  ! Airflow not reachable: {live['reason']}")

    results = {
        "meta": {
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "commit": _commit(),
        },
        "offline": offline,
        "orchestration": live,
    }

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "results.json").write_text(
        json.dumps(_jsonable(results), indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (args.out / "report.md").write_text(
        report_renderer.render(results), encoding="utf-8"
    )

    accuracy = offline["accuracy"]
    quarantine = offline["quarantine"]
    print()
    print(f"  reading accuracy   pipeline {accuracy['pipeline']['value_accuracy']:.1%}"
          f"   baseline {accuracy['baseline']['value_accuracy']:.1%}"
          f"   ({accuracy['pipeline']['cells']} cells)")
    print(f"  quarantine         precision {quarantine['precision']:.0%}"
          f"  recall {quarantine['recall']:.0%}"
          f"  right reason {quarantine['reason_accuracy']:.0%}")
    if live.get("available") and live["dag_vs_inprocess"].get("comparable"):
        print(f"  orchestration      {live['pipeline']['runs']} runs, "
              f"{live['dag_vs_inprocess']['overhead_per_task_ms']} ms per task boundary")
    print()
    print(f"  → {args.out / 'results.json'}")
    print(f"  → {args.out / 'report.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
