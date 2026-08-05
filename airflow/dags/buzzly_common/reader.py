"""Turn uploaded bytes into a header row and data rows.

Everything here answers questions the *file* poses rather than the data:
is it a spreadsheet or text, what encoding, what delimiter, and which line is
the header. The cell contents are :mod:`buzzly_common.thai`'s problem.

The extension is a hint, never evidence
---------------------------------------
Merchants rename files. ``report.csv`` that is really a workbook, and
``export.xlsx`` that a system wrote as tab-separated text, both arrive. Every
decision here is therefore made from the bytes: xlsx is a ZIP container and
announces itself with ``PK\\x03\\x04``, so that check is exact and comes first.

Encoding is where Thai files are actually lost
----------------------------------------------
A Thai CSV that is not UTF-8 is almost always **CP874** (Windows Thai), which
Excel still writes on a Thai-locale Windows install. Decoded as UTF-8 it raises;
decoded as Latin-1 it *succeeds* and produces mojibake — every Thai header
becomes garbage, every synonym lookup misses, and the import "succeeds" having
mapped nothing. So Latin-1 is only ever reached after CP874 has been tried, and
the order below is the whole defence against a silent total loss.
"""

from __future__ import annotations

import csv
import io
from typing import Any, Iterable

from buzzly_common.thai import is_blank_row, is_summary_row, normalize_text

# xlsx/docx/zip. openpyxl would tell us eventually, but reading four bytes says
# it before we hand a 50 MB blob to a parser that will raise on it.
ZIP_MAGIC = b"PK\x03\x04"
# Legacy .xls (OLE2 compound document). Detected so the merchant gets "we cannot
# read this format" instead of a parser traceback — the picker rejects .xls
# up front, but a renamed file still reaches here.
OLE2_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"

# Tried in order; the first that decodes without error wins. See module docstring
# for why cp874 must precede latin-1.
ENCODINGS = ("utf-8-sig", "utf-8", "cp874", "tis-620", "cp1252", "latin-1")

DELIMITERS = (",", ";", "\t", "|")

# A header row this far down is a title block or an export banner above it.
# Beyond this we stop looking and report, rather than mapping a stray line.
MAX_HEADER_SCAN = 10


class UnreadableFile(Exception):
    """The file cannot be read at all — a job-level failure, not a bad row."""


def detect_format(data: bytes, filename: str = "") -> str:
    """``"xlsx"`` or ``"csv"``, decided from the bytes."""
    if not data:
        raise UnreadableFile("The file is empty (0 bytes).")
    if data.startswith(ZIP_MAGIC):
        return "xlsx"
    if data.startswith(OLE2_MAGIC):
        raise UnreadableFile(
            "This is a legacy Excel (.xls) file. Please re-save it as .xlsx or .csv "
            "and upload again."
        )
    return "csv"


def detect_encoding(data: bytes) -> tuple[str, str]:
    """Return ``(encoding, text)`` for CSV bytes.

    The BOM, when present, is the file telling us outright — trusted over any
    heuristic. Otherwise the candidates are tried in order.
    """
    if data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff"):
        return "utf-16", data.decode("utf-16")

    for encoding in ENCODINGS:
        try:
            text = data.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
        # cp1252/latin-1 decode anything, so they are last and only reached when
        # the honest candidates have failed.
        return encoding, text

    raise UnreadableFile("The file's text encoding could not be determined.")


def detect_delimiter(text: str) -> str:
    """Sniff the field separator from the first few lines.

    ``csv.Sniffer`` is asked first but not trusted blindly: on a file whose
    fields contain Thai text with no delimiter variety it happily returns a
    letter. The fallback counts candidates on the header line instead, which is
    the line most likely to be free of quoted commas.
    """
    sample = "\n".join(text.splitlines()[:20])
    if not sample:
        return ","
    try:
        return csv.Sniffer().sniff(sample, delimiters="".join(DELIMITERS)).delimiter
    except csv.Error:
        first = sample.splitlines()[0]
        counts = {candidate: first.count(candidate) for candidate in DELIMITERS}
        best = max(counts, key=lambda key: counts[key])
        return best if counts[best] else ","


def _find_header(rows: list[list[str]]) -> int:
    """Index of the header row — the first row that looks like labels.

    "Looks like labels" = at least two non-empty cells, none of which parse as a
    plain number. An export with a title line above the table is common enough
    (Shopee writes one) that assuming row 0 would misread those files entirely.
    """
    for index, row in enumerate(rows[:MAX_HEADER_SCAN]):
        filled = [cell for cell in row if normalize_text(cell)]
        if len(filled) < 2:
            continue
        numeric = sum(1 for cell in filled if _looks_numeric(cell))
        if numeric == 0:
            return index
    return 0


def _looks_numeric(cell: str) -> bool:
    stripped = normalize_text(cell).replace(",", "").replace("฿", "").strip()
    if not stripped:
        return False
    try:
        float(stripped)
    except ValueError:
        return False
    return True


def _read_csv(data: bytes) -> dict:
    encoding, text = detect_encoding(data)
    delimiter = detect_delimiter(text)
    rows = list(csv.reader(io.StringIO(text, newline=""), delimiter=delimiter))
    return {"file_format": "csv", "encoding": encoding, "delimiter": delimiter, "rows": rows}


def _read_xlsx(data: bytes) -> dict:
    try:
        from openpyxl import load_workbook
    except ImportError as exc:  # pragma: no cover - image always ships it
        raise UnreadableFile(
            "This server cannot read .xlsx files right now. Please upload a .csv instead."
        ) from exc

    try:
        # read_only streams rows instead of building the whole sheet in memory;
        # data_only takes the cached *value* of a formula cell rather than the
        # formula, which is what a merchant's totals column contains.
        workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001 - openpyxl raises many shapes
        raise UnreadableFile(
            "This spreadsheet could not be opened. It may be password-protected or damaged."
        ) from exc

    try:
        sheet = workbook[workbook.sheetnames[0]]
        rows = [
            ["" if cell is None else cell for cell in row]
            for row in sheet.iter_rows(values_only=True)
        ]
    finally:
        workbook.close()
    return {"file_format": "xlsx", "encoding": None, "delimiter": None, "rows": rows}


def read_table(data: bytes, filename: str = "") -> dict:
    """Read uploaded bytes into ``headers`` + ``rows``, dropping non-records.

    Blank spacer lines and ``รวมทั้งหมด`` totals rows are removed here rather
    than quarantined: they are not the merchant's data failing validation, they
    are furniture. Counting them as rejects would tell a merchant with a
    perfectly good file that it had errors. Their counts are reported so the run
    can still explain where the file's line count went.

    Every returned row carries its **1-based line number in the original file**,
    because that is the only row identifier the merchant can act on when the
    error report says a row was rejected.
    """
    file_format = detect_format(data, filename)
    table = _read_csv(data) if file_format == "csv" else _read_xlsx(data)
    raw_rows = table["rows"]

    if not raw_rows:
        raise UnreadableFile("The file contains no rows.")

    header_index = _find_header(raw_rows)
    headers = [normalize_text(cell) for cell in raw_rows[header_index]]
    # Trailing empty headers are the spreadsheet's unused columns, not fields.
    while headers and not headers[-1]:
        headers.pop()
    if not headers:
        raise UnreadableFile("The file has no column headings.")

    records: list[tuple[int, list[Any]]] = []
    blank_rows = summary_rows = 0
    for offset, row in enumerate(raw_rows[header_index + 1:], start=header_index + 2):
        if is_blank_row(row):
            blank_rows += 1
        elif is_summary_row(row):
            summary_rows += 1
        else:
            records.append((offset, list(row)))

    return {
        "file_format": file_format,
        "encoding": table["encoding"],
        "delimiter": table["delimiter"],
        "header_row": header_index + 1,
        "headers": headers,
        "rows": records,
        "blank_rows": blank_rows,
        "summary_rows": summary_rows,
    }


def iter_cells(row: Iterable[Any], count: int) -> list[Any]:
    """Pad or trim a row to the header width.

    A short row is a real defect the merchant must see, but it is detected by
    :mod:`buzzly_common.validate` against the recorded width — padding here
    keeps every downstream index access safe without hiding it.
    """
    cells = list(row)
    if len(cells) < count:
        cells.extend([""] * (count - len(cells)))
    return cells[:count]
