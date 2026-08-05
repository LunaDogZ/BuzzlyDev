"""Tests for the Thai-locale cleaning primitives.

Each case is a defect observed in a real Thai merchant export, not an invented
one — the fixtures in ``fixtures/imports/`` are where they come from. Cases are
grouped by the defect they describe so a failure names the rule that broke.
"""

from __future__ import annotations

import datetime as dt
import sys
import unittest
from decimal import Decimal
from pathlib import Path

# Self-contained on purpose: `unittest discover` imports these modules in
# alphabetical order, so a module that relied on a sibling to put `dags/` on
# the path would fail or pass depending on its own name.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dags"))

from buzzly_common.thai import (  # noqa: E402
    is_blank,
    is_blank_row,
    is_summary_row,
    normalize_text,
    parse_decimal,
    parse_int,
    parse_thai_date,
    strip_invisible,
    to_gregorian_year,
)


class TestInvisibleCharacters(unittest.TestCase):
    def test_strips_bom_and_zero_width(self):
        self.assertEqual(strip_invisible("﻿วันที่​"), "วันที่")

    def test_non_breaking_space_becomes_ordinary_space(self):
        # The dirty Meta fixture ends an ad-set name with U+00A0. Left in place
        # it makes the value unequal to the same name from the clean export.
        self.assertEqual(normalize_text("AS - Gifting Season TH "), "AS - Gifting Season TH")

    def test_collapses_whitespace_runs(self):
        self.assertEqual(normalize_text("  ชื่อ   แคมเปญ  "), "ชื่อ แคมเปญ")

    def test_nfc_normalises_thai_composition(self):
        # Same word, decomposed vs composed. Byte-unequal until normalised,
        # which would break every dictionary lookup that touches it.
        decomposed = "เ" + "ด" + "ิ" + "ม"
        self.assertEqual(normalize_text(decomposed), normalize_text("เดิม"))

    def test_blank_detection_covers_invisible_only_cells(self):
        self.assertTrue(is_blank("​  "))
        self.assertFalse(is_blank("0"))


class TestBuddhistEraDates(unittest.TestCase):
    def test_slash_format_with_be_year(self):
        self.assertEqual(parse_thai_date("18/07/2569"), dt.date(2026, 7, 18))

    def test_thai_month_abbreviation(self):
        # The regression that cost two thirds of the dirty fixture: "ก.ค."
        # normalised to "ก.ค" and missed the dictionary.
        self.assertEqual(parse_thai_date("18 ก.ค. 2569"), dt.date(2026, 7, 18))

    def test_thai_month_abbreviation_without_dots(self):
        self.assertEqual(parse_thai_date("18 กค 2569"), dt.date(2026, 7, 18))

    def test_thai_month_full_name(self):
        self.assertEqual(parse_thai_date("1 มกราคม 2567"), dt.date(2024, 1, 1))

    def test_iso_gregorian_passes_through(self):
        self.assertEqual(parse_thai_date("2026-06-24"), dt.date(2026, 6, 24))

    def test_iso_shape_carrying_be_year(self):
        self.assertEqual(parse_thai_date("2569-07-18"), dt.date(2026, 7, 18))

    def test_english_month_name(self):
        self.assertEqual(parse_thai_date("18 July 2026"), dt.date(2026, 7, 18))

    def test_two_digit_year_reads_as_buddhist_era(self):
        self.assertEqual(parse_thai_date("18/07/69"), dt.date(2026, 7, 18))

    def test_day_first_is_the_default_for_ambiguous_dates(self):
        # 01/02 is 1 February, not 2 January — Thai exports are day-first.
        self.assertEqual(parse_thai_date("01/02/2569"), dt.date(2026, 2, 1))

    def test_swaps_when_first_component_cannot_be_a_month(self):
        self.assertEqual(parse_thai_date("13/07/2569"), dt.date(2026, 7, 13))

    def test_impossible_date_returns_none_rather_than_raising(self):
        # 31 February. A row-level defect the merchant sees in their error
        # report; it must not abort the other 3,000 rows.
        self.assertIsNone(parse_thai_date("31/02/2569"))

    def test_unparseable_and_empty_return_none(self):
        for value in ("", "   ", "N/A", "ไม่ระบุ", "last tuesday", None):
            self.assertIsNone(parse_thai_date(value), value)

    def test_year_conversion_boundary(self):
        self.assertEqual(to_gregorian_year(2569), 2026)
        self.assertEqual(to_gregorian_year(2026), 2026)  # already Gregorian
        self.assertEqual(to_gregorian_year(69), 2026)    # two-digit BE


class TestNumbers(unittest.TestCase):
    def test_baht_symbol_and_thousands_separator(self):
        self.assertEqual(parse_decimal("฿3,087.75"), Decimal("3087.75"))

    def test_baht_word_suffix(self):
        self.assertEqual(parse_decimal("1,234.56 บาท"), Decimal("1234.56"))

    def test_parenthesised_negative_is_a_loss(self):
        # Excel's accounting format. A fee column is full of these.
        self.assertEqual(parse_decimal("(1,234.56)"), Decimal("-1234.56"))

    def test_percentage_sign_is_stripped(self):
        self.assertEqual(parse_decimal("1.92%"), Decimal("1.92"))

    def test_null_tokens_are_absent_not_zero(self):
        # The distinction the whole quarantine design rests on: a metric of
        # None is "no value", and must never silently become 0.
        for value in ("", "-", "N/A", "n/a", "ไม่มี", "#N/A", "—"):
            self.assertIsNone(parse_decimal(value), value)

    def test_garbage_returns_none(self):
        self.assertIsNone(parse_decimal("abc"))
        self.assertIsNone(parse_decimal("12abc"))

    def test_exactness_is_preserved(self):
        # Decimal, not float: the write-up reconciles totals to the satang.
        self.assertEqual(parse_decimal("0.1") + parse_decimal("0.2"), Decimal("0.3"))

    def test_numeric_passthrough(self):
        self.assertEqual(parse_decimal(1234), Decimal("1234"))
        self.assertEqual(parse_decimal(12.5), Decimal("12.5"))

    def test_booleans_are_never_metrics(self):
        self.assertIsNone(parse_decimal(True))

    def test_parse_int_rounds_formatting_artifacts(self):
        self.assertEqual(parse_int("70,516"), 70516)
        self.assertEqual(parse_int("1,234.0"), 1234)
        self.assertIsNone(parse_int("N/A"))


class TestRowShapes(unittest.TestCase):
    def test_summary_row_is_recognised(self):
        # Ingesting this double-counts every metric in the file.
        self.assertTrue(is_summary_row(["รวมทั้งหมด", "", "", "1,081,585", ""]))
        self.assertTrue(is_summary_row(["Total", "", "17,328"]))

    def test_campaign_named_like_a_total_is_not_a_summary(self):
        self.assertFalse(is_summary_row(["2026-07-01", "รวมสินค้าโปรโมชั่น", "AD - A", "100"]))

    def test_blank_row(self):
        self.assertTrue(is_blank_row(["", "  ", "​"]))
        self.assertFalse(is_blank_row(["", "x"]))


if __name__ == "__main__":
    unittest.main()
