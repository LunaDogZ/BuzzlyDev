"""The parser this pipeline is measured against.

A claim that a Thai-locale cleaning module recovers data is worth nothing
without saying *recovers it from what*. This module is that "what": a plain,
competent CSV reader of the kind a developer writes on day one, before meeting
a real merchant's file.

What it is allowed to do
------------------------
Everything the standard library makes easy:

* ``bytes.decode("utf-8")`` — the encoding every tutorial assumes.
* ``csv.reader`` with a comma, and row 0 as the header.
* ``float()`` for a metric, ``date.fromisoformat()`` for a date.
* Header lookup by exact, case-insensitive string match.

**It is handed the full synonym dictionary from :mod:`buzzly_common.mapping`,
Thai entries included.** That is deliberate and it makes the comparison
conservative: knowing that ``ค่าใช้จ่าย`` means spend is a dictionary anyone can
type out, so crediting it to the pipeline would inflate the result. What remains
between the two implementations is the actual research contribution —

* encoding detection (this baseline decodes as UTF-8 or gives up),
* invisible-character and NFC normalisation,
* stripping the parenthetical gloss, prefix and fuzzy header matching,
* Buddhist-era dates,
* currency symbols, thousands separators, accounting negatives,
* the distinction between an empty cell and an unreadable one,
* dropping blank and ``รวมทั้งหมด`` rows instead of ingesting or rejecting them.

What it is not
--------------
Not a strawman. It does not throw away rows it could have read, and on
``ads-export-clean.csv`` it should score close to the pipeline — that file is
exactly what it was written for. A baseline that failed everywhere would prove
nothing; the point is that it fails *specifically* on the files a Thai merchant
actually owns.

Not pandas, either. ``pd.read_csv`` would bring encoding guessing and
``errors="coerce"`` along with it, which are themselves part of what is being
measured. Standard library only, like everything else under
``buzzly_common`` — see that package's docstrings for why.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
from typing import Any

from buzzly_common.mapping import DATASETS
from buzzly_common.records import field_kind
from buzzly_common.validate import REQUIRED_FIELDS

# The one encoding a first implementation assumes. A CP874 file raises here, and
# raising is the honest outcome: the alternative a developer reaches for next is
# `errors="replace"`, which silently produces mojibake instead.
NAIVE_ENCODING = "utf-8"


class NaiveFailure(Exception):
    """The naive reader could not get as far as rows."""


def _index(dataset: str) -> dict[str, str]:
    """Exact-match lookup: heading as written (lowercased) -> canonical field."""
    index: dict[str, str] = {}
    for field, synonyms in DATASETS[dataset]["fields"].items():
        for synonym in synonyms:
            index.setdefault(synonym.lower(), field)
    return index


def _map_headers(headers: list[str], dataset: str) -> tuple[dict[str, int], list[str]]:
    index = _index(dataset)
    columns: dict[str, int] = {}
    unmapped: list[str] = []
    for position, header in enumerate(headers):
        field = index.get(header.strip().lower())
        if field is None or field in columns:
            unmapped.append(header)
        else:
            columns[field] = position
    return columns, unmapped


def _parse(field: str, cell: str) -> Any:
    """Read one cell the obvious way. Raises ``ValueError`` when it cannot.

    There is no "absent" branch here, and that absence is the point: to this
    parser an empty conversions cell and the string ``N/A`` are the same event —
    ``float()`` raises on both — so a row with a legitimately blank optional
    cell is lost for the same reason as a corrupt one.
    """
    kind = field_kind(field)
    if kind == "text":
        return cell.strip()
    if kind == "date":
        return dt.date.fromisoformat(cell.strip())
    if kind == "int":
        return int(float(cell))
    return float(cell)


def naive_parse(data: bytes, dataset: str = "ad_performance") -> dict:
    """Read uploaded bytes the way a first implementation does.

    Returns the same shape the measurement code gets from the real pipeline:
    ``rows_total`` / ``ok`` / ``rejected`` plus what the header row resolved to,
    so the two can be compared field by field rather than only by row counts.

    A row is kept only if every mapped cell parses and the dataset's required
    fields are present — which is the whole of this parser's error handling,
    and is why it reports no reason codes. It cannot tell the merchant why a
    row was dropped, because it does not know.
    """
    result: dict[str, Any] = {
        "columns": {}, "unmapped": [], "rows_total": 0,
        "ok": [], "rejected": [], "failure": None,
    }

    try:
        text = data.decode(NAIVE_ENCODING)
    except UnicodeDecodeError as exc:
        result["failure"] = f"decode failed: {exc}"
        return result

    rows = list(csv.reader(io.StringIO(text, newline="")))
    if not rows:
        result["failure"] = "no rows"
        return result

    headers = rows[0]
    columns, unmapped = _map_headers(headers, dataset)
    result["columns"] = columns
    result["unmapped"] = unmapped

    required = REQUIRED_FIELDS.get(dataset, ())
    for offset, row in enumerate(rows[1:], start=2):
        # A blank line is a row like any other to this parser. It will fail the
        # required-field check below and be dropped — the same outcome the real
        # pipeline reaches by recognising it as furniture, but reached by
        # accident, and it costs the row count its meaning.
        result["rows_total"] += 1
        values: dict[str, Any] = {}
        failed = False
        for field, position in columns.items():
            cell = row[position] if position < len(row) else ""
            try:
                values[field] = _parse(field, cell)
            except (ValueError, TypeError):
                failed = True
                break
        if failed or any(values.get(field) in (None, "") for field in required):
            result["rejected"].append({"row_number": offset})
        else:
            result["ok"].append({"row_number": offset, "values": values})

    return result
