"""KPI-1 reconciliation: pipeline output vs a Meta Ads Manager CSV export.

Pure functions only — no network, no database, no Meta token. `verify_reconcile`
supplies both sides and writes the artifacts; everything here can be exercised
against a fixture path, which is what lets the harness be finished and tested
before the real export exists.

Three deliberate design commitments, each of which the tests pin:

**The ground truth is a CSV a human exported from Ads Manager, not the API.**
Comparing the API against the API would be circular: the same service, the same
attribution, the same rounding, so a mapping bug would agree with itself. The
export goes through Meta's own reporting and rendering layer instead.

**This module imports nothing from `airflow/dags/buzzly_common/`.** The number
parsing and Thai-header handling below duplicate ideas that `thai.py` and
`mapping.py` already implement, and that duplication is on purpose. Those
modules are the *measured artifact* of the file-import leg; sharing them here
would tie the two legs' results together, so neither could be trusted on its
own. Same reasoning as `ground-truth.json` being produced by no parser.

**Coverage gates the metrics.** An error percentage computed only over rows
present on both sides is a check that cannot fail: a connector that ingested one
row in ten would score 0.00%. Rows on one side only are a hard failure before
any arithmetic happens (CLAUDE.md §12).
"""

from __future__ import annotations

import csv
import datetime as dt
import hashlib
import io
import re
import unicodedata
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path

# Money and metrics are Decimal throughout — never float (CLAUDE.md §10). The
# claim being measured is that these figures reconcile; running "15.90" through
# a binary double and back is how a 0.0000% result turns into 0.0001%.

TOLERANCE_PCT = Decimal("0.5")
"""The thesis target for aggregate error on tier A.

It exists to absorb two legitimate causes of drift — the precision the export
displays, and Meta restating a day between the export and the sync — and
nothing else. It is NOT the gate: delivery metrics have no honest reason to
differ at all, so the gate is cell-level equality and this is reported beside it.
"""


class ExportFormatError(Exception):
    """The export cannot be read as an ad × day table, with the reason stated.

    Never a silent skip. A reconciliation run that quietly read four of eight
    columns would report a number about the wrong thing.
    """


# ── The row shape both sides are reduced to ──────────────────────────────────


@dataclass(frozen=True)
class ReconcileRow:
    ad_id: str
    date: str  # ISO, YYYY-MM-DD
    impressions: int
    clicks: int
    spend: Decimal
    conversions: int | None = None

    @property
    def key(self) -> tuple[str, str]:
        return (self.ad_id, self.date)


@dataclass(frozen=True)
class SkippedRow:
    reason: str
    raw: str


@dataclass
class ExportTable:
    path: Path
    rows: list[ReconcileRow]
    skipped: list[SkippedRow]
    sha256: str
    header_language: str
    headers: dict[str, str]

    @property
    def window(self) -> tuple[str, str]:
        dates = sorted(row.date for row in self.rows)
        return (dates[0], dates[-1]) if dates else ("", "")


# ── Header aliases ───────────────────────────────────────────────────────────
#
# Ads Manager exports in the language of the UI that produced them, so the same
# report arrives with Thai or English headings. Matching is by declared alias,
# never by column position: a positional reader silently reads the wrong column
# the first time Meta adds one.

# The Thai aliases marked **measured** were read off real Ads Manager exports the
# founder produced on 2026-08-12 and 2026-08-13. The ones this file originally
# shipped were reasonable translations and **every single one was wrong**: Meta
# heads the ad id `ID โฆษณา` (not `รหัสโฆษณา`), impressions `อิมเพรสชัน` — a
# transliteration, not `การแสดงผล` — spend `จำนวนเงินที่ใช้จ่ายไป (THB)` with a
# `ไป` the guess lacked, and clicks **`จำนวนคลิก (ทั้งหมด)`**, which the second
# export corrected again after `การคลิก (ทั้งหมด)` had itself been a guess. A
# hand-written Thai fixture agreed with the guesses, so the suite was green
# against a locale Meta does not emit. Only a real export could find any of it,
# which is why `export-th-ads-manager.csv` carries the measured headings and the
# invented ones are kept as tolerated extras rather than deleted.
#
# Rule this earned: **do not add a Thai alias by translating one.** Add it when
# an export has been seen carrying it, and say which export in the comment.
CANONICAL_HEADERS: dict[str, tuple[str, ...]] = {
    "ad_id": ("ad id", "adid", "id โฆษณา", "รหัสโฆษณา", "ไอดีโฆษณา"),
    # The explicit per-day column. Preferred whenever it exists, because it is
    # the one the Day breakdown produces and the one that means "this day".
    "date": ("day", "date", "วัน", "วันที่"),
    "impressions": ("impressions", "impr.", "อิมเพรสชัน", "การแสดงผล", "การมองเห็น"),
    "clicks": (
        "clicks (all)", "clicks(all)", "clicks",
        "จำนวนคลิก (ทั้งหมด)", "จำนวนคลิก(ทั้งหมด)",
        "การคลิก (ทั้งหมด)", "การคลิกทั้งหมด",
        "คลิก (ทั้งหมด)", "คลิก(ทั้งหมด)",
    ),
    "spend": (
        "amount spent (thb)", "amount spent", "spend",
        "จำนวนเงินที่ใช้จ่ายไป (thb)", "จำนวนเงินที่ใช้จ่ายไป",
        "จำนวนเงินที่ใช้จ่าย (thb)", "จำนวนเงินที่ใช้จ่าย", "ยอดใช้จ่าย",
    ),
    "conversions": (
        "results", "purchases", "website purchases",
        "ผลลัพธ์", "การซื้อ",
    ),
    # The reporting window columns. **Both real exports carried these alongside
    # `วัน`**, so they cannot simply be more aliases for `date` — that made the
    # reader refuse a genuine daily export as "more than one column could be
    # 'date'". They are their own fields, used two ways:
    #
    #   * `date_start` is the *fallback* when no explicit day column exists, and
    #     a cross-check against `date` when one does;
    #   * `date_end` proves the row is one day rather than a range. With the Day
    #     breakdown ON, Meta sets start and end to the same day on every row.
    #     With it OFF, they span the whole range and the row's numbers are a
    #     total — a grain the duplicate-key check cannot see, because each ad
    #     still appears exactly once.
    #
    # `สิ้นสุด` (the ad's own end date) is deliberately NOT an alias here: in the
    # 2026-08-13 export it read 2026-08-13 while reporting ended 08-12, so
    # matching it would refuse a perfectly good daily export.
    "date_start": ("reporting starts", "เริ่มการรายงาน", "วันที่เริ่มต้นการรายงาน"),
    "date_end": ("reporting ends", "สิ้นสุดการรายงาน", "วันที่สิ้นสุดการรายงาน"),
}

REQUIRED_FIELDS = ("ad_id", "date", "impressions", "clicks", "spend")

# Columns that look like the one we want but measure something else. Named so
# the refusal can say what to change rather than "column not found".
CONFUSABLE_HEADERS: dict[str, tuple[tuple[str, ...], str]] = {
    "clicks": (
        ("link clicks", "unique link clicks", "การคลิกลิงก์", "คลิกลิงก์"),
        "The connector stores ALL clicks, by the approved field mapping, so that "
        "it agrees with the CTR and CPC Meta computes. Re-export with the "
        "'Clicks (all)' column: reconciling against 'Link clicks' would compare "
        "two different metrics and report the difference as a pipeline defect.",
    ),
}

THAI_HEADER_HINTS = ("รหัส", "วัน", "การแสดงผล", "คลิก", "จำนวนเงิน")


def _normalise_header(value: str) -> str:
    """Fold a heading to its comparable form.

    NFKC first: Thai text from a spreadsheet can carry compatibility forms that
    compare unequal to the same word typed here, and a header that fails to
    match is indistinguishable from a missing column.
    """
    text = unicodedata.normalize("NFKC", value or "")
    text = text.replace("​", "").replace("﻿", "")
    return re.sub(r"\s+", " ", text).strip().lower()


def _normalised_aliases(aliases: tuple[str, ...]) -> tuple[str, ...]:
    """Aliases folded the same way headers are.

    Both sides must go through `_normalise_header`; comparing a normalised
    header against a literal written here does not work for Thai. NFKC
    decomposes SARA AM (U+0E33) into U+0E4D + U+0E32 and, because that pairing
    is a composition exclusion, never recomposes it — so `จำนวนเงิน` typed in
    this file and `จำนวนเงิน` read from the export are different strings after
    normalisation. Caught by `test_thai_headers_produce_identical_rows`, which
    is exactly the bug that would otherwise have surfaced as "the reader cannot
    find the spend column" on the first real Thai export.
    """
    return tuple(_normalise_header(alias) for alias in aliases)


def _resolve_headers(fieldnames: list[str]) -> dict[str, str]:
    """Map canonical field → the export's actual heading, or refuse."""
    normalised = {_normalise_header(name): name for name in fieldnames if name is not None}
    resolved: dict[str, str] = {}

    for field_name, aliases in CANONICAL_HEADERS.items():
        matches = [normalised[alias] for alias in _normalised_aliases(aliases)
                   if alias in normalised]
        if len(matches) > 1:
            raise ExportFormatError(
                f"The export has more than one column that could be '{field_name}': "
                f"{matches}. Remove the duplicate before reconciling — guessing "
                f"which one is meant is exactly the kind of silent choice this "
                f"measurement cannot contain."
            )
        if matches:
            resolved[field_name] = matches[0]

    # No explicit day column, but a reporting-start one: use it. Safe only
    # because `read_export` then requires reporting-end to equal it row by row —
    # without that, this is precisely how a range export gets read as a day.
    if "date" not in resolved and "date_start" in resolved:
        resolved["date"] = resolved["date_start"]

    for field_name in REQUIRED_FIELDS:
        if field_name in resolved:
            continue
        confusable = CONFUSABLE_HEADERS.get(field_name)
        if confusable:
            wrong, advice = confusable
            present = [normalised[alias] for alias in _normalised_aliases(wrong)
                       if alias in normalised]
            if present:
                raise ExportFormatError(
                    f"The export has {present} but no 'Clicks (all)' column. {advice}"
                )
        raise ExportFormatError(
            f"The export has no column for '{field_name}'. Expected one of: "
            f"{list(CANONICAL_HEADERS[field_name])}. Columns found: {fieldnames}. "
            + (
                "Add the 'Ad ID' column in Ads Manager — joining on ad NAME breaks "
                "the moment an ad is renamed or two ads share a name."
                if field_name == "ad_id"
                else ""
            )
        )
    return resolved


# ── Value parsing ────────────────────────────────────────────────────────────

_THAI_DIGITS = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")
_NUMBER_NOISE = re.compile(r"[,\s ฿]|THB", re.IGNORECASE)


def parse_number(value: str, *, column: str, line: int) -> Decimal:
    """A spreadsheet cell to an exact Decimal, or a stated refusal.

    Handles the shapes a Thai-locale export actually produces: grouped
    thousands, a currency symbol or code, non-breaking spaces, Thai digits.
    Deliberately does NOT accept a bare '-' or 'n/a' as zero — an absent
    measurement and a measured zero are different claims, and this comparison
    is about exactly that kind of difference.
    """
    text = unicodedata.normalize("NFKC", value or "").strip().translate(_THAI_DIGITS)
    text = _NUMBER_NOISE.sub("", text)
    if not text:
        raise ExportFormatError(
            f"line {line}: column '{column}' is empty. A blank cell is not a zero; "
            f"re-export with the metric included."
        )
    try:
        return Decimal(text)
    except InvalidOperation as exc:
        raise ExportFormatError(
            f"line {line}: column '{column}' is not a number: {value!r}"
        ) from exc


_ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_SLASH_DATE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")

# Thailand's civil calendar is 543 years ahead. A four-digit year above this is
# a Buddhist year: 2400 BE is 1857 CE, comfortably before any ad account, and
# 2400 CE is comfortably after this software.
_BUDDHIST_ERA_THRESHOLD = 2400


def parse_date(value: str, *, line: int) -> str:
    """A date cell to ISO YYYY-MM-DD.

    `DD/MM/YYYY` is read day-first, not month-first: an export produced by a
    Thai-locale Ads Manager is day-first, and reading 10/08 as 8 October would
    put real spend on a day it did not happen — a silent error that reconciles
    perfectly in total and is wrong on every row.
    """
    text = unicodedata.normalize("NFKC", value or "").strip().translate(_THAI_DIGITS)

    iso = _ISO_DATE.match(text)
    if iso:
        year, month, day = (int(part) for part in iso.groups())
    else:
        slash = _SLASH_DATE.match(text)
        if not slash:
            raise ExportFormatError(
                f"line {line}: cannot read {value!r} as a date. Expected "
                f"YYYY-MM-DD or DD/MM/YYYY."
            )
        day, month, year = (int(part) for part in slash.groups())

    if year > _BUDDHIST_ERA_THRESHOLD:
        year -= 543
    try:
        return dt.date(year, month, day).isoformat()
    except ValueError as exc:
        raise ExportFormatError(f"line {line}: {value!r} is not a real date") from exc


def _decode(raw: bytes) -> str:
    """Decode an export, trying the encodings Ads Manager and Excel produce.

    `latin-1` is not in the list. It decodes every possible byte sequence, so
    including it would turn "this file is not text we understand" into a page of
    mojibake that parses — the failure mode is a reconciliation run against
    garbage rather than a stated refusal.
    """
    for encoding in ("utf-8-sig", "utf-8", "utf-16", "cp874", "tis-620"):
        try:
            return raw.decode(encoding)
        except (UnicodeDecodeError, UnicodeError):
            continue
    raise ExportFormatError(
        "The export's text encoding could not be determined. Re-export as CSV "
        "UTF-8 from Ads Manager."
    )


def read_export(path: Path) -> ExportTable:
    """Read an Ads Manager CSV export into comparable rows.

    Takes a path so the harness works against a fixture before the real export
    exists, and so the file used for a published result can be checksummed and
    named. The sha256 goes in the report: a reconciliation is a claim about one
    specific file.
    """
    path = Path(path)
    if not path.is_file():
        raise ExportFormatError(f"{path} does not exist")
    raw = path.read_bytes()
    text = _decode(raw)

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ExportFormatError(f"{path} has no header row")
    headers = _resolve_headers(list(reader.fieldnames))
    language = (
        "th"
        if any(hint in "".join(reader.fieldnames) for hint in THAI_HEADER_HINTS)
        else "en"
    )

    rows: list[ReconcileRow] = []
    skipped: list[SkippedRow] = []
    seen: dict[tuple[str, str], int] = {}

    for line, record in enumerate(reader, start=2):
        ad_id = (record.get(headers["ad_id"]) or "").strip()
        date_cell = (record.get(headers["date"]) or "").strip()

        # A totals row — Thai exports append `รวมทั้งหมด` — has a label where the
        # ad id goes and no date. Ingesting it would double every total. It is
        # recorded rather than dropped in silence, so that a reader quietly
        # discarding real rows shows up as a skip count nobody expected.
        if not ad_id or not date_cell:
            skipped.append(
                SkippedRow(
                    reason="no ad id" if not ad_id else "no date",
                    raw=",".join(str(v) for v in record.values() if v),
                )
            )
            continue

        date = parse_date(date_cell, line=line)

        # The row is one day, or this is not an ad × day export. Checked per row
        # rather than once for the file: a breakdown that lapses on a single row
        # is the case that would otherwise slip through.
        #
        # **Only when the date came from the reporting-start column.** A
        # populated `วัน` / `Day` cell is itself proof the Day breakdown was on,
        # and whether Ads Manager then narrows reporting-start/end to that day or
        # leaves them at the whole range has NOT been measured on a real export —
        # both variants are reported to exist. Enforcing equality on that
        # unmeasured guess would refuse a perfectly good daily export, which is
        # the more expensive mistake here: the hole this closes is the file that
        # has no day column at all, and that case is fully covered below.
        if headers["date"] == headers.get("date_start") and "date_end" in headers:
            end_cell = (record.get(headers["date_end"]) or "").strip()
            end = parse_date(end_cell, line=line) if end_cell else date
            if end != date:
                raise ExportFormatError(
                    f"line {line}: the row covers {date} → {end}, not a single "
                    f"day, and the export has no 'Day' column to say otherwise. "
                    f"Its numbers are a total over that range, so they cannot be "
                    f"compared against one stored ad × day row. Set "
                    f"'Time breakdown' = Day in Ads Manager and re-export."
                )

        row = ReconcileRow(
            ad_id=ad_id,
            date=date,
            impressions=int(parse_number(record[headers["impressions"]],
                                         column="impressions", line=line)),
            clicks=int(parse_number(record[headers["clicks"]], column="clicks", line=line)),
            spend=parse_number(record[headers["spend"]], column="spend", line=line),
            conversions=(
                int(parse_number(record[headers["conversions"]],
                                 column="conversions", line=line))
                if "conversions" in headers and (record.get(headers["conversions"]) or "").strip()
                else None
            ),
        )
        if row.key in seen:
            raise ExportFormatError(
                f"line {line}: ad {row.ad_id} appears twice on {row.date} "
                f"(also line {seen[row.key]}). The export is not at ad × day "
                f"grain — check the breakdown is set to Day and the level to Ad."
            )
        seen[row.key] = line
        rows.append(row)

    # Every data row was skipped for having no ad id or no date. That is what an
    # account-level or summary-only export looks like: the dimension columns are
    # present as headings and empty in the cells, and the single row carries the
    # range's totals. Without this refusal `window` returns ("", ""), the
    # database read is scoped by two empty strings, and both sides reconcile
    # nothing against nothing — a 0.0000% error over zero cells (CLAUDE.md §12).
    if not rows:
        raise ExportFormatError(
            f"The export has no ad × day rows: all {len(skipped)} data row(s) "
            f"were skipped for having no ad id or no date. That is the shape of "
            f"an account- or campaign-level summary. Re-export with "
            f"'Breakdown by' = Ad and 'Time breakdown' = Day, so each row names "
            f"one ad on one day."
        )

    return ExportTable(
        path=path,
        rows=rows,
        skipped=skipped,
        sha256=hashlib.sha256(raw).hexdigest(),
        header_language=language,
        headers=headers,
    )


# ── Comparison ───────────────────────────────────────────────────────────────


@dataclass
class MetricResult:
    name: str
    export_total: Decimal
    db_total: Decimal
    aggregate_error_pct: Decimal
    exact_rows: int
    compared_rows: int
    max_row_error_pct: Decimal
    #: Rows where the export says zero and the database does not. Relative error
    #: is undefined there; counting them as 0% would hide a fabricated number.
    undefined_rows: int

    @property
    def passed(self) -> bool:
        return (
            self.exact_rows == self.compared_rows
            and self.undefined_rows == 0
            and self.aggregate_error_pct <= TOLERANCE_PCT
        )


@dataclass
class RowDiff:
    key: tuple[str, str]
    metric: str
    export_value: Decimal
    db_value: Decimal
    error_pct: Decimal | None


@dataclass
class Reconciliation:
    only_in_export: list[tuple[str, str]]
    #: Every key present in the database and absent from the export, exempt or
    #: not. Kept as the complete set so its meaning does not change under
    #: readers of the JSON report; the exempt subset is named separately below.
    only_in_db: list[tuple[str, str]]
    matched_keys: list[tuple[str, str]]
    tier_a: dict[str, MetricResult]
    tier_b: dict[str, MetricResult]
    tier_c: dict[str, MetricResult]
    worst_rows: list[RowDiff] = field(default_factory=list)
    #: The subset of `only_in_db` carrying zero in every reconciled quantity.
    #: Reported, never failed — see "Gate definition change" in RESULTS.md.
    only_in_db_zero: list[tuple[str, str]] = field(default_factory=list)

    @property
    def only_in_db_blocking(self) -> list[tuple[str, str]]:
        """Database-only keys that still fail coverage: the ones carrying a
        number the export does not report."""
        exempt = set(self.only_in_db_zero)
        return [key for key in self.only_in_db if key not in exempt]

    @property
    def exact_cells(self) -> int:
        return sum(metric.exact_rows for metric in self.tier_a.values())

    @property
    def total_cells(self) -> int:
        return sum(metric.compared_rows for metric in self.tier_a.values())

    @property
    def coverage_passed(self) -> bool:
        """Both directions of the symmetric difference, but not symmetrically.

        A key present only in the export means the pipeline failed to store
        something the platform reported — money that exists and was not
        recorded. A key present only in the database with a real number on it
        means the pipeline invented or misdated something. Both are defects and
        both fail here, unconditionally.

        A key present only in the database and carrying zero in every
        reconciled quantity is neither: there is nothing in it to agree or
        disagree about, and adding it to the export side would move no total by
        any amount. Failing on those measured whether Ads Reporting chose to
        emit an empty row, which is a property of Meta's reporting layer — the
        same window holds seven such rows and the export emitted three of them.

        See "Gate definition change — coverage, 2026-08-13" in RESULTS.md for
        the argument, and for what this narrowing gives up.
        """
        return not self.only_in_export and not self.only_in_db_blocking

    @property
    def tier_b_is_implied_by_tier_a(self) -> bool:
        """True when tier A matched exactly on every row.

        Tier B is recomputed from tier A's own numbers, so when A is exact, B is
        exact by construction and carries no independent evidence. Reporting
        that plainly is the difference between five metrics and three metrics
        with two restatements.
        """
        return all(m.exact_rows == m.compared_rows for m in self.tier_a.values())

    @property
    def passed(self) -> bool:
        # Tier C is absent from this conjunction on purpose: conversions depend
        # on the attribution window, which Ads Manager and the API can set
        # differently, so a difference there is not a pipeline defect. See L-5.
        return self.coverage_passed and all(m.passed for m in self.tier_a.values())


def _rate(numerator: Decimal, denominator: Decimal) -> Decimal | None:
    return None if denominator == 0 else numerator / denominator


def _metric(
    name: str,
    pairs: list[tuple[tuple[str, str], Decimal | None, Decimal | None]],
    totals: tuple[Decimal, Decimal] | None = None,
) -> tuple[MetricResult, list[RowDiff]]:
    """Compare one metric row by row.

    `totals` overrides the column totals for RATES. Adding up per-row CTRs
    produces a number with no meaning — thirty rows of ~2% summing to 258 — and
    printing it in a results table invites someone to quote it. A rate's total
    is the rate over the totals, so tier B passes that in explicitly.
    """
    if totals is None:
        export_total = sum((e for _, e, _ in pairs if e is not None), Decimal(0))
        db_total = sum((d for _, _, d in pairs if d is not None), Decimal(0))
    else:
        export_total, db_total = totals

    exact = 0
    undefined = 0
    compared = 0
    max_error = Decimal(0)
    diffs: list[RowDiff] = []

    for key, export_value, db_value in pairs:
        if export_value is None or db_value is None:
            continue
        compared += 1
        if export_value == db_value:
            exact += 1
            diffs.append(RowDiff(key, name, export_value, db_value, Decimal(0)))
            continue
        if export_value == 0:
            # |db - 0| / 0. Not zero error — no error at all can be computed,
            # and the row is flagged so it cannot pass by arithmetic accident.
            undefined += 1
            diffs.append(RowDiff(key, name, export_value, db_value, None))
            continue
        error = abs(db_value - export_value) / abs(export_value) * 100
        max_error = max(max_error, error)
        diffs.append(RowDiff(key, name, export_value, db_value, error))

    aggregate = (
        Decimal(0)
        if export_total == 0
        else abs(db_total - export_total) / abs(export_total) * 100
    )
    return (
        MetricResult(
            name=name,
            export_total=export_total,
            db_total=db_total,
            aggregate_error_pct=aggregate,
            exact_rows=exact,
            compared_rows=compared,
            max_row_error_pct=max_error,
            undefined_rows=undefined,
        ),
        diffs,
    )


TIER_A_METRICS = ("impressions", "clicks", "spend")

#: Every quantity this harness reconciles, gated or merely reported.
#:
#: Deliberately wider than TIER_A_METRICS. `conversions` is reported rather than
#: gated (tier C, limitation L-5), but the coverage exemption below claims a row
#: has "nothing to reconcile", and a row with zero delivery and a real
#: conversion count is still something the export omitted. Requiring all four to
#: be zero is the stricter reading and the one that matches the claim.
RECONCILED_QUANTITIES = ("impressions", "clicks", "spend", "conversions")


def is_empty_row(row: ReconcileRow) -> bool:
    """True when a row carries no measurable quantity at all.

    `reach` is not consulted: this harness does not reconcile it at any tier, so
    it cannot be part of a test about what is reconcilable. It stays out of the
    error calculation too.

    A `None` conversion count is treated as nothing rather than as a
    disqualifier. It means the harness has no conversion figure for the row, not
    that it has a non-zero one, and reading absence as presence would make the
    exemption depend on whether a column happened to be populated.
    """
    for name in RECONCILED_QUANTITIES:
        value = getattr(row, name)
        if value is None:
            continue
        if Decimal(value) != 0:
            return False
    return True


def compare(
    export_rows: list[ReconcileRow], db_rows: list[ReconcileRow]
) -> Reconciliation:
    """Reconcile two ad × day tables.

    Coverage is established first and gates everything after it. The metrics are
    then compared only over the intersection — which is sound *because* an
    empty symmetric difference was already required, and unsound without it.
    """
    export_by_key = {row.key: row for row in export_rows}
    db_by_key = {row.key: row for row in db_rows}

    only_in_export = sorted(export_by_key.keys() - db_by_key.keys())
    only_in_db = sorted(db_by_key.keys() - export_by_key.keys())
    matched = sorted(export_by_key.keys() & db_by_key.keys())

    # Exemption is decided from the stored row's own values, never from the fact
    # that the export omitted it — otherwise every absence would justify itself.
    only_in_db_zero = [key for key in only_in_db if is_empty_row(db_by_key[key])]

    def pairs_for(getter) -> list[tuple[tuple[str, str], Decimal | None, Decimal | None]]:
        out = []
        for key in matched:
            out.append((key, getter(export_by_key[key]), getter(db_by_key[key])))
        return out

    tier_a: dict[str, MetricResult] = {}
    all_diffs: list[RowDiff] = []
    for name in TIER_A_METRICS:
        result, diffs = _metric(
            name, pairs_for(lambda row, n=name: Decimal(getattr(row, n)))
        )
        tier_a[name] = result
        all_diffs.extend(diffs)

    # Tier B is recomputed from tier A on BOTH sides rather than read off the
    # export's own CTR/CPC columns. Ads Manager and the Graph API round derived
    # figures differently, so comparing their printed values manufactures a
    # failure out of two correct numbers.
    def ctr(row: ReconcileRow) -> Decimal | None:
        rate = _rate(Decimal(row.clicks), Decimal(row.impressions))
        return None if rate is None else rate * 100

    def cpc(row: ReconcileRow) -> Decimal | None:
        return _rate(row.spend, Decimal(row.clicks))

    def overall(numerator: str, denominator: str, scale: Decimal) -> tuple[Decimal, Decimal]:
        out = []
        for source in (export_by_key, db_by_key):
            num = sum((Decimal(getattr(source[k], numerator)) for k in matched), Decimal(0))
            den = sum((Decimal(getattr(source[k], denominator)) for k in matched), Decimal(0))
            out.append(Decimal(0) if den == 0 else num / den * scale)
        return (out[0], out[1])

    tier_b = {
        "ctr": _metric("ctr", pairs_for(ctr),
                       overall("clicks", "impressions", Decimal(100)))[0],
        "cpc": _metric("cpc", pairs_for(cpc), overall("spend", "clicks", Decimal(1)))[0],
    }

    def conversions(row: ReconcileRow) -> Decimal | None:
        return None if row.conversions is None else Decimal(row.conversions)

    tier_c = {"conversions": _metric("conversions", pairs_for(conversions))[0]}

    # Shown even on a passing run: a table of zeros with nothing behind it reads
    # the same as a harness that compared nothing.
    worst = sorted(
        all_diffs,
        key=lambda d: (d.error_pct is None, d.error_pct or Decimal(0)),
        reverse=True,
    )[:5]

    return Reconciliation(
        only_in_export=only_in_export,
        only_in_db=only_in_db,
        only_in_db_zero=only_in_db_zero,
        matched_keys=matched,
        tier_a=tier_a,
        tier_b=tier_b,
        tier_c=tier_c,
        worst_rows=worst,
    )


# ── Reporting ────────────────────────────────────────────────────────────────

GROUND_TRUTH_SOURCES = ("meta_ads_manager", "generated")
"""Agreed at sprint day 0: the report always says where its truth came from, so
a synthetic ground truth can never reach the thesis unlabelled."""


def _q(value: Decimal, places: str = "0.0001") -> str:
    return str(value.quantize(Decimal(places)))


def _show(value: Decimal) -> str:
    """A total, at a precision a human can read.

    Only for display. Every comparison above happens at full Decimal precision;
    quantizing the stored values instead would let two different numbers print
    the same and pass as equal.
    """
    if value == value.to_integral_value():
        return str(value.to_integral_value())
    return str(value.quantize(Decimal("0.0001")).normalize())


def to_json(result: Reconciliation, export: ExportTable, *, source: str) -> dict:
    if source not in GROUND_TRUTH_SOURCES:
        raise ValueError(
            f"ground_truth_source must be one of {GROUND_TRUTH_SOURCES}, got {source!r}"
        )
    since, until = export.window

    def metrics(tier: dict[str, MetricResult]) -> dict:
        return {
            name: {
                "export_total": str(m.export_total),
                "db_total": str(m.db_total),
                "aggregate_error_pct": _q(m.aggregate_error_pct),
                "exact_rows": m.exact_rows,
                "compared_rows": m.compared_rows,
                "max_row_error_pct": _q(m.max_row_error_pct),
                "undefined_rows": m.undefined_rows,
                "passed": m.passed,
            }
            for name, m in tier.items()
        }

    return {
        "kpi": "KPI-1 reconciliation",
        "ground_truth_source": source,
        "export_path": str(export.path),
        "export_sha256": export.sha256,
        "export_header_language": export.header_language,
        "export_rows_skipped": [
            {"reason": s.reason, "raw": s.raw} for s in export.skipped
        ],
        "window": {"since": since, "until": until},
        "grain": "ad x day",
        "tolerance_pct": str(TOLERANCE_PCT),
        "coverage": {
            "rows_in_export": len(export.rows),
            "rows_in_db": len(result.matched_keys) + len(result.only_in_db),
            "only_in_export": [list(k) for k in result.only_in_export],
            "only_in_db": [list(k) for k in result.only_in_db],
            # The split, both halves named. A reader must be able to see how
            # many rows were exempted and exactly which ones, or the exemption
            # becomes an unfalsifiable claim about rows nobody can look at.
            "only_in_db_zero_exempt": [list(k) for k in result.only_in_db_zero],
            "only_in_db_blocking": [list(k) for k in result.only_in_db_blocking],
            "passed": result.coverage_passed,
        },
        "tier_a_delivery": metrics(result.tier_a),
        "tier_b_derived": metrics(result.tier_b),
        "tier_b_is_implied_by_tier_a": result.tier_b_is_implied_by_tier_a,
        "tier_c_attribution_reported_only": metrics(result.tier_c),
        "cell_exact_match": {
            "exact": result.exact_cells,
            "total": result.total_cells,
        },
        "verdict": "PASS" if result.passed else "FAIL",
    }


def render_markdown(
    result: Reconciliation,
    export: ExportTable,
    *,
    source: str,
    negative_control: str | None = None,
) -> str:
    if source not in GROUND_TRUTH_SOURCES:
        raise ValueError(f"unknown ground_truth_source {source!r}")
    since, until = export.window
    lines: list[str] = []
    add = lines.append

    add("# KPI-1 — Reconciliation: pipeline output vs Meta Ads Manager export")
    add("")
    if source != "meta_ads_manager":
        # Loud, at the top, unmissable. The whole reason this field exists is
        # that a synthetic ground truth reads exactly like a real one once the
        # numbers are in a table.
        add("> # ⚠️ NOT A PUBLISHABLE RESULT")
        add("> ")
        add(f"> `ground_truth_source = {source}`. This run did **not** use a CSV a human")
        add("> exported from Meta Ads Manager, so it demonstrates that the harness")
        add("> works — it does **not** measure the pipeline against an independent")
        add("> source. Do not quote any number below in the thesis.")
        add("")
    add(f"- **Ground truth**: `{export.path.name}`  ·  sha256 `{export.sha256[:16]}…`  ·  **[{source}]**")
    add(f"- **Window**: {since} → {until}   ·   **Grain**: ad × day")
    add(f"- **Export header language**: {export.header_language}")
    if export.skipped:
        add(f"- **Rows skipped by the reader**: {len(export.skipped)} "
            f"({', '.join(sorted({s.reason for s in export.skipped}))})")
    add("")

    add("## COVERAGE — gates everything below it")
    add("")
    add("| | rows |")
    add("|---|---|")
    add(f"| in export | {len(export.rows)} |")
    add(f"| in database | {len(result.matched_keys) + len(result.only_in_db)} |")
    add(f"| in export, **not** in DB | {len(result.only_in_export)} |")
    add(f"| in DB, **not** in export | {len(result.only_in_db)} |")
    add(f"| &nbsp;&nbsp;… of those, zero on every reconciled quantity (exempt) "
        f"| {len(result.only_in_db_zero)} |")
    add(f"| &nbsp;&nbsp;… of those, carrying a value (**fails coverage**) "
        f"| {len(result.only_in_db_blocking)} |")
    add("")
    if result.only_in_db_zero:
        # Named individually, not just counted. An exemption nobody can inspect
        # is indistinguishable from a gate that was quietly switched off.
        add(f"Exempt under the 2026-08-13 gate definition — present in the database, "
            f"absent from the export, and carrying zero in "
            f"{', '.join(RECONCILED_QUANTITIES)}. They are reported rather than "
            f"failed because adding them to the export side would move no total:")
        add("")
        for ad_id, date in result.only_in_db_zero[:20]:
            add(f"- `{ad_id}` on {date}")
        if len(result.only_in_db_zero) > 20:
            add(f"- … and {len(result.only_in_db_zero) - 20} more")
        add("")
    add(f"**Coverage: {'PASS' if result.coverage_passed else 'FAIL'}**")
    if not result.coverage_passed:
        for key in result.only_in_export[:10]:
            add(f"  - missing from DB: ad `{key[0]}` on {key[1]}")
        for key in result.only_in_db[:10]:
            add(f"  - not in export: ad `{key[0]}` on {key[1]}")
    add("")

    def table(title: str, tier: dict[str, MetricResult], gated: bool) -> None:
        add(f"## {title}")
        add("")
        add("| metric | export | database | agg. error | exact rows | verdict |")
        add("|---|---|---|---|---|---|")
        for m in tier.values():
            verdict = ("PASS" if m.passed else "FAIL") if gated else "reported"
            add(
                f"| {m.name} | {_show(m.export_total)} | {_show(m.db_total)} | "
                f"{_q(m.aggregate_error_pct)}% | {m.exact_rows}/{m.compared_rows} | {verdict} |"
            )
        add("")

    table("A. DELIVERY — gated (not attribution-dependent)", result.tier_a, gated=True)
    add(f"**Cell-level exact match: {result.exact_cells}/{result.total_cells}**"
        f"{'  (100%)' if result.exact_cells == result.total_cells else ''}")
    add("")
    table("B. DERIVED — recomputed from A on both sides", result.tier_b, gated=True)
    add("> Totals are the rate over the totals, not the sum of the rows' rates. "
        "Row counts here are below tier A's because a day with no impressions "
        "has no CTR and a day with no clicks has no CPC — those rows leave the "
        "comparison rather than being counted as zero.")
    add("")
    if result.tier_b_is_implied_by_tier_a:
        add("> Tier A matched exactly on every row, so tier B matches by "
            "construction and carries no independent evidence. Stated rather "
            "than presented as two more passing metrics.")
        add("")
    table("C. ATTRIBUTION — reported, NOT gated (see L-5)", result.tier_c, gated=False)
    add("> Ads Manager and the Graph API can apply different attribution "
        "windows, so a difference here is not a pipeline defect. The connected "
        "test account also runs messaging campaigns, so its purchase signal is "
        "not a transactional sale.")
    add("")

    add("## WORST 5 ROWS BY ABSOLUTE ERROR — shown even when passing")
    add("")
    add("| ad | date | metric | export | database | error |")
    add("|---|---|---|---|---|---|")
    for diff in result.worst_rows:
        error = "undefined (export is 0)" if diff.error_pct is None else f"{_q(diff.error_pct)}%"
        add(f"| `{diff.key[0]}` | {diff.key[1]} | {diff.metric} | "
            f"{diff.export_value} | {diff.db_value} | {error} |")
    add("")

    if negative_control:
        add("## NEGATIVE CONTROL — proof this harness can fail")
        add("")
        add(negative_control)
        add("")

    add(f"## VERDICT: {'PASS' if result.passed else 'FAIL'}")
    add("")
    return "\n".join(lines)
