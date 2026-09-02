"""Thai-locale data cleaning — the primitives a Thai merchant's export needs.

This is the research core. A Thai D2C merchant does not export the tidy file a
parser wants; they open the platform's export in Thai Excel, save it, and mail
it to themselves. What arrives has Buddhist-era dates, ``฿`` glued to numbers,
thousands separators inside quoted fields, non-breaking spaces left by a
copy-paste, and a ``รวมทั้งหมด`` total row at the bottom that looks exactly like
data. A naive ``float(cell)`` rejects almost every row of a real file, and
rejecting the merchant's own data is the fastest way to lose them.

Every function here answers the same shape of question: *given a cell a human
produced, what did they mean?* — and returns ``None`` rather than raising when
the answer is genuinely unknowable, because "this cell is unreadable" is a row
the quarantine step reports, not a crash that loses the other 3,000 rows.

Deliberately stdlib-only
------------------------
No pandas, no Airflow, no ``dateutil``. Three reasons, in order of importance:

* It is unit-testable anywhere — ``python3 -m unittest`` on the host, with no
  container and no Airflow metadata database. The measurement harness for the
  write-up runs it in a loop over the fixtures the same way.
* It makes the cleaning rules *the artifact*. A rule expressed as a regex in
  this file is something the research can point at and measure; the same rule
  buried in a ``pd.to_datetime(..., errors="coerce")`` call is not.
* ``dateutil`` guesses. On ``01/02/2569`` it would have to pick a convention,
  and picking silently is worse than the explicit day-first rule below.

What is deliberately NOT here
-----------------------------
**Thai numerals ๐-๙ are out of scope** — ruled out 2026-07-23; no platform or
spreadsheet emits them in a numeric column, and supporting them would mean
accepting digit strings no export actually produces.
"""

from __future__ import annotations

import datetime as dt
import re
import unicodedata
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable

# ── invisible characters ──────────────────────────────────────────────────────

# Characters that carry no meaning but break every comparison they touch. A
# header that ends in U+00A0 does not equal the same header without it, so a
# synonym lookup misses and a whole column goes unmapped — one invisible byte
# costs the merchant an entire metric. Excel and web copy-paste both produce
# these routinely.
_INVISIBLE = {
    "﻿": "",  # BOM / zero-width no-break space
    "​": "",  # zero-width space
    "‌": "",  # zero-width non-joiner
    "‍": "",  # zero-width joiner
    "⁠": "",  # word joiner
    "­": "",  # soft hyphen
    " ": " ",  # non-breaking space -> ordinary space
    " ": " ",  # figure space
    " ": " ",  # narrow no-break space
    "　": " ",  # ideographic space
}
_INVISIBLE_TABLE = str.maketrans(_INVISIBLE)

_WHITESPACE_RUN = re.compile(r"\s+")


def strip_invisible(text: str) -> str:
    """Drop zero-width characters and turn exotic spaces into ordinary ones."""
    return text.translate(_INVISIBLE_TABLE)


def normalize_text(value: Any) -> str:
    """Canonical form of a cell: NFC, no invisibles, single spaces, trimmed.

    NFC matters for Thai specifically. The same visible word can arrive with its
    vowel and tone marks in different orders or as decomposed sequences
    depending on the keyboard and the application that saved the file; NFC makes
    those byte-identical so a dictionary lookup can succeed.
    """
    if value is None:
        return ""
    text = value if isinstance(value, str) else str(value)
    text = unicodedata.normalize("NFC", strip_invisible(text))
    return _WHITESPACE_RUN.sub(" ", text).strip()


def is_blank(value: Any) -> bool:
    """True for a cell with nothing a human would call content."""
    return normalize_text(value) == ""


# ── dates ─────────────────────────────────────────────────────────────────────

BE_OFFSET = 543

# A year at or above this is read as Buddhist era. The boundary sits above any
# Gregorian year a business file can plausibly carry and below the BE years they
# actually contain (2560s), so the two eras cannot be confused. Hard-coding the
# rule beats guessing from magnitude per-file: a single-row file gives no
# context to guess from, and guessing differently per file would make the same
# date mean two things in one import.
BE_THRESHOLD = 2200

THAI_MONTHS: dict[str, int] = {}
_MONTH_NAMES = [
    ("มกราคม", "ม.ค."), ("กุมภาพันธ์", "ก.พ."), ("มีนาคม", "มี.ค."),
    ("เมษายน", "เม.ย."), ("พฤษภาคม", "พ.ค."), ("มิถุนายน", "มิ.ย."),
    ("กรกฎาคม", "ก.ค."), ("สิงหาคม", "ส.ค."), ("กันยายน", "ก.ย."),
    ("ตุลาคม", "ต.ค."), ("พฤศจิกายน", "พ.ย."), ("ธันวาคม", "ธ.ค."),
]
for _index, (_full, _abbr) in enumerate(_MONTH_NAMES, start=1):
    THAI_MONTHS[_full] = _index
    THAI_MONTHS[_abbr] = _index
    # Merchants drop the dots when typing by hand ("ก.ค." -> "กค"), and a
    # partially-stripped form ("ก.ค") is what naive cleanup leaves behind. All
    # three are registered so the lookup cannot depend on which one it is
    # handed — the first version of this normalised to "ก.ค" and missed every
    # abbreviated date in the dirty fixture, i.e. two thirds of the file.
    THAI_MONTHS[_abbr.replace(".", "")] = _index
    THAI_MONTHS[_abbr.rstrip(".")] = _index

ENGLISH_MONTHS = {
    name.lower(): index
    for index, names in enumerate(
        [("january", "jan"), ("february", "feb"), ("march", "mar"),
         ("april", "apr"), ("may", "may"), ("june", "jun"),
         ("july", "jul"), ("august", "aug"), ("september", "sep", "sept"),
         ("october", "oct"), ("november", "nov"), ("december", "dec")],
        start=1,
    )
    for name in names
}

_ISO_DATE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")
_SLASH_DATE = re.compile(r"^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$")
_NAMED_DATE = re.compile(r"^(\d{1,2})\s+([^\s\d]+)\.?\s+(\d{2,4})$")


def to_gregorian_year(year: int) -> int:
    """Convert a Buddhist-era year to Gregorian; leave Gregorian untouched.

    Two-digit years are read as Buddhist era ('69' -> 2569 -> 2026), which is
    what Thai spreadsheets produce when a column is too narrow. There is no
    honest alternative: '69' as Gregorian would be 1969.
    """
    if year < 100:
        year += 2500
    return year - BE_OFFSET if year >= BE_THRESHOLD else year


def _build_date(year: int, month: int, day: int) -> dt.date | None:
    """Assemble a real calendar date, or None if the numbers describe none.

    ``31/02/2569`` reaches here and returns None. That is the point: an
    impossible date is a *row-level* defect the merchant should see in their
    error report, not an exception that aborts their import.
    """
    try:
        return dt.date(to_gregorian_year(year), month, day)
    except ValueError:
        return None


def parse_thai_date(value: Any) -> dt.date | None:
    """Read a date cell in any form a Thai merchant's export produces.

    Accepted, in the order tried:

    ``2026-06-24``           ISO, already Gregorian — the platform's own export
    ``18/07/2569``           day-first with a Buddhist-era year
    ``18 ก.ค. 2569``          Thai month name or abbreviation
    ``18 July 2026``         English month name
    ``2569-07-18``           ISO shape carrying a Buddhist-era year

    **Day-first is assumed for the ambiguous ``dd/mm/yyyy`` form**, because Thai
    locale exports are day-first and every fixture confirms it. Where the file
    proves otherwise (a first component above 12) the two are swapped rather
    than rejected — ``13/07`` can only be 13 July.
    """
    text = normalize_text(value)
    if not text:
        return None

    iso = _ISO_DATE.match(text)
    if iso:
        year, month, day = (int(part) for part in iso.groups())
        return _build_date(year, month, day)

    slash = _SLASH_DATE.match(text)
    if slash:
        first, second, year = (int(part) for part in slash.groups())
        # Day-first unless the file says otherwise.
        day, month = (first, second) if first > 12 or second <= 12 else (second, first)
        return _build_date(year, month, day)

    named = _NAMED_DATE.match(text)
    if named:
        day_text, month_text, year_text = named.groups()
        # Try the month name as written, then progressively de-punctuated, so
        # "ก.ค.", "ก.ค" and "กค" all resolve to the same month.
        month = None
        for candidate in (month_text, month_text.rstrip("."), month_text.replace(".", "")):
            month = THAI_MONTHS.get(candidate) or ENGLISH_MONTHS.get(candidate.lower())
            if month:
                break
        if month:
            return _build_date(int(year_text), month, int(day_text))

    return None


# ── numbers ───────────────────────────────────────────────────────────────────

# Currency and unit decoration that carries no numeric information. Order
# matters only in that longer strings are removed before their substrings.
_CURRENCY_TOKENS = ("฿", "บาท", "thb", "บ.", "$", "usd", "%")

# Cells that are present but deliberately empty. A merchant writes these to mean
# "no value", and a metric of NULL is a different fact from a metric of 0 —
# zero conversions is a result, "-" is the absence of one.
_NULL_TOKENS = {"", "-", "--", "—", "–", "n/a", "na", "n.a.", "null", "nil",
                "ไม่มี", "ไม่ระบุ", "#n/a", "#value!", "#div/0!"}

_PAREN_NEGATIVE = re.compile(r"^\((.*)\)$")
_NUMERIC = re.compile(r"^[+-]?\d*\.?\d+$")


def parse_decimal(value: Any) -> Decimal | None:
    """Read a money or metric cell as an exact Decimal, or None.

    Handles ``฿1,234.56``, ``1,234.56 บาท``, ``(1,234.56)`` for a negative, and
    the ``N/A``/``-`` family that means "no value". Decimal rather than float
    because these are money: the write-up compares totals against the fixture's
    stated ``฿1,092,640`` gross, and binary floats would make that comparison
    approximate for no reason.
    """
    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool):  # bool is an int subclass; never a metric
        return None
    if isinstance(value, (int, float)):
        return Decimal(str(value))

    text = normalize_text(value)
    if text.lower() in _NULL_TOKENS:
        return None

    lowered = text.lower()
    for token in _CURRENCY_TOKENS:
        lowered = lowered.replace(token, "")
    cleaned = lowered.replace(",", "").replace(" ", "")

    negative = False
    paren = _PAREN_NEGATIVE.match(cleaned)
    if paren:
        # Accounting-style negative. Excel writes losses this way whenever the
        # cell is formatted as currency, so a fee column is full of them.
        negative, cleaned = True, paren.group(1)

    if not _NUMERIC.match(cleaned):
        return None

    try:
        result = Decimal(cleaned)
    except InvalidOperation:
        return None
    return -result if negative else result


def parse_int(value: Any) -> int | None:
    """Read a whole-number cell (impressions, clicks, quantity).

    Rounds a decimal rather than rejecting it: exports sometimes carry
    ``1,234.0`` in a count column, and refusing that would quarantine a row over
    a formatting artifact.
    """
    number = parse_decimal(value)
    if number is None:
        return None
    try:
        return int(number.to_integral_value())
    except (InvalidOperation, OverflowError, ValueError):
        return None


# ── row shapes ────────────────────────────────────────────────────────────────

# A totals row repeats the file's own numbers. Ingesting one double-counts every
# metric in it — the single most expensive parsing mistake available here,
# because it corrupts the merchant's totals rather than losing a row.
_SUMMARY_LABELS = (
    "รวมทั้งหมด", "รวมทั้งสิ้น", "ยอดรวม", "ผลรวม", "รวม",
    "total", "grand total", "sum", "subtotal", "totals",
)


def is_blank_row(cells: Iterable[Any]) -> bool:
    """True when every cell is empty — a spacer line, not a record."""
    return all(is_blank(cell) for cell in cells)


def is_summary_row(cells: Iterable[Any]) -> bool:
    """True when this row totals the rows above it rather than being one.

    Two conditions, both required. The *first* filled cell is a totals label,
    which is where every export puts it; and every cell after it is a number or
    a "no value" placeholder — because a totals row totals numbers and has no
    campaign, no ad, no date of its own.

    The second condition is what keeps a real row safe. `_SUMMARY_LABELS`
    contains the bare "รวม" and "total", so on a file whose first column is the
    campaign name a campaign called exactly "รวม" would otherwise be discarded
    as furniture: dropped, counted as a summary, never reported, and
    `rows_total` shrinking to match so the consistency check still balances.
    Silent data loss with no merchant-visible trace is the worst outcome
    available here, worse than ingesting one extra row.
    """
    values = [normalize_text(cell) for cell in cells]
    filled = [value for value in values if value]
    if not filled:
        return False
    label = filled[0].lower().rstrip(":： ")
    if label not in _SUMMARY_LABELS:
        return False
    # `parse_decimal` returns None both for a placeholder ("-", "N/A") and for
    # text it cannot read, so the null tokens are checked separately: a totals
    # row may leave a column blank, but it never carries a date or a name.
    return all(
        value.lower() in _NULL_TOKENS or parse_decimal(value) is not None
        for value in filled[1:]
    )
