"""The measurements that need no Airflow — parsing, cleaning, storing.

Everything here calls the functions the DAG calls. That is the single rule this
module lives by: a harness that re-implements the thing it measures reports on
code nobody ships. :func:`run_pipeline` below is the same four calls
``parse``/``clean_thai``/``validate`` make, in the same order, and if the DAG's
sequence ever changes this must change with it.

What is measured, and why each one earns its place
--------------------------------------------------
``header_mapping``   Which column is which is the harder half of the problem and
                     the half a positional parser gets silently wrong. Reported
                     by *method* (exact / prefix / fuzzy) so the write-up can
                     separate what the dictionary handles from what needed
                     rescuing — a result of "all exact" would mean the fuzzy
                     pass is untested rather than unnecessary.
``row_recovery``      Rows delivered vs rows in the file, pipeline against
                     baseline. The headline number, and the least interesting
                     one on its own: a parser that keeps every row by reading
                     unparseable cells as zero scores perfectly here.
``field_accuracy``    Which is why this exists. Cell-level, against a key
                     neither implementation produced, split four ways so a
                     fabricated value cannot hide inside "not correct".
``quarantine``        Precision and recall on rejection, plus whether the reason
                     given is the right one. The reason is what the merchant is
                     told to go and fix, so a right rejection for a wrong reason
                     is a defect.
``idempotency``       A re-import must update, not duplicate. Measured by
                     building the target payload twice and comparing derived
                     ids, and once more from reordered input, because the ids
                     are the only thing standing between a retry and a doubled
                     ad spend.
``totals``            The dirty fixture carries its own ``รวมทั้งหมด`` row,
                     which the pipeline drops. That makes it an independent
                     check nobody wrote for this purpose: summing the ingested
                     rows must reproduce it exactly.
``throughput``        Wall time per phase over file size and row count. Median
                     of several passes — a single timing on a laptop measures
                     the laptop.
"""

from __future__ import annotations

import statistics
import time
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable

from buzzly_common.mapping import detect_dataset
from buzzly_common.reader import UnreadableFile, read_table
from buzzly_common.records import build_records
from buzzly_common.targets import (
    build_ad_performance_payload,
    derived_id,
    target_table_for,
)
from buzzly_common.thai import is_summary_row, parse_decimal
from buzzly_common.validate import validate_records
from research import baseline as naive
from research.truth import load_truth, rate, score_rows

# The fixture set, with the report type the merchant would pick on /imports.
# `platform` is only a tiebreak for dataset detection (see `detect_dataset`), so
# a wrong guess here would be corrected by the columns — it is stated anyway
# because measuring the pipeline as it is actually used means declaring what the
# merchant declares.
FIXTURES: tuple[tuple[str, str], ...] = (
    ("meta/ads-export-clean.csv", "meta"),
    ("meta/ads-export-thai-dirty.csv", "meta"),
    ("tiktok/ads-export.csv", "tiktok"),
    ("shopee/ads-report.csv", "shopee_ads"),
    ("shopee/income-report.csv", "shopee_income"),
    ("shopee/products-cogs.csv", "cogs"),
    ("edge-cases/broken-rows.csv", "meta"),
    ("edge-cases/headers-only.csv", "meta"),
    ("edge-cases/empty.csv", "meta"),
)

# The labelled file — the only one with a per-cell answer key.
LABELLED = "meta/ads-export-thai-dirty.csv"
QUARANTINE_LABELLED = "edge-cases/broken-rows.csv"

# Fixed inputs for the idempotency build. Any uuid would do; these are constant
# so a derived id printed in one report can be compared with the next.
MEASURE_TEAM = "00000000-0000-4000-8000-00000000team"
MEASURE_ACCOUNT = "00000000-0000-4000-8000-0000000acct"

THROUGHPUT_REPEATS = 5


def run_pipeline(data: bytes, platform: str) -> dict:
    """The pipeline's own stages, in the DAG's order, without Airflow.

    Mirrors ``parse`` -> ``clean_thai`` -> ``validate`` in
    ``buzzly_import_pipeline``. The upsert stage is exercised separately (see
    :func:`measure_idempotency`) because it needs a Supabase client and this
    must stay runnable with no network.
    """
    table = read_table(data)
    dataset, mapping = detect_dataset(table["headers"], platform)
    mapping["headers"] = table["headers"]
    records = build_records(table["rows"], mapping)
    validated = validate_records(records, dataset)
    return {
        "dataset": dataset,
        "mapping": mapping,
        "table": table,
        "records": records,
        "validated": validated,
    }


# ── per-file ──────────────────────────────────────────────────────────────────


def _mapping_report(mapping: dict, headers: list[str], truth: dict | None) -> dict:
    methods: dict[str, int] = {}
    for method in mapping["match_methods"].values():
        methods[method] = methods.get(method, 0) + 1
    methods["unmatched"] = len(mapping["unmapped"])

    report: dict[str, Any] = {
        "columns_in_file": len(headers),
        "columns_mapped": len(mapping["columns"]),
        "by_method": methods,
        "unmapped": mapping["unmapped"],
        "conflicts": mapping["conflicts"],
        "missing_required": mapping["missing_required"],
    }

    if truth and truth.get("header_fields"):
        expected: dict[str, str] = truth["header_fields"]
        actual = {headers[position]: field for field, position in mapping["columns"].items()}
        correct = [h for h, f in expected.items() if actual.get(h) == f]
        wrong = {h: actual[h] for h, f in expected.items() if h in actual and actual[h] != f}
        report["against_truth"] = {
            "headers_labelled": len(expected),
            "correct": len(correct),
            # A heading mapped to the wrong field is worse than one left
            # unmapped: unmapped loses a column, wrong puts one column's numbers
            # under another column's name.
            "wrong": wrong,
            "missed": [h for h in expected if h not in actual],
            "accuracy": rate(len(correct), len(expected)),
        }
    return report


def _time_phases(data: bytes, platform: str, repeats: int) -> dict:
    """Median wall time per phase, in milliseconds.

    Phases are timed separately because they scale differently — reading is
    bound by file size, typing and validation by row count — and a single total
    would hide which one a large file actually spends its time in.
    """
    samples: dict[str, list[float]] = {"read": [], "map": [], "type": [], "validate": []}

    def clock(name: str, work: Callable[[], Any]) -> Any:
        started = time.perf_counter()
        value = work()
        samples[name].append((time.perf_counter() - started) * 1000)
        return value

    for _ in range(repeats):
        table = clock("read", lambda: read_table(data))
        dataset, mapping = clock("map", lambda: detect_dataset(table["headers"], platform))
        mapping["headers"] = table["headers"]
        records = clock("type", lambda: build_records(table["rows"], mapping))
        clock("validate", lambda: validate_records(records, dataset))

    medians = {name: round(statistics.median(values), 3) for name, values in samples.items()}
    medians["total"] = round(sum(medians.values()), 3)
    return medians


def measure_file(path: Path, name: str, platform: str, truth: dict | None) -> dict:
    """Everything that can be said about one fixture on its own."""
    data = path.read_bytes()
    report: dict[str, Any] = {
        "platform_declared": platform,
        "bytes": len(data),
    }

    try:
        run = run_pipeline(data, platform)
    except UnreadableFile as exc:
        # A refusal is a result, not a gap. The message is measured too: it is
        # what the merchant is shown, and "The file is empty (0 bytes)." is the
        # difference between this pipeline and one that says "import failed".
        report["refused"] = {"reason": str(exc), "actionable": str(exc) != ""}
        report["baseline"] = {"rows_ok": len(naive.naive_parse(data)["ok"])}
        return report

    counts = run["validated"]["counts"]
    table = run["table"]
    report["dataset_detected"] = run["dataset"]
    report["target_table"] = target_table_for(run["dataset"])
    report["header_row"] = table["header_row"]
    report["encoding"] = None
    report["dropped"] = {
        "blank_rows": table["blank_rows"], "summary_rows": table["summary_rows"],
    }
    report["mapping"] = _mapping_report(run["mapping"], table["headers"], truth)
    report["rows"] = {
        "total": counts["rows_total"],
        "ok": counts["rows_ok"],
        "quarantined": counts["rows_quarantined"],
        "recovery": rate(counts["rows_ok"], counts["rows_total"]),
        "by_reason": counts["by_reason"],
    }

    naive_run = naive.naive_parse(data, run["dataset"])
    report["baseline"] = {
        "failure": naive_run["failure"],
        "columns_mapped": len(naive_run["columns"]),
        "rows_total": naive_run["rows_total"],
        "rows_ok": len(naive_run["ok"]),
        "recovery": rate(len(naive_run["ok"]), naive_run["rows_total"]),
    }

    if truth and truth.get("dropped"):
        report["dropped"]["expected"] = truth["dropped"]
        report["dropped"]["correct"] = (
            table["blank_rows"] == truth["dropped"]["blank_rows"]
            and table["summary_rows"] == truth["dropped"]["summary_rows"]
        )

    report["throughput_ms"] = _time_phases(data, platform, THROUGHPUT_REPEATS)
    rows_total = max(counts["rows_total"], 1)
    report["throughput_ms"]["ms_per_1k_rows"] = round(
        report["throughput_ms"]["total"] / rows_total * 1000, 3
    )
    return report


# ── cross-file ────────────────────────────────────────────────────────────────


def measure_accuracy(path: Path, platform: str, truth: dict) -> dict:
    """Cell-level accuracy on the labelled file, pipeline against baseline."""
    data = path.read_bytes()
    run = run_pipeline(data, platform)

    # Every typed row, kept or rejected. Accuracy is a question about reading,
    # not about the ingest decision — a row correctly rejected for one bad cell
    # still had fourteen cells read, and crediting the parser with none of them
    # would conflate two different things the write-up needs to separate.
    pipeline_rows = {record["row_number"]: record["values"] for record in run["records"]}
    naive_run = naive.naive_parse(data, run["dataset"])
    naive_rows = {row["row_number"]: row["values"] for row in naive_run["ok"]}

    return {
        "file": LABELLED,
        "pipeline": score_rows(pipeline_rows, truth["rows"]),
        "baseline": score_rows(naive_rows, truth["rows"]),
    }


def measure_quarantine(path: Path, platform: str, truth: dict) -> dict:
    """Did the right rows get rejected, and were they told the right reason?"""
    run = run_pipeline(path.read_bytes(), platform)
    rejected = {row["row_number"]: row for row in run["validated"]["rejected"]}
    accepted = {record["row_number"] for record in run["validated"]["ok"]}

    matrix = {"true_reject": 0, "false_reject": 0, "true_accept": 0, "false_accept": 0}
    reasons = {"right_reason": 0, "wrong_reason": 0}
    mistakes: list[dict] = []

    for entry in truth["rows"]:
        number = entry["row_number"]
        should_reject = entry["verdict"] == "rejected"
        did_reject = number in rejected

        if should_reject and did_reject:
            matrix["true_reject"] += 1
            codes = {problem["error_code"] for problem in rejected[number]["problems"]}
            if entry["error_code"] in codes:
                reasons["right_reason"] += 1
            else:
                reasons["wrong_reason"] += 1
                mistakes.append({
                    "row_number": number, "expected_code": entry["error_code"],
                    "got_codes": sorted(codes),
                })
        elif should_reject:
            matrix["false_accept"] += 1
            mistakes.append({"row_number": number, "expected": "rejected", "got": "accepted"})
        elif did_reject:
            matrix["false_reject"] += 1
            mistakes.append({
                "row_number": number, "expected": "accepted",
                "got_codes": sorted(p["error_code"] for p in rejected[number]["problems"]),
            })
        elif number in accepted:
            matrix["true_accept"] += 1

    detected = matrix["true_reject"] + matrix["false_reject"]
    actual = matrix["true_reject"] + matrix["false_accept"]

    # The baseline on the same labelled rows. This is the measurement that stops
    # row-recovery being read as a score: the naive parser keeps *more* rows of
    # this file than the pipeline does, and every extra row it keeps is one it
    # should have refused — a negative impression count, a row with more clicks
    # than impressions, an exact duplicate. Higher recovery, wrong numbers.
    naive_run = naive.naive_parse(path.read_bytes(), run["dataset"])
    naive_ok = {row["row_number"] for row in naive_run["ok"]}
    naive_matrix = {"true_reject": 0, "false_reject": 0, "true_accept": 0, "false_accept": 0}
    wrongly_kept: list[dict] = []
    for entry in truth["rows"]:
        should_reject = entry["verdict"] == "rejected"
        did_reject = entry["row_number"] not in naive_ok
        if should_reject and did_reject:
            naive_matrix["true_reject"] += 1
        elif should_reject:
            naive_matrix["false_accept"] += 1
            wrongly_kept.append({"row_number": entry["row_number"], "defect": entry["error_code"]})
        elif did_reject:
            naive_matrix["false_reject"] += 1
        else:
            naive_matrix["true_accept"] += 1

    return {
        "file": QUARANTINE_LABELLED,
        **matrix,
        "precision": rate(matrix["true_reject"], detected),
        "recall": rate(matrix["true_reject"], actual),
        **reasons,
        "reason_accuracy": rate(reasons["right_reason"], matrix["true_reject"]),
        "mistakes": mistakes,
        "baseline": {
            **naive_matrix,
            "rows_kept": len(naive_ok),
            "precision": rate(
                naive_matrix["true_reject"],
                naive_matrix["true_reject"] + naive_matrix["false_reject"],
            ),
            "recall": rate(
                naive_matrix["true_reject"],
                naive_matrix["true_reject"] + naive_matrix["false_accept"],
            ),
            # No reason codes at all — it drops a row when a cell will not parse
            # and cannot say which cell or why.
            "reason_accuracy": 0.0,
            "defects_ingested": wrongly_kept,
        },
    }


def _insight_keys(payload: dict) -> dict[tuple, dict]:
    return {(row["ads_id"], row["date"]): row for row in payload["insights"]}


def measure_idempotency(path: Path, platform: str) -> dict:
    """Would a second import of this file update rows, or create new ones?

    Three properties, each of which has to hold on its own:

    * **Stable** — the same file built twice yields the same derived ids. If it
      did not, every re-import would insert a parallel set of campaigns and ads.
    * **Order-independent** — the same rows in a different order yield the same
      ids. Row order is not a property of the data, and a pipeline that keyed
      off it would produce different ids from a file the merchant re-sorted.
    * **Collision-free** — no two rows in one payload share an
      ``(ads_id, date)`` key. PostgREST compiles a batch into one statement, so
      a repeated conflict target does not duplicate a row, it fails the whole
      file.
    """
    run = run_pipeline(path.read_bytes(), platform)
    from buzzly_common.records import rehydrate_records

    ok = rehydrate_records(run["validated"]["ok"])
    if not ok or target_table_for(run["dataset"]) is None:
        return {"applicable": False, "reason": f"no target table for {run['dataset']}"}

    kwargs = dict(team_id=MEASURE_TEAM, platform=platform, ad_account_id=MEASURE_ACCOUNT)
    first = build_ad_performance_payload(ok, **kwargs)
    again = build_ad_performance_payload(ok, **kwargs)
    reordered = build_ad_performance_payload(list(reversed(ok)), **kwargs)

    keys_first, keys_again = _insight_keys(first), _insight_keys(again)
    keys_reordered = _insight_keys(reordered)

    def ids(payload: dict, table: str) -> set:
        return {row["id"] for row in payload[table]}

    return {
        "applicable": True,
        "campaigns": len(first["campaigns"]),
        "ads": len(first["ads"]),
        "insights": len(first["insights"]),
        "stable_ids": all(
            ids(first, table) == ids(again, table) for table in ("campaigns", "ads", "ad_groups")
        ),
        "stable_rows": keys_first == keys_again,
        "order_independent_ids": all(
            ids(first, table) == ids(reordered, table)
            for table in ("campaigns", "ads", "ad_groups")
        ),
        "order_independent_rows": keys_first == keys_reordered,
        # One row per (ad, day) or the upsert statement fails outright.
        "duplicate_keys": len(first["insights"]) - len(keys_first),
        "sample_campaign_id": derived_id(
            "campaign", MEASURE_TEAM, platform,
            first["campaigns"][0]["name"] if first["campaigns"] else "",
        ),
    }


def measure_totals(path: Path, platform: str) -> dict:
    """Reconcile the ingested rows against the file's own summary row.

    The ``รวมทั้งหมด`` row is dropped before ingestion, so it never touches the
    numbers it is being compared with. That makes it a free independent check on
    the whole read path — encoding, header mapping, Buddhist-era dates and
    currency parsing all have to be right for the sums to land, and there is no
    way to pass it by being consistently wrong.
    """
    data = path.read_bytes()
    run = run_pipeline(data, platform)
    table = read_table(data)

    # Re-read the raw rows to recover the summary the pipeline discarded.
    import csv
    import io

    from buzzly_common.reader import detect_encoding

    _, text = detect_encoding(data)
    raw = list(csv.reader(io.StringIO(text, newline="")))
    summary = next((row for row in raw if is_summary_row(row)), None)
    if summary is None:
        return {"applicable": False, "reason": "this file states no totals"}

    columns = run["mapping"]["columns"]
    stated: dict[str, Decimal] = {}
    for field, position in columns.items():
        if position < len(summary):
            value = parse_decimal(summary[position])
            if value is not None:
                stated[field] = value

    ingested: dict[str, Decimal] = {}
    for record in run["validated"]["ok"]:
        for field in stated:
            value = record["values"].get(field)
            if value is not None:
                ingested[field] = ingested.get(field, Decimal(0)) + Decimal(value)

    # A money column will not reconcile to the last satang, and that is a
    # property of the file rather than of the reader. Each row states its spend
    # rounded to two decimals, while the totals row was computed before any
    # rounding — so the honest comparison is `sum(round(x)) vs round(sum(x))`,
    # which can differ by up to half a satang per row. Real exports have exactly
    # this shape: Excel totals a column at full precision and displays two
    # decimals. Reporting a bare "mismatch" here would invite someone to "fix"
    # the reader until it reproduced a number the rows do not contain.
    rows = len(table["rows"])
    tolerance = Decimal("0.01") * rows

    comparison = {}
    for field, total in stated.items():
        got = ingested.get(field, Decimal(0))
        delta = got - total
        comparison[field] = {
            "stated": str(total),
            "ingested": str(got),
            "delta": str(delta),
            "exact": got == total,
            "within_row_rounding": abs(delta) <= tolerance,
        }

    return {
        "applicable": True,
        "file_rows": rows,
        "rounding_tolerance": str(tolerance),
        "fields": comparison,
        "all_exact": all(entry["exact"] for entry in comparison.values()),
        "all_reconciled": all(entry["within_row_rounding"] for entry in comparison.values()),
    }


# ── the suite ─────────────────────────────────────────────────────────────────


def measure_all(root: Path | None = None) -> dict:
    """Every offline measurement, in the shape the report renderer expects."""
    from research.truth import fixtures_root

    root = root or fixtures_root()
    truth = load_truth(root)
    labelled = truth["files"]

    files: dict[str, Any] = {}
    for name, platform in FIXTURES:
        path = root / name
        if not path.is_file():
            files[name] = {"error": "missing"}
            continue
        files[name] = measure_file(path, name, platform, labelled.get(name))

    return {
        "fixture_window": truth["window"],
        "fixture_seed": truth["seed"],
        "files": files,
        "accuracy": measure_accuracy(root / LABELLED, "meta", labelled[LABELLED]),
        "quarantine": measure_quarantine(
            root / QUARANTINE_LABELLED, "meta", labelled[QUARANTINE_LABELLED]
        ),
        "idempotency": {
            name: measure_idempotency(root / name, platform)
            for name, platform in FIXTURES[:4]
        },
        "totals": measure_totals(root / LABELLED, "meta"),
    }
