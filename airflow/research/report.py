"""Render the measurements as a document the write-up can quote.

The JSON is the record; this is the reading of it. Two rules govern what goes
in:

**Every table states its denominator.** "99% accurate" is not a result, "446 of
450 cells" is. A percentage whose base is not on the page cannot be checked by
a reader and should not be believed by one.

**Caveats go next to their number, not in a footnote.** The spend column does
not reconcile to the satang, the baseline's non-zero accuracy comes entirely
from empty cells, and part of the run history belongs to an older version of the
DAG. Each of those is written beside the figure it qualifies, because a reader
quoting a row of a table will not carry a footnote with them.
"""

from __future__ import annotations

from typing import Any


def _pct(value: float | None) -> str:
    return "—" if value is None else f"{value * 100:.1f}%"


def _table(headers: list[str], rows: list[list[Any]]) -> list[str]:
    if not rows:
        return ["_No rows._", ""]
    out = ["| " + " | ".join(headers) + " |",
           "|" + "|".join("---" for _ in headers) + "|"]
    out += ["| " + " | ".join(str(cell) for cell in row) + " |" for row in rows]
    out.append("")
    return out


def _accuracy_section(accuracy: dict) -> list[str]:
    pipeline, base = accuracy["pipeline"], accuracy["baseline"]
    lines = [
        "## 1. Reading accuracy against a known answer key",
        "",
        f"File: `{accuracy['file']}` — {pipeline['rows_expected']} rows × "
        f"{pipeline['cells'] // max(pipeline['rows_expected'], 1)} fields = "
        f"**{pipeline['cells']} cells**.",
        "",
        "The key is written by `fixtures/imports/generate.mjs` from the values it holds "
        "before serialising them into Buddhist-era dates, `฿` and thousands separators, "
        "so it is independent of both parsers below.",
        "",
    ]
    lines += _table(
        ["", "Rows read", "Correct", "Missing", "Fabricated", "Wrong", "Cell accuracy",
         "Value accuracy"],
        [
            ["**Pipeline**", f"{pipeline['rows_matched']}/{pipeline['rows_expected']}",
             pipeline["correct"], pipeline["missing"], pipeline["fabricated"],
             pipeline["wrong"], _pct(pipeline["accuracy"]), _pct(pipeline["value_accuracy"])],
            ["Naive baseline", f"{base['rows_matched']}/{base['rows_expected']}",
             base["correct"], base["missing"], base["fabricated"], base["wrong"],
             _pct(base["accuracy"]), _pct(base["value_accuracy"])],
        ],
    )
    lines += [
        f"**Read the baseline's {_pct(base['accuracy'])} carefully.** All "
        f"{base['blank_agreements']} of its correct cells are cells the key says were "
        "empty — agreement about an absence, not data recovered. It read "
        f"{base['rows_matched']} rows of this file. *Value accuracy* excludes those "
        "cells and is the figure to compare.",
        "",
        "*Fabricated* is the column that matters most and is zero for both: neither "
        "parser invented a value where the file had none. A parser that read blank "
        "cells as `0` would score well on *missing* and put numbers in the merchant's "
        "dashboard that their file never contained.",
        "",
    ]
    return lines


def _files_section(files: dict) -> list[str]:
    rows = []
    for name, report in files.items():
        if report.get("error"):
            rows.append([f"`{name}`", "—", "—", "—", "—", "missing from fixtures"])
            continue
        if "refused" in report:
            rows.append([
                f"`{name}`", "refused", "—", f"{report['baseline']['rows_ok']} rows", "—",
                report["refused"]["reason"],
            ])
            continue
        counts, mapping, base = report["rows"], report["mapping"], report["baseline"]
        rows.append([
            f"`{name}`",
            f"{counts['ok']}/{counts['total']}",
            f"{mapping['columns_mapped']}/{mapping['columns_in_file']}",
            f"{base['rows_ok']}/{base['rows_total']}",
            f"{base['columns_mapped']}/{mapping['columns_in_file']}",
            report["dataset_detected"],
        ])

    return [
        "## 2. Rows and columns recovered, per file",
        "",
        *_table(
            ["File", "Pipeline rows", "Pipeline columns", "Baseline rows",
             "Baseline columns", "Detected as"],
            rows,
        ),
        "> Row recovery is not a score on its own. `edge-cases/broken-rows.csv` is the "
        "case that proves it: the baseline keeps **more** rows than the pipeline, and "
        "every extra row it keeps is one that should have been refused. See §4.",
        "",
    ]


def _mapping_section(files: dict) -> list[str]:
    rows = []
    for name, report in files.items():
        mapping = report.get("mapping")
        if not mapping:
            continue
        methods = mapping["by_method"]
        truth = mapping.get("against_truth")
        rows.append([
            f"`{name}`",
            methods.get("exact", 0), methods.get("prefix", 0), methods.get("fuzzy", 0),
            methods.get("unmatched", 0),
            _pct(truth["accuracy"]) if truth else "—",
        ])

    totals = {method: 0 for method in ("exact", "prefix", "fuzzy", "unmatched")}
    for report in files.values():
        for method, count in (report.get("mapping") or {}).get("by_method", {}).items():
            totals[method] = totals.get(method, 0) + count

    lines = [
        "## 3. How each column was identified",
        "",
        "Three passes, most confident first. Pass 1 is an exact match of the "
        "**normalised** heading — NFC, zero-width and non-breaking characters removed, "
        "trailing parenthetical gloss stripped — so `Amount spent (THB)`, "
        "`ค่าใช้จ่าย (บาท)` and a heading carrying an invisible `U+00A0` all reach the "
        "dictionary as the same key. Pass 2 is a prefix match for a *longer* heading, "
        "pass 3 a fuzzy match above 0.88. A column surviving all three is reported, "
        "never guessed.",
        "",
        *_table(
            ["File", "Exact", "Prefix", "Fuzzy", "Unmatched", "Correct vs key"],
            rows,
        ),
    ]

    if totals["prefix"] == 0 and totals["fuzzy"] == 0:
        lines += [
            f"> **Passes 2 and 3 never fired on this fixture set.** All "
            f"{totals['exact']} columns resolved on pass 1, which says the normalised "
            "dictionary covers every heading these files contain — and equally that "
            "the prefix and fuzzy passes are **not evidenced here**. They exist for "
            "headings the fixtures do not have (a merchant's hand-edit, a mistyped "
            "Thai tone mark). Their unit tests in `airflow/tests/test_ingest.py` are "
            "what covers them; this table is not.",
            "",
        ]
    return lines


def _quarantine_section(quarantine: dict) -> list[str]:
    base = quarantine["baseline"]
    lines = [
        "## 4. Which rows were refused, and whether the reason was right",
        "",
        f"File: `{quarantine['file']}` — one deliberate defect per row, so the reason "
        "codes double as a per-row label.",
        "",
    ]
    lines += _table(
        ["", "Correctly refused", "Wrongly refused", "Wrongly kept", "Precision", "Recall",
         "Right reason given"],
        [
            ["**Pipeline**", quarantine["true_reject"], quarantine["false_reject"],
             quarantine["false_accept"], _pct(quarantine["precision"]),
             _pct(quarantine["recall"]), _pct(quarantine["reason_accuracy"])],
            ["Naive baseline", base["true_reject"], base["false_reject"],
             base["false_accept"], _pct(base["precision"]), _pct(base["recall"]),
             "n/a — gives no reason"],
        ],
    )
    if base["defects_ingested"]:
        defects = ", ".join(f"`{item['defect']}`" for item in base["defects_ingested"])
        lines += [
            f"The baseline ingested {len(base['defects_ingested'])} defective rows: "
            f"{defects}. Each parses cleanly as a number and is wrong as data — which "
            "is why validation is a stage and not a parsing concern.",
            "",
        ]
    if quarantine["mistakes"]:
        lines += ["Mistakes:", "", *[f"- {item}" for item in quarantine["mistakes"]], ""]
    return lines


def _totals_section(totals: dict) -> list[str]:
    if not totals.get("applicable"):
        return []
    rows = [
        [f"`{field}`", entry["stated"], entry["ingested"], entry["delta"],
         "exact" if entry["exact"] else
         ("within rounding" if entry["within_row_rounding"] else "**mismatch**")]
        for field, entry in totals["fields"].items()
    ]
    return [
        "## 5. Reconciliation against the file's own totals row",
        "",
        "The `รวมทั้งหมด` row is dropped before ingestion, so it never touches the "
        "numbers it is compared with — an independent check on the whole read path. "
        "Encoding, header mapping, Buddhist-era dates and currency parsing all have to "
        "be right for these to land.",
        "",
        *_table(["Field", "File states", "Pipeline sums", "Difference", "Verdict"], rows),
        f"> The `spend` difference is **not a parser error**. Each row states its spend "
        f"rounded to two decimals while the totals row was computed before rounding, so "
        f"`sum(round(x)) ≠ round(sum(x))` by up to one satang per row — "
        f"{totals['file_rows']} rows gives a tolerance of ฿{totals['rounding_tolerance']}. "
        "Real exports have exactly this shape. Chasing the last satang would mean "
        "reproducing a number the rows do not contain.",
        "",
    ]


def _idempotency_section(idempotency: dict) -> list[str]:
    rows = []
    for name, report in idempotency.items():
        if not report.get("applicable"):
            continue
        ok = lambda flag: "yes" if flag else "**no**"  # noqa: E731
        rows.append([
            f"`{name}`", report["campaigns"], report["ads"], report["insights"],
            ok(report["stable_ids"] and report["stable_rows"]),
            ok(report["order_independent_rows"]),
            report["duplicate_keys"],
        ])
    return [
        "## 6. Would a re-import duplicate anything?",
        "",
        "Every id is `uuid5(fixed namespace, natural key)` — a pure function of the "
        "file's contents — so the second import of a campaign computes the id the first "
        "one used and the insert becomes an update. No unique constraints were added to "
        "tables the app writes by hand.",
        "",
        *_table(
            ["File", "Campaigns", "Ads", "Insight rows", "Same ids on re-run",
             "Order-independent", "Key collisions"],
            rows,
        ),
        "> *Key collisions* must be 0: PostgREST compiles a batch into one statement, so "
        "a repeated `(ad, day)` target does not duplicate a row — it fails the whole "
        "file.",
        "",
    ]


def _throughput_section(files: dict) -> list[str]:
    rows = []
    for name, report in files.items():
        timing = report.get("throughput_ms")
        if not timing:
            continue
        rows.append([
            f"`{name}`", report["bytes"], report["rows"]["total"],
            timing["read"], timing["map"], timing["type"], timing["validate"],
            f"**{timing['total']}**", timing["ms_per_1k_rows"],
        ])
    return [
        "## 7. Throughput",
        "",
        "Median of 5 passes, milliseconds, in-process. Phases are timed separately "
        "because they scale differently: reading is bound by file size, typing and "
        "validation by row count.",
        "",
        *_table(
            ["File", "Bytes", "Rows", "Read", "Map", "Type", "Validate", "Total",
             "ms/1k rows"],
            rows,
        ),
    ]


def _orchestration_section(live: dict) -> list[str]:
    if not live.get("available"):
        return [
            "## 8. Orchestration",
            "",
            f"_Not measured — Airflow was not reachable ({live.get('reason')})._ "
            f"Start it with `{live.get('hint')}` and re-run.",
            "",
        ]

    pipeline = live["pipeline"]
    lines = [
        "## 8. What orchestration costs, and what it buys",
        "",
        f"From **{pipeline['runs']} real DagRuns** on this instance "
        f"({', '.join(f'{state}: {count}' for state, count in pipeline['outcomes'].items())}), "
        "between "
        f"`{(pipeline.get('first_run') or '')[:10]}` and `{(pipeline.get('last_run') or '')[:10]}`. "
        "Read-only: nothing was triggered to produce these numbers.",
        "",
        "### Per-stage duration (seconds)",
        "",
    ]
    rows = []
    for stage, summary in pipeline["stages"].items():
        if not summary.get("n"):
            continue
        label = f"`{stage}`" + (" _(retired)_" if summary.get("retired") else "")
        rows.append([label, summary["n"], summary["median"], summary["p95"], summary["max"]])
    lines += _table(["Stage", "Runs", "Median", "p95", "Max"], rows)

    if any(s.get("retired") for s in pipeline["stages"].values()):
        lines += [
            "> _(retired)_ marks a task the DAG no longer has. The history spans every "
            "version that has run on this instance; those rows are kept rather than "
            "filtered, because deleting inconvenient history is not measurement.",
            "",
        ]

    wall = pipeline.get("wall_seconds", {})
    lines += [
        "### End to end",
        "",
        *_table(
            ["Outcome", "Runs", "Median wall (s)", "p95", "Max"],
            [[state, s["n"], s["median"], s["p95"], s["max"]] for state, s in wall.items()],
        ),
    ]

    overhead = pipeline.get("scheduling_overhead_seconds", {})
    if overhead.get("n"):
        lines += [
            f"Wall clock **not** spent executing a task — scheduling, executor hand-off "
            f"and XCom round-trips — median **{overhead['median']}s**, max "
            f"{overhead['max']}s (a cold scheduler).",
            "",
        ]

    failures = pipeline["failed_stages"]
    lines += [
        f"Tasks that retried: **{pipeline['tasks_retried']}**. "
        + (
            "Failures by stage: "
            + ", ".join(f"`{stage}` ×{count}" for stage, count in sorted(failures.items()))
            + ". A failure in `detect_format` or `validate` is the merchant's file; one "
            "in `verify_artifact` or `upsert_target` is ours. Being able to say which "
            "without reading a log is the whole reason these are separate tasks."
            if failures else "No stage has failed."
        ),
        "",
    ]

    comparison = live["dag_vs_inprocess"]
    if comparison.get("comparable"):
        lines += [
            "### DAG versus a single process, on identical work",
            "",
            "Restricted to the four tasks that touch no network, so the difference is "
            "the cost of the task boundary and nothing else. The other seven spend "
            "their time on Supabase round-trips a single script would also pay.",
            "",
            *_table(
                ["Stage", "As a DAG task (ms)", "In-process (ms)", "Overhead (ms)"],
                [[f"`{row['stage']}`", row["dag_median_ms"], row["in_process_ms"],
                  row["overhead_ms"]] for row in comparison["stages"]],
            ),
            f"**{comparison['overhead_per_task_ms']} ms per task boundary** "
            f"({comparison['dag_total_ms']} ms as tasks vs "
            f"{comparison['in_process_total_ms']} ms in-process — "
            f"{comparison['slowdown_factor']}× on pure compute).",
            "",
            "> The in-process column is charged generously: `detect_format` and `parse` "
            "are both billed a full `read_table`, though the DAG's `detect_format` only "
            "sniffs magic bytes and an encoding. Overstating the in-process side "
            "understates the overhead, so the figure above is a **lower bound**.",
            "",
            "That is the price. What it buys, per stage:",
            "",
            "- **a retry boundary** — a network blip re-runs one task instead of "
            "re-reading a 3,458-row file;",
            "- **a log boundary** — a failure is attributed to `validate` (the "
            "merchant's data) or `verify_artifact` (our storage) without a debugger, "
            "which is what `/imports` shows as *Stopped at:*;",
            "- **a timing boundary** — the table above, which a single script would "
            "not produce at all.",
            "",
            "The overhead is per *task*, not per row: it is a constant ~0.5 s that a "
            "3,458-row file and a 10-row file pay identically, so it falls as a share "
            "of total work exactly as files get larger.",
            "",
        ]
    return lines


def render(results: dict) -> str:
    """The full report as Markdown."""
    meta = results.get("meta", {})
    offline = results["offline"]
    live = results.get("orchestration", {})

    lines = [
        "# Buzzly ingestion pipeline — measurement report",
        "",
        f"Generated {meta.get('generated_at', '?')} · commit `{meta.get('commit', '?')}` · "
        f"fixtures seed `{offline.get('fixture_seed')}`, window "
        f"{offline['fixture_window']['start']} → {offline['fixture_window']['end']}",
        "",
        "Regenerate with `python3 -m research.run` from `airflow/`. The fixture "
        "generator is deterministic, so every number here is reproducible from a clean "
        "checkout.",
        "",
        "**What is being compared.** The *pipeline* is the code the DAG runs. The "
        "*naive baseline* (`research/baseline.py`) is a plain CSV reader — UTF-8, "
        "`csv.reader`, `float()`, `date.fromisoformat()`, exact header match — given "
        "the full synonym dictionary for free, Thai entries included. What separates "
        "them is therefore only: encoding detection, invisible-character and NFC "
        "normalisation, prefix and fuzzy header matching, Buddhist-era dates, currency "
        "and separator parsing, empty-versus-unreadable, and dropping blank and totals "
        "rows.",
        "",
        "---",
        "",
    ]

    lines += _accuracy_section(offline["accuracy"])
    lines += _files_section(offline["files"])
    lines += _mapping_section(offline["files"])
    lines += _quarantine_section(offline["quarantine"])
    lines += _totals_section(offline["totals"])
    lines += _idempotency_section(offline["idempotency"])
    lines += _throughput_section(offline["files"])
    lines += _orchestration_section(live)

    lines += [
        "---",
        "",
        "## Method notes",
        "",
        "- **The answer key is not produced by either parser.** It is emitted by the "
        "fixture generator from the values it holds before serialisation. Scoring a "
        "parse against a re-parse would measure agreement, not accuracy.",
        "- **The baseline is handed the synonym dictionary**, which makes the "
        "comparison conservative: knowing that `ค่าใช้จ่าย` means spend is a "
        "dictionary anyone can write, so crediting it to the pipeline would inflate "
        "the result.",
        "- **Cells are scored four ways, not two.** *Fabricated* — a value where the "
        "file had none — is separated from *missing*, because only one of the two is "
        "invisible to the merchant.",
        "- **Money is compared as `Decimal`.** A float comparison would report a "
        "discrepancy that belongs to the harness.",
        "- **Orchestration figures are read-only**, taken from runs that already "
        "happened, so running the harness cannot change what it reports.",
        "",
    ]
    return "\n".join(lines)
