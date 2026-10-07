"""Every file ends committed or quarantined — never as a crash.

Two halves. The reader must turn bytes it cannot decode into the same
`UnreadableFile` every other unreadable file raises, so the DAG's existing
refusal path names it `ENCODING_ERROR`. And anything the parse/validate stages
did not anticipate must still be *classified*, because the DAG refuses the file
with whatever code `dlq.classify_exception` returns.

The byte fixtures are built here, by hand, from one CSV whose rows are written
out literally below — not by running the reader.
"""

from __future__ import annotations

import csv
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dags"))

from buzzly_common import dlq  # noqa: E402
from buzzly_common.reader import UnreadableFile, read_table  # noqa: E402

CSV_TEXT = (
    "วันที่,แคมเปญ,อิมเพรสชัน,คลิก,ค่าใช้จ่าย\n"
    "2026-07-01,โปรเปิดร้าน,1200,34,250.50\n"
    "2026-07-02,โปรเปิดร้าน,980,21,198.00\n"
)
EXPECTED_HEADERS = ["วันที่", "แคมเปญ", "อิมเพรสชัน", "คลิก", "ค่าใช้จ่าย"]
EXPECTED_ROWS = [
    (2, ["2026-07-01", "โปรเปิดร้าน", "1200", "34", "250.50"]),
    (3, ["2026-07-02", "โปรเปิดร้าน", "980", "21", "198.00"]),
]

UTF16_LE = b"\xff\xfe" + CSV_TEXT.encode("utf-16-le")
UTF16_BE = b"\xfe\xff" + CSV_TEXT.encode("utf-16-be")
# A UTF-16 BOM followed by an odd number of bytes: the last code unit is cut in
# half. Same defect as the corpus's fix_13.
UTF16_TRUNCATED = UTF16_LE + b"\x00\x0a\x41"
# One quoted cell over the csv module's 131,072-character field limit. The
# reader does not anticipate it, so it surfaces as `_csv.Error`, not
# `UnreadableFile` — a real file that crashes the parser.
OVERSIZED_FIELD = ("date,campaign\n2026-07-01,\"" + "x" * 200_000 + "\"\n").encode("utf-8")


class Utf16DecodesLikeAnyOtherFile(unittest.TestCase):
    def test_little_endian_with_bom(self):
        table = read_table(UTF16_LE, "export.csv")
        self.assertEqual(table["headers"], EXPECTED_HEADERS)
        self.assertEqual(table["rows"], EXPECTED_ROWS)

    def test_big_endian_with_bom(self):
        table = read_table(UTF16_BE, "export.csv")
        self.assertEqual(table["headers"], EXPECTED_HEADERS)
        self.assertEqual(table["rows"], EXPECTED_ROWS)


class UndecodableBytesAreRefusedNotCrashed(unittest.TestCase):
    def test_truncated_utf16_raises_unreadable_file(self):
        with self.assertRaises(UnreadableFile) as caught:
            read_table(UTF16_TRUNCATED, "broken.csv")
        self.assertEqual(dlq.classify_unreadable(str(caught.exception)), dlq.ENCODING_ERROR)


class ClassifyException(unittest.TestCase):
    """The code the DAG files when a parse/validate stage raises."""

    def test_a_raw_decode_error_is_an_encoding_error(self):
        try:
            b"\xff\xfe\x41".decode("utf-16")
        except UnicodeDecodeError as exc:
            self.assertEqual(dlq.classify_exception(exc), dlq.ENCODING_ERROR)

    def test_an_unreadable_file_keeps_its_message_classification(self):
        self.assertEqual(
            dlq.classify_exception(UnreadableFile("The file is empty (0 bytes).")),
            dlq.EMPTY_PAYLOAD,
        )

    def test_an_unanticipated_parser_error_is_unknown(self):
        with self.assertRaises(Exception) as caught:
            read_table(OVERSIZED_FIELD, "huge.csv")
        self.assertNotIsInstance(caught.exception, UnreadableFile)
        self.assertIsInstance(caught.exception, csv.Error)
        self.assertEqual(dlq.classify_exception(caught.exception), dlq.UNKNOWN)

    def test_any_other_exception_is_unknown(self):
        self.assertEqual(dlq.classify_exception(KeyError("rows")), dlq.UNKNOWN)


if __name__ == "__main__":
    unittest.main()
