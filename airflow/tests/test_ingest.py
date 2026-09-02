"""Tests for header mapping, file reading, typing and row validation.

Two layers. The unit cases pin one rule each. The fixture cases at the bottom
run the real merchant files end to end and assert the numbers the research
write-up quotes — if a change to the cleaning rules moves those, a test says so
rather than the write-up quietly becoming wrong.
"""

from __future__ import annotations

import datetime as dt
import os
import sys
import unittest
from decimal import Decimal
from pathlib import Path

# Self-contained on purpose: `unittest discover` imports these modules in
# alphabetical order, so a module that relied on a sibling to put `dags/` on
# the path would fail or pass depending on its own name.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dags"))

from buzzly_common.mapping import detect_dataset, header_key, map_headers, match_header  # noqa: E402
from buzzly_common.reader import UnreadableFile, detect_format, read_table  # noqa: E402
from buzzly_common.records import build_records  # noqa: E402
from buzzly_common.validate import validate_records  # noqa: E402


def fixtures_root() -> Path | None:
    """Locate ``fixtures/imports`` on the host or inside the container."""
    override = os.environ.get("BUZZLY_FIXTURES_DIR")
    candidates = [
        # Path("") is Path("."), which is always a directory — an unset override
        # would otherwise resolve to the working directory and turn every
        # fixture test into a FileNotFoundError.
        Path(override) if override else None,
        Path("/opt/airflow/fixtures/imports"),
        Path(__file__).resolve().parents[2] / "fixtures" / "imports",
    ]
    for candidate in candidates:
        if candidate is not None and candidate.is_dir():
            return candidate
    return None


FIXTURES = fixtures_root()


def load(name: str, platform: str) -> dict:
    """Run one fixture through the whole read -> map -> type -> validate chain."""
    path = FIXTURES / name
    table = read_table(path.read_bytes(), path.name)
    dataset, mapping = detect_dataset(table["headers"], platform)
    mapping["headers"] = table["headers"]
    records = build_records(table["rows"], mapping)
    result = validate_records(records, dataset)
    return {"table": table, "dataset": dataset, "mapping": mapping, **result}


class TestHeaderMapping(unittest.TestCase):
    def test_parenthetical_gloss_is_not_part_of_the_identity(self):
        self.assertEqual(header_key("Amount spent (THB)"), "amount spent")
        self.assertEqual(header_key("ค่าใช้จ่าย (บาท)"), "ค่าใช้จ่าย")

    def test_same_metric_from_three_platforms(self):
        for header in ("Amount spent (THB)", "Cost (THB)", "ค่าใช้จ่าย (บาท)",
                       "จำนวนเงินที่ใช้จ่าย (฿)"):
            field, how = match_header(header, "ad_performance")
            self.assertEqual(field, "spend", f"{header} -> {field} ({how})")

    def test_thai_and_english_headers_reach_the_same_field(self):
        self.assertEqual(match_header("Impressions", "ad_performance")[0], "impressions")
        self.assertEqual(match_header("การแสดงผล", "ad_performance")[0], "impressions")

    def test_fuzzy_rescues_a_thai_typo(self):
        # A doubled character in a Thai heading is invisible at a glance and
        # makes the string unequal. This is the case fuzzy matching exists for.
        field, how = match_header("การแสดงผผล", "ad_performance")
        self.assertEqual(field, "impressions")
        self.assertEqual(how, "fuzzy")

    def test_abbreviated_english_heading_matches_by_prefix(self):
        self.assertEqual(match_header("Impr.", "ad_performance")[0], "impressions")

    def test_unknown_column_is_reported_not_guessed(self):
        field, how = match_header("หมายเหตุภายในของร้าน", "ad_performance")
        self.assertIsNone(field)
        self.assertEqual(how, "unmatched")

    def test_shopee_fee_columns_stay_distinct(self):
        # These are short, similar Thai strings. Collapsing any two would merge
        # two different fees and silently change the merchant's true profit.
        fields = {
            match_header(header, "shopee_income")[0]
            for header in ("ค่าคอมมิชชั่น", "ค่าธรรมเนียมการทำรายการ", "ค่าบริการ",
                           "ค่าจัดส่งที่ผู้ขายรับผิดชอบ")
        }
        self.assertEqual(
            fields, {"commission_fee", "transaction_fee", "service_fee", "shipping_fee"}
        )

    def test_duplicate_heading_is_a_conflict_not_an_overwrite(self):
        mapping = map_headers(["Date", "Impressions", "Impressions"], "ad_performance")
        self.assertEqual(mapping["columns"]["impressions"], 1)
        self.assertEqual(len(mapping["conflicts"]), 1)

    def test_missing_required_columns_are_reported(self):
        mapping = map_headers(["Impressions", "Clicks"], "ad_performance")
        self.assertEqual(sorted(mapping["missing_required"]), ["campaign_name", "date"])

    def test_mapping_is_by_name_not_position(self):
        # The dirty Meta export drops "Delivery status", shifting every later
        # column. A positional parser reads reach as impressions here.
        shifted = ["วันที่", "ชื่อแคมเปญ", "การแสดงผล", "การเข้าถึง"]
        mapping = map_headers(shifted, "ad_performance")
        self.assertEqual(mapping["columns"]["impressions"], 2)
        self.assertEqual(mapping["columns"]["reach"], 3)

    def test_dataset_detection_trusts_columns_over_declared_platform(self):
        # Merchant picks the wrong report type; the columns are the evidence.
        headers = ["SKU", "ชื่อสินค้า", "ต้นทุนสินค้าต่อชิ้น", "ราคาขายตั้งต้น"]
        dataset, _ = detect_dataset(headers, platform="shopee_income")
        self.assertEqual(dataset, "product_cogs")


class TestFileReading(unittest.TestCase):
    def test_xlsx_detected_from_magic_bytes_not_extension(self):
        self.assertEqual(detect_format(b"PK\x03\x04rest", "report.csv"), "xlsx")

    def test_legacy_xls_gets_an_actionable_message(self):
        with self.assertRaises(UnreadableFile) as caught:
            detect_format(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "old.xls")
        self.assertIn(".xlsx", str(caught.exception))

    def test_empty_file_fails_cleanly(self):
        with self.assertRaises(UnreadableFile):
            detect_format(b"", "empty.csv")

    def test_cp874_thai_is_not_mistaken_for_latin1(self):
        # Decoded as Latin-1 this produces mojibake and "succeeds", mapping
        # nothing. The encoding order is the only thing preventing that.
        data = "วันที่,ชื่อแคมเปญ\n18/07/2569,ทดสอบ\n".encode("cp874")
        table = read_table(data, "thai.csv")
        self.assertEqual(table["headers"], ["วันที่", "ชื่อแคมเปญ"])

    def test_semicolon_delimiter(self):
        table = read_table(b"Date;Campaign name\n2026-07-01;A\n", "eu.csv")
        self.assertEqual(table["delimiter"], ";")
        self.assertEqual(table["headers"], ["Date", "Campaign name"])

    def test_header_below_a_title_block(self):
        data = b"Shopee Ads Report\n\nDate,Campaign name\n2026-07-01,A\n"
        table = read_table(data, "titled.csv")
        self.assertEqual(table["header_row"], 3)
        self.assertEqual(table["headers"], ["Date", "Campaign name"])

    def test_blank_and_summary_rows_are_furniture_not_rejects(self):
        data = (
            "Date,Campaign name,Impressions\n"
            "2026-07-01,A,100\n"
            "\n"
            "รวมทั้งหมด,,100\n"
        ).encode()
        table = read_table(data, "totals.csv")
        self.assertEqual(len(table["rows"]), 1)
        self.assertEqual(table["blank_rows"], 1)
        self.assertEqual(table["summary_rows"], 1)


class TestValidation(unittest.TestCase):
    def _validate(self, headers, rows, dataset="ad_performance"):
        mapping = map_headers(headers, dataset)
        mapping["headers"] = headers
        numbered = list(enumerate(rows, start=2))
        return validate_records(build_records(numbered, mapping), dataset)

    HEADERS = ["Reporting starts", "Campaign name", "Ad name", "Impressions",
               "Link clicks", "Amount spent (THB)", "Results"]

    def test_clean_row_is_accepted(self):
        result = self._validate(self.HEADERS,
                                [["2026-07-01", "A", "AD", "10000", "160", "496.00", "7"]])
        self.assertEqual(result["counts"]["rows_ok"], 1)

    def test_empty_optional_cell_does_not_reject_the_row(self):
        # The dirty fixture's first row has no Results and no cost per result.
        result = self._validate(self.HEADERS,
                                [["2026-07-01", "A", "AD", "10000", "160", "496.00", ""]])
        self.assertEqual(result["counts"]["rows_ok"], 1)

    def test_unreadable_number_is_rejected_not_read_as_zero(self):
        result = self._validate(self.HEADERS,
                                [["2026-07-01", "A", "AD", "10000", "N/A", "496.00", "7"]])
        self.assertEqual(result["counts"]["rows_quarantined"], 1)
        codes = {p["error_code"] for p in result["rejected"][0]["problems"]}
        self.assertIn("unreadable_number", codes)

    def test_missing_required_field(self):
        result = self._validate(self.HEADERS,
                                [["", "A", "AD", "10000", "160", "496.00", "7"]])
        codes = {p["error_code"] for p in result["rejected"][0]["problems"]}
        self.assertIn("missing_required", codes)

    def test_negative_metric(self):
        result = self._validate(self.HEADERS,
                                [["2026-07-01", "A", "AD", "-5000", "100", "310.00", "4"]])
        codes = {p["error_code"] for p in result["rejected"][0]["problems"]}
        self.assertIn("negative_value", codes)

    def test_clicks_cannot_exceed_impressions(self):
        result = self._validate(self.HEADERS,
                                [["2026-07-01", "A", "AD", "800", "1200", "372.00", "3"]])
        codes = {p["error_code"] for p in result["rejected"][0]["problems"]}
        self.assertIn("clicks_exceed_impressions", codes)

    def test_integer_beyond_the_column_is_rejected_here_not_at_the_promote(self):
        # 99,999,999,999 impressions parses, is positive, and is coherent with
        # its clicks, so every existing rule passes it. `ad_insights.impressions`
        # is int4: unstopped it reaches `promote_batch` and raises 22003 there,
        # after the stage that would have told the merchant which cell to fix.
        result = self._validate(
            self.HEADERS,
            [["2026-07-01", "A", "AD", "99999999999", "160", "496.00", "7"]])
        self.assertEqual(result["counts"]["rows_quarantined"], 1)
        problem = result["rejected"][0]["problems"][0]
        self.assertEqual(problem["error_code"], "value_out_of_range")
        self.assertEqual(problem["column_name"], "impressions")

    def test_the_largest_storable_integer_is_still_accepted(self):
        # int4 max exactly. The ceiling must not cost a row the column can hold.
        result = self._validate(
            self.HEADERS,
            [["2026-07-01", "A", "AD", "2147483647", "160", "496.00", "7"]])
        self.assertEqual(result["counts"]["rows_ok"], 1)

    def test_spend_beyond_numeric_15_2_is_rejected(self):
        result = self._validate(
            self.HEADERS,
            [["2026-07-01", "A", "AD", "10000", "160", "99999999999999.00", "7"]])
        codes = {p["error_code"] for p in result["rejected"][0]["problems"]}
        self.assertIn("value_out_of_range", codes)

    def test_a_large_negative_is_out_of_range_as_well_as_negative(self):
        # `revenue` has no floor (Shopee refunds are real), so magnitude is the
        # only thing standing between a junk cell and 22003 at the promote.
        result = self._validate(
            self.HEADERS + ["Conversion value"],
            [["2026-07-01", "A", "AD", "10000", "160", "496.00", "7",
              "-99999999999999.00"]])
        codes = {p["error_code"] for p in result["rejected"][0]["problems"]}
        self.assertIn("value_out_of_range", codes)

    def test_short_row_is_fatal(self):
        result = self._validate(self.HEADERS, [["2026-07-08", "Short", "AD - F"]])
        codes = {p["error_code"] for p in result["rejected"][0]["problems"]}
        self.assertIn("short_row", codes)

    def test_repeated_row_is_kept_once(self):
        row = ["2026-07-07", "A", "AD - Good2", "10500", "170", "527.00", "7"]
        result = self._validate(self.HEADERS, [row, list(row)])
        self.assertEqual(result["counts"]["rows_ok"], 1)
        self.assertEqual(result["counts"]["rows_quarantined"], 1)
        codes = {p["error_code"] for p in result["rejected"][0]["problems"]}
        self.assertIn("duplicate_row", codes)

    def test_every_reason_is_reported_not_just_the_first(self):
        result = self._validate(self.HEADERS,
                                [["2026-07-01", "A", "AD", "-5000", "100", "N/A", "4"]])
        codes = {p["error_code"] for p in result["rejected"][0]["problems"]}
        self.assertEqual(codes, {"negative_value", "unreadable_number"})

    def test_counts_always_balance(self):
        rows = [
            ["2026-07-01", "A", "AD", "10000", "160", "496.00", "7"],
            ["", "B", "AD", "10000", "160", "496.00", "7"],
            ["2026-07-03", "C", "AD", "800", "1200", "496.00", "7"],
        ]
        counts = self._validate(self.HEADERS, rows)["counts"]
        self.assertEqual(counts["rows_ok"] + counts["rows_quarantined"], counts["rows_total"])


@unittest.skipIf(FIXTURES is None, "fixtures/imports not available")
class TestAgainstRealFixtures(unittest.TestCase):
    """End-to-end over the merchant files. These numbers back the write-up."""

    def test_clean_meta_export_is_fully_ingested(self):
        result = load("meta/ads-export-clean.csv", "meta")
        self.assertEqual(result["counts"], {"rows_total": 150, "rows_ok": 150,
                                            "rows_quarantined": 0, "by_reason": {}})
        self.assertEqual(result["mapping"]["unmapped"], [])

    def test_dirty_thai_export_is_fully_recovered(self):
        """The headline result: the messy file loses nothing.

        Same 30 rows as a clean export, through a UTF-8 BOM, two Buddhist-era
        date formats, ``฿`` symbols, thousands separators, non-breaking spaces,
        a blank line and a ``รวมทั้งหมด`` totals row.
        """
        result = load("meta/ads-export-thai-dirty.csv", "meta")
        self.assertEqual(result["counts"]["rows_total"], 30)
        self.assertEqual(result["counts"]["rows_ok"], 30)
        self.assertEqual(result["counts"]["rows_quarantined"], 0)
        self.assertEqual(result["mapping"]["unmapped"], [])
        # Every column matched the dictionary outright; nothing needed fuzzy.
        self.assertEqual(set(result["mapping"]["match_methods"].values()), {"exact"})
        self.assertEqual(result["table"]["blank_rows"], 2)
        self.assertEqual(result["table"]["summary_rows"], 1)

    def test_dirty_export_totals_match_the_files_own_summary_row(self):
        """Independent proof the numbers are right, not merely present.

        The ``รวมทั้งหมด`` row states the file's totals. It is excluded from
        ingestion, which makes it a free check on everything above it.
        """
        result = load("meta/ads-export-thai-dirty.csv", "meta")
        impressions = sum(record["values"]["impressions"] for record in result["ok"])
        self.assertEqual(impressions, 1_081_585)
        spend = sum(record["values"]["spend"] for record in result["ok"])
        # The summary row says ฿53,988.57; per-row values are rounded to two
        # decimals by the exporter, so the sum lands 0.03 under. Asserted as a
        # tolerance rather than fudged, because the gap is the file's, not ours.
        self.assertLess(abs(spend - Decimal("53988.57")), Decimal("0.05"))

    def test_dirty_and_clean_agree_on_the_days_they_share(self):
        """The strongest available check: two encodings of the same six days.

        ``ads-export-thai-dirty.csv`` covers 18-23 July, which the clean export
        also covers. If the cleaning is correct the two must agree exactly.
        """
        clean = {(r["values"]["date"], r["values"]["campaign_name"]):
                 r["values"]["impressions"] for r in load("meta/ads-export-clean.csv", "meta")["ok"]}
        dirty = load("meta/ads-export-thai-dirty.csv", "meta")["ok"]
        compared = 0
        for record in dirty:
            key = (record["values"]["date"], record["values"]["campaign_name"])
            if key in clean:
                self.assertEqual(record["values"]["impressions"], clean[key], key)
                compared += 1
        self.assertEqual(compared, 30)

    def test_shopee_income_report_parses_every_line(self):
        result = load("shopee/income-report.csv", "shopee_income")
        self.assertEqual(result["dataset"], "shopee_income")
        self.assertEqual(result["counts"]["rows_total"], 3458)
        self.assertEqual(result["counts"]["rows_quarantined"], 0)
        # The four fee columns the wedge depends on all resolved.
        for field in ("commission_fee", "transaction_fee", "service_fee", "shipping_fee"):
            self.assertIn(field, result["mapping"]["columns"])

    def test_shopee_income_totals_are_exact(self):
        """Gross and the four fees, cross-checked against an independent sum.

        These figures were verified with ``awk`` straight over the raw file, so
        they test the parser rather than restating it. NB they do **not** match
        the totals block in ``fixtures/imports/README.md``, which describes an
        earlier generation of the file — the data is right, that prose is stale.
        """
        result = load("shopee/income-report.csv", "shopee_income")
        gross = sum(record["values"]["buyer_paid"] for record in result["ok"])
        self.assertEqual(gross, Decimal("2863986.00"))

        fees = sum(
            record["values"][field] or Decimal(0)
            for record in result["ok"]
            for field in ("commission_fee", "transaction_fee", "service_fee", "shipping_fee")
        )
        self.assertEqual(fees, Decimal("327838.56"))

    def test_cogs_sheet(self):
        result = load("shopee/products-cogs.csv", "cogs")
        self.assertEqual(result["dataset"], "product_cogs")
        self.assertEqual(result["counts"]["rows_ok"], 7)

    def test_tiktok_and_shopee_ads_map_to_the_same_dataset(self):
        for name, platform in (("tiktok/ads-export.csv", "tiktok"),
                               ("shopee/ads-report.csv", "shopee_ads")):
            result = load(name, platform)
            self.assertEqual(result["dataset"], "ad_performance", name)
            self.assertEqual(result["counts"]["rows_quarantined"], 0, name)

    def test_broken_rows_are_quarantined_individually(self):
        """One defect per row; the good rows still land — this is `partial`."""
        result = load("edge-cases/broken-rows.csv", "meta")
        self.assertEqual(result["counts"]["rows_total"], 10)
        self.assertEqual(result["counts"]["rows_ok"], 3)
        self.assertEqual(result["counts"]["rows_quarantined"], 7)
        self.assertEqual(
            set(result["counts"]["by_reason"]),
            {"missing_required", "unreadable_date", "negative_value",
             "clicks_exceed_impressions", "unreadable_number", "duplicate_row", "short_row"},
        )

    def test_headers_only_file_succeeds_with_no_rows(self):
        result = load("edge-cases/headers-only.csv", "meta")
        self.assertEqual(result["counts"]["rows_total"], 0)

    def test_empty_file_is_rejected_with_a_useful_message(self):
        with self.assertRaises(UnreadableFile):
            load("edge-cases/empty.csv", "meta")

    def test_dates_land_in_the_expected_window(self):
        result = load("meta/ads-export-clean.csv", "meta")
        dates = {record["values"]["date"] for record in result["ok"]}
        self.assertEqual(min(dates), dt.date(2026, 6, 24))
        self.assertEqual(max(dates), dt.date(2026, 7, 23))


if __name__ == "__main__":
    unittest.main()
