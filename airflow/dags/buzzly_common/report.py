"""The error report a merchant downloads after a partial import.

This file is the entire remedy for a rejected row. The job status says *how
many* rows failed; only this says which ones and why, in terms of the file the
merchant still has open in Excel.

Three decisions shape it:

* **Their row numbers, not ours.** Every row is identified by its line number in
  the uploaded file, so "row 47" means the row they can scroll to. An internal
  id would be useless to them.
* **Their data, echoed back.** The original cell values for every mapped column
  are included. Finding row 47 is not enough if they cannot see what we read.
* **Written for Thai Excel.** UTF-8 **with BOM**, because Excel on a Thai
  Windows install opens a BOM-less UTF-8 CSV as CP874 and renders every Thai
  character as mojibake. A report about unreadable data that is itself
  unreadable would be a poor joke. The BOM costs three bytes.
"""

from __future__ import annotations

import csv
import io
import re
import unicodedata
from typing import Any

# What a Supabase Storage object key may contain. Anything else — Thai, emoji,
# spaces — comes back as `400 InvalidKey`, so it is folded to a dash rather
# than discovered at upload time. Mirrors `toStorageSafeName` in
# `src/hooks/useImportJobs.tsx`; the two must agree or the pair of uploads that
# describe one file disagree about its name.
_UNSAFE_IN_KEY = re.compile(r"[^a-zA-Z0-9._-]+")
_EDGE_DASHES = re.compile(r"^-+|-+$")

# Excel needs this to recognise the file as UTF-8. See module docstring.
BOM = "﻿"

BASE_COLUMNS = ("row_number", "error_code", "column_name", "error_message")

HEADER_LABELS = {
    "row_number": "แถวที่ / Row",
    "error_code": "รหัสปัญหา / Code",
    "column_name": "คอลัมน์ / Column",
    "error_message": "ปัญหา / Problem",
}


def build_error_report(rejected: list[dict], mapped_fields: list[str]) -> bytes:
    """Render rejected rows as a CSV a merchant can act on.

    One line per *problem*, not per row: a row with two defects gets two lines,
    because fixing only the first would send them round the loop again.
    """
    buffer = io.StringIO(newline="")
    buffer.write(BOM)

    columns = list(BASE_COLUMNS) + list(mapped_fields)
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow([HEADER_LABELS.get(column, column) for column in columns])

    for entry in rejected:
        raw: dict[str, Any] = entry.get("raw") or {}
        for problem in entry.get("problems") or []:
            writer.writerow(
                [
                    entry.get("row_number"),
                    problem.get("error_code"),
                    problem.get("column_name") or "",
                    problem.get("error_message"),
                ]
                + [raw.get(field, "") for field in mapped_fields]
            )

    return buffer.getvalue().encode("utf-8")


def report_filename(original_filename: str) -> str:
    """Name the report after the file it explains, so a folder stays legible.

    The name is reduced to the characters a Storage object key accepts, which
    is narrower than what a merchant's filesystem accepts. A Thai export keeps
    its Thai name in ``import_jobs.original_filename``; only the key is folded.

    This is not cosmetic. The upload path already folds the merchant's filename
    (``toStorageSafeName`` in ``src/hooks/useImportJobs.tsx``) and this one did
    not, so the two disagreed about the same file: the upload succeeded and the
    report upload came back ``400 InvalidKey``, failing ``quarantine_bad_rows``
    — the one stage whose output *is* the merchant's remedy under
    all-or-nothing. They got "we could not read this file" and no row-level
    reasons, support got no ``import_row_errors`` and no DLQ record, and it fired
    on precisely the files this product exists for: Thai exports, which are
    named in Thai by default, with at least one bad row.

    ASCII names are returned byte-identical to before, so the frozen KPI corpus
    measures the same names it always did.
    """
    stem = (original_filename or "import").rsplit(".", 1)[0]
    stem = unicodedata.normalize("NFKD", stem)
    stem = _UNSAFE_IN_KEY.sub("-", stem)
    stem = _EDGE_DASHES.sub("", stem)[:80]
    return f"{stem or 'import'}-errors.csv"


def flatten_problems(rejected: list[dict], limit: int | None = None) -> list[dict]:
    """Rejected rows -> the flat rows ``import_row_errors`` stores.

    ``raw_row`` carries the whole original row on every entry rather than only
    on the first. It is a few hundred bytes per row and it makes each error
    record independently readable — a support query that filters by error code
    should not have to join back to find out what the row contained.
    """
    flattened = []
    for entry in rejected:
        for problem in entry.get("problems") or []:
            flattened.append({
                "row_number": entry.get("row_number"),
                "raw_row": entry.get("raw") or {},
                "column_name": problem.get("column_name"),
                "error_code": problem.get("error_code"),
                "error_message": problem.get("error_message"),
            })
            if limit is not None and len(flattened) >= limit:
                return flattened
    return flattened
