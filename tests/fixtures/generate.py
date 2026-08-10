#!/usr/bin/env python3
"""Generate the frozen fixture corpus for the ingestion KPI harness.

    python3 tests/fixtures/generate.py

Deterministic: fixed seed, fixed date window, no clock reads. Regenerating
produces byte-identical files, which is what lets a KPI measured today be
re-measured in six months and compared.

What is in here, and why it is split three ways
-----------------------------------------------
``valid/``      20 ad-performance files that must ingest. KPI-2's denominator.
``malformed/``  13 files that must be refused. KPI-3's denominator is the first
                12; ``fix_13`` is a known failure, excluded from the score and
                documented instead (see MANIFEST.md).
``aux/``        Files that parse cleanly but have no target table yet. Not part
                of either KPI — a file that succeeds while storing nothing is
                not an ingestion success.

The expectations are DECLARED, not derived
------------------------------------------
``EXPECTATIONS`` below is hand-written intent: what each file *should* do,
decided by reading the pipeline's rules, never by running it. ``MANIFEST.md`` is
rendered from it and the test harness asserts against the manifest. If the
expectations were instead computed by running the pipeline, the harness would be
asserting that the pipeline agrees with itself, which measures nothing.

Money is generated as ``Decimal`` and rendered to text. No float ever touches a
figure in these files.
"""

from __future__ import annotations

import csv
import io
import json
import random
import shutil
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VALID = ROOT / "valid"
MALFORMED = ROOT / "malformed"
AUX = ROOT / "aux"

SEED = 20260810
# Anchored so output never drifts with the real clock.
START_DAY = (2026, 7, 1)
BE_OFFSET = 543

# The export-time banner some platforms write above the table. A real
# Asia/Bangkok timestamp, in a file that must still ingest — see the note on
# L-1 in MANIFEST.md for why it cannot live in the date column.
ICT_STAMPS = (
    "2026-07-24T09:30:00+07:00",
    "2026-07-24T18:05:42+07:00",
    "2026-07-25T07:15:09+07:00",
)

THAI_MONTH_ABBR = ("ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
                   "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.")

# ── the data behind every file ────────────────────────────────────────────────

CAMPAIGNS = (
    ("Summer Sale - Skincare", "แคมเปญลดราคาหน้าร้อน - สกินแคร์"),
    ("Always On - Supplements", "ตลอดปี - อาหารเสริม"),
    ("Flash Deal - Haircare", "ดีลสายฟ้าแลบ - ผลิตภัณฑ์ดูแลผม"),
    ("Retargeting - Cart Abandoners", "รีทาร์เก็ต - ลูกค้าทิ้งตะกร้า"),
    ("Brand Awareness - TH Wide", "สร้างการรับรู้แบรนด์ - ทั่วประเทศ"),
)
AD_SETS = (
    ("AS - Skincare Broad TH 25-44", "ชุดโฆษณา - สกินแคร์ ทั่วไป 25-44"),
    ("AS - Collagen Lookalike 1%", "ชุดโฆษณา - คอลลาเจน กลุ่มคล้าย 1%"),
    ("AS - Haircare Interest Stack", "ชุดโฆษณา - ดูแลผม ตามความสนใจ"),
)
ADS = (
    ("AD - Serum Carousel", "โฆษณา - เซรั่ม ภาพหมุน"),
    ("AD - Collagen Video", "โฆษณา - คอลลาเจน วิดีโอ"),
    ("AD - Shampoo Static", "โฆษณา - แชมพู ภาพนิ่ง"),
    ("AD - Bundle Offer", "โฆษณา - ชุดสุดคุ้ม"),
)


@dataclass
class Row:
    """One ad-performance record, before any locale is applied to it."""
    day: int
    campaign: tuple[str, str]
    ad_set: tuple[str, str]
    ad: tuple[str, str]
    impressions: int
    reach: int
    clicks: int
    results: int
    spend: Decimal
    ctr: Decimal
    cpc: Decimal
    cpm: Decimal
    cost_per_result: Decimal
    roas: Decimal
    note: str = ""


def make_rows(rng: random.Random, count: int, *, start_day: int = 1) -> list[Row]:
    """A run of plausible rows whose identity tuple is unique by construction.

    ``validate`` treats (date, campaign, ad set, ad) as a row's identity, so a
    repeat inside a file is a rejected duplicate. Cycling the three name pools
    against an advancing day keeps every valid fixture clear of that.
    """
    rows: list[Row] = []
    for index in range(count):
        day = start_day + index // 4
        campaign = CAMPAIGNS[index % len(CAMPAIGNS)]
        ad_set = AD_SETS[(index // 2) % len(AD_SETS)]
        ad = ADS[index % len(ADS)]

        impressions = rng.randrange(8_000, 90_000)
        reach = int(impressions * rng.uniform(0.55, 0.78))
        clicks = rng.randrange(int(impressions * 0.008), int(impressions * 0.031))
        results = max(1, int(clicks * rng.uniform(0.03, 0.09)))

        # Money is built from integer satang so the arithmetic is exact.
        spend = (Decimal(rng.randrange(35_000, 480_000)) / Decimal(100)).quantize(Decimal("0.01"))
        ctr = (Decimal(clicks * 10_000) / Decimal(impressions) / Decimal(100)).quantize(Decimal("0.01"))
        cpc = (spend / Decimal(clicks)).quantize(Decimal("0.01"))
        cpm = (spend * Decimal(1000) / Decimal(impressions)).quantize(Decimal("0.01"))
        cost_per_result = (spend / Decimal(results)).quantize(Decimal("0.01"))
        roas = (Decimal(rng.randrange(300, 1800)) / Decimal(100)).quantize(Decimal("0.01"))

        rows.append(Row(day, campaign, ad_set, ad, impressions, reach, clicks,
                        results, spend, ctr, cpc, cpm, cost_per_result, roas))
    return rows


# ── locale rendering ──────────────────────────────────────────────────────────


def iso_date(day: int) -> str:
    return f"2026-07-{day:02d}"


def be_slash_date(day: int) -> str:
    return f"{day:02d}/07/{2026 + BE_OFFSET}"


def th_month_date(day: int) -> str:
    return f"{day} {THAI_MONTH_ABBR[6]} {2026 + BE_OFFSET}"


def thousands(value: int) -> str:
    return f"{value:,}"


def money_plain(value: Decimal) -> str:
    return f"{value:.2f}"


def money_baht_symbol(value: Decimal) -> str:
    return f"฿{value:,.2f}"


def money_baht_word(value: Decimal) -> str:
    return f"{value:,.2f} บาท"


@dataclass
class Profile:
    """A header vocabulary plus how each row is rendered under it.

    Every vocabulary here is copied from a fixture already proven to map in
    ``airflow/tests/test_ingest.py`` — inventing synonyms would test the header
    dictionary rather than the pipeline.
    """
    headers: list[str]
    render: object
    thai_names: bool = False


def meta_en_row(row: Row, *, dates=iso_date, ints=str, money=money_plain) -> list[str]:
    return [
        dates(row.day), dates(row.day),
        row.campaign[0], row.ad_set[0], row.ad[0], "active",
        ints(row.impressions), ints(row.reach), ints(row.clicks),
        f"{row.ctr:.2f}", money(row.cpc), money(row.cpm), money(row.spend),
        str(row.results), money(row.cost_per_result), f"{row.roas:.2f}",
    ]


META_EN = Profile(
    headers=["Reporting starts", "Reporting ends", "Campaign name", "Ad set name",
             "Ad name", "Delivery status", "Impressions", "Reach", "Link clicks",
             "CTR (link click-through rate)", "CPC (cost per link click)",
             "CPM (cost per 1,000 impressions)", "Amount spent (THB)", "Results",
             "Cost per result", "Purchase ROAS (return on ad spend)"],
    render=meta_en_row,
)


def meta_th_row(row: Row, *, dates=be_slash_date, ints=thousands,
                money=money_baht_symbol) -> list[str]:
    return [
        dates(row.day), dates(row.day),
        row.campaign[1], row.ad_set[1], row.ad[1],
        ints(row.impressions), ints(row.reach), ints(row.clicks),
        f"{row.ctr:.2f}", money(row.cpc), money(row.cpm), money(row.spend),
        str(row.results), money(row.cost_per_result), f"{row.roas:.2f}",
    ]


META_TH = Profile(
    headers=["วันที่เริ่มต้น", "วันที่สิ้นสุด", "ชื่อแคมเปญ", "ชื่อชุดโฆษณา", "ชื่อโฆษณา",
             "การแสดงผล", "การเข้าถึง", "คลิกลิงก์", "อัตราการคลิกผ่าน (%)",
             "ราคาต่อคลิก", "ราคาต่อการแสดงผล 1,000 ครั้ง", "จำนวนเงินที่ใช้จ่าย (฿)",
             "ผลลัพธ์", "ต้นทุนต่อผลลัพธ์", "ROAS"],
    render=meta_th_row,
    thai_names=True,
)


def tiktok_row(row: Row, *, dates=iso_date, ints=str, money=money_plain) -> list[str]:
    return [
        dates(row.day), f"TT {row.campaign[0]}", f"AG {row.ad_set[0]}", f"TT {row.ad[0]}",
        ints(row.impressions), ints(row.clicks), f"{row.ctr:.2f}",
        money(row.cpc), money(row.cpm), money(row.spend),
        str(row.results), money(row.cost_per_result), f"{row.roas:.2f}",
    ]


TIKTOK = Profile(
    headers=["Date", "Campaign name", "Ad group name", "Ad name", "Impressions",
             "Clicks", "CTR (%)", "CPC (THB)", "CPM (THB)", "Cost (THB)",
             "Conversions", "Cost per conversion (THB)", "Complete payment ROAS"],
    render=tiktok_row,
)


def shopee_ads_row(row: Row, *, dates=be_slash_date, ints=str,
                   money=money_baht_word) -> list[str]:
    # Campaign-level: no ad column at all, so identity is (date, campaign).
    # One campaign per day keeps that unique.
    return [
        dates(row.day), row.campaign[1], "โฆษณาค้นหาสินค้า",
        ints(row.impressions), ints(row.clicks), f"{row.ctr:.2f}",
        money(row.spend), str(row.results),
        money(row.spend * row.roas), f"{row.roas:.2f}",
    ]


SHOPEE_ADS = Profile(
    headers=["วันที่", "ชื่อแคมเปญ", "ประเภทโฆษณา", "การแสดงผล", "คลิก", "CTR (%)",
             "ค่าใช้จ่าย (บาท)", "จำนวนคำสั่งซื้อ", "ยอดขายจากโฆษณา (บาท)", "ROAS"],
    render=shopee_ads_row,
    thai_names=True,
)


def minimal_row(row: Row, *, dates=iso_date, ints=str, money=money_plain) -> list[str]:
    return [dates(row.day), row.campaign[0], row.ad[0],
            ints(row.impressions), ints(row.clicks), money(row.spend), str(row.results)]


MINIMAL = Profile(
    headers=["Reporting starts", "Campaign name", "Ad name", "Impressions",
             "Link clicks", "Amount spent (THB)", "Results"],
    render=minimal_row,
)


# ── writing ───────────────────────────────────────────────────────────────────


def to_csv(header: list[str], rows: list[list[str]], *, delimiter: str = ",",
           newline: str = "\r\n", banner: list[str] | None = None) -> str:
    """Render a table exactly as a spreadsheet would write it.

    CRLF is the default because Excel writes CRLF; the files that test LF do so
    deliberately.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=delimiter, lineterminator=newline,
                        quoting=csv.QUOTE_MINIMAL)
    for line in banner or []:
        writer.writerow([line])
    writer.writerow(header)
    writer.writerows(rows)
    return buffer.getvalue()


def write(path: Path, text: str, *, encoding: str = "utf-8", bom: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = text.encode(encoding)
    if bom:
        data = b"\xef\xbb\xbf" + data
    path.write_bytes(data)


# ── the declared expectations ─────────────────────────────────────────────────
#
# Hand-written intent. Nothing below is computed by running the pipeline.


@dataclass
class Expectation:
    filename: str
    group: str            # valid | malformed | aux
    what: str             # what the file simulates
    job_status: str       # succeeded | failed
    dlq_code: str | None  # expected ingestion_dlq.error_code, or None for no row
    ingests: bool         # must this file put rows in the fact tables?
    # What the merchant picked on /imports. Goes on the import_jobs row, so the
    # harness needs it — but it is an **input**, never an assertion. There is
    # nothing in the bytes to derive a platform from, so "derive it and check it
    # matches" is not available, and asserting the value we ourselves supplied
    # would only prove the harness can remember its own argument.
    platform: str = "meta"
    # What the *file* is, which the pipeline decides for itself:
    # `detect_dataset(headers, platform)` scores the header row against each
    # candidate schema and uses `platform` only to break a tie
    # (`mapping.py:284-296`). This IS asserted, and it is what closes the hole
    # the unasserted platform would otherwise leave: a wrong platform shows up
    # as the file resolving to an unexpected dataset. `None` means the run never
    # gets as far as `clean_thai`, so no dataset is ever resolved.
    dataset: str | None = "ad_performance"
    scored: bool = True   # counts toward a KPI denominator
    notes: str = ""
    depends_on: str | None = None
    reset_before: bool = True


EXPECTATIONS: list[Expectation] = []


def declare(**kwargs) -> Expectation:
    expectation = Expectation(**kwargs)
    EXPECTATIONS.append(expectation)
    return expectation


# ── build ─────────────────────────────────────────────────────────────────────


def build_valid() -> None:
    rng = random.Random(SEED)

    def emit(name: str, what: str, text: str, *, encoding: str = "utf-8",
             bom: bool = False, notes: str = "", platform: str = "meta") -> None:
        write(VALID / name, text, encoding=encoding, bom=bom)
        # Every valid file is an ad export by construction, whichever platform
        # wrote it — that is what makes them KPI-2's denominator.
        declare(filename=f"valid/{name}", group="valid", what=what, platform=platform,
                job_status="succeeded", dlq_code=None, ingests=True,
                dataset="ad_performance", notes=notes)

    # 01 — the plain baseline. ok_20 is a byte-identical copy of this file.
    rows = make_rows(rng, 12)
    emit("ok_01_meta_en_iso_plain.csv",
         "Meta export, English headers, ISO dates, undecorated THB",
         to_csv(META_EN.headers, [meta_en_row(r) for r in rows]))

    # 02 — Thai headings, Buddhist-era slash dates, ฿ and thousands separators.
    rows = make_rows(rng, 12)
    emit("ok_02_meta_th_be_slash_baht.csv",
         "Thai Excel save: Thai headings, 01/07/2569 dates, ฿1,234.56 money",
         to_csv(META_TH.headers, [meta_th_row(r) for r in rows]))

    # 03 — Thai month-name dates, the other BE form.
    rows = make_rows(rng, 12)
    emit("ok_03_meta_th_month_name.csv",
         "Thai month-abbreviation dates (1 ก.ค. 2569)",
         to_csv(META_TH.headers,
                [meta_th_row(r, dates=th_month_date) for r in rows]))

    # 04 — a second platform's vocabulary.
    rows = make_rows(rng, 12)
    emit("ok_04_tiktok_iso.csv", "TikTok Ads export, different headings, ISO dates",
         to_csv(TIKTOK.headers, [tiktok_row(r) for r in rows]), platform="tiktok")

    # 05 — campaign-level file with no ad column, money as "952.45 บาท".
    rows = make_rows(rng, 10)
    for index, row in enumerate(rows):      # one campaign per day: identity is (date, campaign)
        row.day = 1 + index
        row.campaign = CAMPAIGNS[index % len(CAMPAIGNS)]
    emit("ok_05_shopee_ads_baht_word.csv",
         "Shopee Ads report, campaign-level, money suffixed 'บาท'",
         to_csv(SHOPEE_ADS.headers, [shopee_ads_row(r) for r in rows]),
         platform="shopee_ads")

    # 06 — the seven-column minimum.
    rows = make_rows(rng, 10)
    emit("ok_06_minimal_columns.csv", "Only the columns the pipeline actually requires",
         to_csv(MINIMAL.headers, [minimal_row(r) for r in rows]))

    # 07 — UTF-8 BOM, which Excel writes on every "CSV UTF-8" save.
    rows = make_rows(rng, 12)
    emit("ok_07_meta_en_utf8_bom.csv", "UTF-8 BOM ahead of English headers",
         to_csv(META_EN.headers, [meta_en_row(r) for r in rows]), bom=True)

    # 08 — BOM + invisible whitespace + an unmapped Asia/Bangkok timestamp column.
    rows = make_rows(rng, 12)
    headers = [*META_TH.headers, "เวลาที่ดึงข้อมูล (ICT)"]
    body = []
    for index, row in enumerate(rows):
        cells = meta_th_row(row)
        # A non-breaking space and a zero-width space inside Thai text, exactly
        # as a copy-paste out of a browser leaves them.
        cells[2] = cells[2] + " "
        cells[4] = "​" + cells[4]
        body.append([*cells, ICT_STAMPS[index % len(ICT_STAMPS)]])
    emit("ok_08_thai_invisibles_ict_column.csv",
         "BOM, NBSP/zero-width inside Thai names, unmapped Asia/Bangkok timestamp column",
         to_csv(headers, body), bom=True,
         notes="Asia/Bangkok timestamps live in an unmapped column — see L-1.")

    # 09 — semicolon delimiter, the European Excel default.
    rows = make_rows(rng, 10)
    emit("ok_09_semicolon_delimiter.csv", "Semicolon-delimited export",
         to_csv(META_EN.headers, [meta_en_row(r) for r in rows], delimiter=";"))

    # 10 — tab delimiter.
    rows = make_rows(rng, 10)
    emit("ok_10_tab_delimiter.csv", "Tab-delimited export saved with a .csv name",
         to_csv(META_EN.headers, [meta_en_row(r) for r in rows], delimiter="\t"))

    # 11 — a title block with an Asia/Bangkok export stamp above the header.
    rows = make_rows(rng, 12)
    emit("ok_11_title_banner_ict.csv",
         "Two-line export banner carrying an Asia/Bangkok timestamp above the table",
         to_csv(META_EN.headers, [meta_en_row(r) for r in rows],
                banner=["Buzzly Ads Performance Export", f"Generated {ICT_STAMPS[0]}"]),
         notes="Banner lines must be skipped by the header scan, not ingested.")

    # 12 — furniture: blank spacers and a รวมทั้งหมด totals row.
    rows = make_rows(rng, 10)
    body = [meta_th_row(r) for r in rows]
    totals = ["รวมทั้งหมด", "", "", "", "",
              thousands(sum(r.impressions for r in rows)),
              thousands(sum(r.reach for r in rows)),
              thousands(sum(r.clicks for r in rows)),
              "", "", "", money_baht_symbol(sum((r.spend for r in rows), Decimal(0))),
              str(sum(r.results for r in rows)), "", ""]
    emit("ok_12_blank_and_totals_rows.csv",
         "Blank spacer lines and a รวมทั้งหมด totals row that must be dropped",
         to_csv(META_TH.headers, [*body[:5], [""] * 15, *body[5:], [""] * 15, totals]),
         notes="Totals row is furniture; ingesting it would double-count the file.")

    # 13 — cp874, the legacy Thai Windows codepage.
    rows = make_rows(rng, 10)
    emit("ok_13_cp874_thai.csv", "Thai text in cp874, not UTF-8",
         to_csv(META_TH.headers, [meta_th_row(r) for r in rows]), encoding="cp874")

    # 14 — the merchant's own extra columns, which must be ignored not guessed.
    rows = make_rows(rng, 12)
    headers = [*MINIMAL.headers, "หมายเหตุภายในของร้าน", "Synced at (ICT)"]
    body = [[*minimal_row(r), "ตรวจสอบแล้ว", ICT_STAMPS[i % len(ICT_STAMPS)]]
            for i, r in enumerate(rows)]
    emit("ok_14_unmapped_extra_columns.csv",
         "Two columns the dictionary does not know, incl. an Asia/Bangkok timestamp",
         to_csv(headers, body))

    # 15 — empty optional cells. Absent is a fact, not a defect.
    rows = make_rows(rng, 12)
    body = []
    for index, row in enumerate(rows):
        cells = meta_en_row(row)
        if index % 3 == 0:
            cells[13] = ""      # Results
            cells[14] = ""      # Cost per result
        if index % 4 == 0:
            cells[15] = ""      # ROAS
        body.append(cells)
    emit("ok_15_empty_optional_cells.csv", "Blank optional metrics — absent, not unreadable",
         to_csv(META_EN.headers, body))

    # 16 — the only large file, so throughput is measured on something real.
    rows = make_rows(rng, 120)
    emit("ok_16_large_120_rows.csv", "120 data rows",
         to_csv(META_EN.headers, [meta_en_row(r) for r in rows]))

    # 17 — bare LF, as written by a Mac or a script rather than Excel.
    rows = make_rows(rng, 10)
    emit("ok_17_lf_line_endings.csv", "Unix LF line endings",
         to_csv(META_EN.headers, [meta_en_row(r) for r in rows], newline="\n"))

    # 18 — commas inside quoted Thai names.
    rows = make_rows(rng, 10)
    body = []
    for row in rows:
        cells = meta_th_row(row)
        cells[2] = f"{row.campaign[1]}, กรุงเทพฯ และปริมณฑล"
        body.append(cells)
    emit("ok_18_quoted_commas_in_thai.csv",
         "Quoted Thai campaign names containing commas",
         to_csv(META_TH.headers, body))

    # 19 — three date formats inside one file, which real merged exports have.
    rows = make_rows(rng, 12)
    formats = (iso_date, be_slash_date, th_month_date)
    body = [meta_th_row(r, dates=formats[i % 3]) for i, r in enumerate(rows)]
    emit("ok_19_mixed_date_formats.csv", "ISO, BE-slash and Thai-month dates in one file",
         to_csv(META_TH.headers, body))

    # 20 — the duplicate. Byte-identical to ok_01 by construction, not by luck.
    twin = VALID / "ok_01_meta_en_iso_plain.csv"
    duplicate = VALID / "ok_20_duplicate_of_ok_01.csv"
    shutil.copyfile(twin, duplicate)
    assert duplicate.read_bytes() == twin.read_bytes()
    declare(
        filename="valid/ok_20_duplicate_of_ok_01.csv", group="valid",
        what="Byte-identical re-upload of ok_01 — the DUPLICATE_BATCH case",
        job_status="succeeded", dlq_code="DUPLICATE_BATCH", ingests=False,
        # `hash_dedupe` short-circuits this run before `clean_thai`, so no
        # dataset is ever resolved. Declaring `ad_performance` here would assert
        # a fact about a stage that deliberately did not run.
        dataset=None,
        depends_on="valid/ok_01_meta_en_iso_plain.csv", reset_before=False,
        notes=("Successful no-op: succeeds for the merchant, DUPLICATE_BATCH for the "
               "engineer, and must insert no second copy of ok_01's rows. Runs "
               "immediately after ok_01 with NO reset in between — a reset would "
               "delete the completed import that makes it a duplicate."),
    )


def build_malformed() -> None:
    rng = random.Random(SEED + 1)

    def emit(name: str, what: str, text_or_bytes, *, code: str, status: str,
             notes: str = "", scored: bool = True, encoding: str = "utf-8",
             dataset: str | None = "ad_performance") -> None:
        path = MALFORMED / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(text_or_bytes, bytes):
            path.write_bytes(text_or_bytes)
        else:
            path.write_bytes(text_or_bytes.encode(encoding))
        declare(filename=f"malformed/{name}", group="malformed", what=what,
                job_status=status, dlq_code=code, ingests=False, scored=scored,
                dataset=dataset, notes=notes)

    # ── SCHEMA_MISMATCH ×3 — the headers are not a shape we can store ─────────

    # 01 — no date column anywhere.
    rows = make_rows(rng, 8)
    headers = [h for h in MINIMAL.headers if h != "Reporting starts"]
    body = [minimal_row(r)[1:] for r in rows]
    emit("fix_01_SCHEMA_MISMATCH.csv",
         "Required 'date' column absent from the header row",
         to_csv(headers, body), code="SCHEMA_MISMATCH", status="failed",
         notes="Every row fails for one reason, so the diagnosis is the headers.")

    # 02 — no campaign column.
    rows = make_rows(rng, 8)
    headers = [h for h in MINIMAL.headers if h != "Campaign name"]
    body = [[c for i, c in enumerate(minimal_row(r)) if i != 1] for r in rows]
    emit("fix_02_SCHEMA_MISMATCH.csv",
         "Required 'campaign_name' column absent from the header row",
         to_csv(headers, body), code="SCHEMA_MISMATCH", status="failed")

    # 03 — a legacy .xls saved under a .csv name. OLE2 magic bytes.
    ole2 = bytes([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) + b"\x00" * 504
    emit("fix_03_SCHEMA_MISMATCH.csv",
         "Legacy Excel (.xls) binary renamed to .csv — a format we will not read",
         ole2, code="SCHEMA_MISMATCH", status="failed", dataset=None,
         notes=("Classified from the reader's message, not the extension. "
                "Refused at detect_format, so no dataset is ever resolved."))

    # ── TYPE_COERCION_FAILED ×3 — we could not turn cells into values ─────────

    # 04 — full Asia/Bangkok timestamps in the date column. This is L-1, as data.
    rows = make_rows(rng, 9)
    body = []
    for index, row in enumerate(rows):
        cells = minimal_row(row)
        if index >= 2:          # two clean rows, so "leaked rows = 0" has something to leak
            cells[0] = f"2026-07-{row.day:02d}T{9 + index % 8:02d}:30:00+07:00"
        body.append(cells)
    emit("fix_04_TYPE_COERCION_FAILED.csv",
         "Date column carries full Asia/Bangkok ISO-8601 timestamps",
         to_csv(MINIMAL.headers, body), code="TYPE_COERCION_FAILED", status="failed",
         notes=("Documents L-1: the date parser accepts a date, never a timestamp. "
                "Two rows are clean — they must still not be stored."))

    # 05 — the N/A family in numeric columns.
    rows = make_rows(rng, 9)
    unreadable = ("N/A", "ไม่ระบุ", "#DIV/0!", "-", "n.a.")
    body = []
    for index, row in enumerate(rows):
        cells = minimal_row(row)
        if index >= 2:
            cells[3] = unreadable[index % len(unreadable)]      # Impressions
            cells[5] = unreadable[(index + 2) % len(unreadable)]  # Amount spent
        body.append(cells)
    emit("fix_05_TYPE_COERCION_FAILED.csv",
         "Impressions and spend contain N/A / ไม่ระบุ / #DIV/0!",
         to_csv(MINIMAL.headers, body), code="TYPE_COERCION_FAILED", status="failed",
         notes="A spend of 'N/A' read as 0 would understate cost — the error this product exists to remove.")

    # 06 — structurally short rows that still carry date and campaign.
    rows = make_rows(rng, 9)
    body = []
    for index, row in enumerate(rows):
        cells = minimal_row(row)
        body.append(cells if index < 2 else cells[:4])
    emit("fix_06_TYPE_COERCION_FAILED.csv",
         "Rows truncated to 4 of 7 columns — values may be in the wrong fields",
         to_csv(MINIMAL.headers, body), code="TYPE_COERCION_FAILED", status="failed",
         notes=("Truncation keeps date and campaign, so short_row is the only reason. "
                "Dropping those too would add missing_required and flip the roll-up."))

    # ── EMPTY_PAYLOAD ×3 — nothing to ingest ─────────────────────────────────

    # 07 — zero bytes.
    emit("fix_07_EMPTY_PAYLOAD.csv", "Zero-byte file", b"",
         code="EMPTY_PAYLOAD", status="failed", dataset=None,
         notes=("Refused at detect_format, before anything is read — so no "
                "dataset is ever resolved."))

    # 08 — headers, no data rows.
    emit("fix_08_EMPTY_PAYLOAD.csv", "Header row present, no data rows",
         to_csv(META_EN.headers, []), code="EMPTY_PAYLOAD", status="succeeded",
         notes=("The two views disagree on purpose: nothing is wrong with this file, "
                "so the merchant is told it succeeded, and the DLQ still counts it."))

    # 09 — headers plus furniture only.
    totals = ["รวมทั้งหมด", "", "", "", "", "0", "0", "0", "", "", "", "฿0.00", "0", "", ""]
    emit("fix_09_EMPTY_PAYLOAD.csv",
         "Header row, blank spacers and a totals row — every line is furniture",
         to_csv(META_TH.headers, [[""] * 15, [""] * 15, totals]),
         code="EMPTY_PAYLOAD", status="succeeded")

    # ── ROW_VALIDATION_FAILED ×3 — read fine, the rules refused them ─────────

    # 10 — negative metrics.
    rows = make_rows(rng, 9)
    body = []
    for index, row in enumerate(rows):
        cells = minimal_row(row)
        if index >= 2:
            cells[3] = f"-{row.impressions}"
            cells[5] = f"-{row.spend:.2f}"
        body.append(cells)
    emit("fix_10_ROW_VALIDATION_FAILED.csv", "Negative impressions and negative spend",
         to_csv(MINIMAL.headers, body), code="ROW_VALIDATION_FAILED", status="failed")

    # 11 — a row that contradicts itself.
    rows = make_rows(rng, 9)
    body = []
    for index, row in enumerate(rows):
        cells = minimal_row(row)
        if index >= 2:
            cells[4] = str(row.impressions + 500)   # more clicks than impressions
        body.append(cells)
    emit("fix_11_ROW_VALIDATION_FAILED.csv", "More link clicks than impressions",
         to_csv(MINIMAL.headers, body), code="ROW_VALIDATION_FAILED", status="failed",
         notes="Every cell parses; the arithmetic downstream would inherit the contradiction.")

    # 12 — the same row appended over and over, as a re-download would.
    rows = make_rows(rng, 1)
    repeated = minimal_row(rows[0])
    emit("fix_12_ROW_VALIDATION_FAILED.csv",
         "One row repeated eight times — an appended re-download",
         to_csv(MINIMAL.headers, [list(repeated) for _ in range(8)]),
         code="ROW_VALIDATION_FAILED", status="failed",
         notes=("Row 2 is valid and rows 3-9 are duplicates of it, so exactly one good "
                "row exists and must NOT be stored. The sharpest leak test in the set."))

    # ── the known failure ────────────────────────────────────────────────────

    # 13 — UTF-16 BOM with an odd byte count.
    text = to_csv(META_EN.headers, [meta_en_row(r) for r in make_rows(rng, 6)])
    utf16 = b"\xff\xfe" + text.encode("utf-16-le") + b"\x41"
    assert len(utf16) % 2 == 1, "the truncation is the whole point of this fixture"
    emit("fix_13_ENCODING_ERROR.csv",
         "UTF-16 BOM with a truncated final code unit (odd byte count)",
         utf16, code="ENCODING_ERROR", status="failed", scored=False, dataset=None,
         notes=("KNOWN_FAILURE / XFAIL. reader.py:76 calls data.decode('utf-16') outside "
                "any try block, so this raises a bare UnicodeDecodeError rather than "
                "UnreadableFile. detect_format catches only UnreadableFile, so the task "
                "crashes, _write_dlq is never reached and NO DLQ row is written. "
                "Expected actual: job failed, dlq_code = NONE. Not fixed in this "
                "session by instruction — excluded from the KPI-3 denominator."))


def build_aux() -> None:
    rng = random.Random(SEED + 2)

    # Shopee income — parses perfectly, has nowhere to go.
    headers = ["เลขที่คำสั่งซื้อ", "วันที่ทำรายการ", "SKU", "ชื่อสินค้า", "จำนวน", "ราคาขาย",
               "ส่วนลดผู้ขาย", "ยอดที่ผู้ซื้อชำระ", "ค่าคอมมิชชั่น",
               "ค่าธรรมเนียมการทำรายการ", "ค่าบริการ", "ค่าจัดส่งที่ผู้ขายรับผิดชอบ", "ยอดโอนสุทธิ"]
    body = []
    for index in range(12):
        price = (Decimal(rng.randrange(19_000, 89_000)) / Decimal(100)).quantize(Decimal("0.01"))
        commission = (price * Decimal("0.0535")).quantize(Decimal("0.01"))
        transaction = (price * Decimal("0.0321")).quantize(Decimal("0.01"))
        service = (price * Decimal("0.0214")).quantize(Decimal("0.01"))
        shipping = Decimal("15.00") if index % 3 == 0 else Decimal("0.00")
        net = price - commission - transaction - service - shipping
        body.append([
            f"26260724{index:05d}", be_slash_date(1 + index % 20),
            f"BZ-SKN-{index % 7 + 1:03d}", "เซรั่มวิตามินซี 30ml", "1",
            f"{price:.2f}", "0.00", f"{price:.2f}", f"{commission:.2f}",
            f"{transaction:.2f}", f"{service:.2f}", f"{shipping:.2f}", f"{net:.2f}",
        ])
    write(AUX / "aux_01_shopee_income.csv", to_csv(headers, body))
    declare(filename="aux/aux_01_shopee_income.csv", group="aux",
            what="Shopee income statement — parses, but no target table exists",
            job_status="succeeded", dlq_code=None, ingests=False, scored=False,
            platform="shopee_income", dataset="shopee_income",
            notes=("Short-circuits at clean_thai (targets.TARGET_TABLE['shopee_income'] "
                   "is None). Succeeds storing nothing, writes NO DLQ row. Excluded "
                   "from KPI-2: a file that stores nothing is not an ingestion success."))

    headers = ["SKU", "ชื่อสินค้า", "ต้นทุนสินค้าต่อชิ้น", "ราคาขายตั้งต้น", "หน่วย"]
    body = [[f"BZ-SKN-{i + 1:03d}", "ครีมกันแดด SPF50 50g",
             f"{Decimal(rng.randrange(9_000, 24_000)) / Decimal(100):.2f}",
             f"{Decimal(rng.randrange(30_000, 79_000)) / Decimal(100):.2f}", "ชิ้น"]
            for i in range(7)]
    write(AUX / "aux_02_product_cogs.csv", to_csv(headers, body))
    declare(filename="aux/aux_02_product_cogs.csv", group="aux",
            what="Merchant COGS sheet — parses, but no target table exists",
            job_status="succeeded", dlq_code=None, ingests=False, scored=False,
            platform="cogs", dataset="product_cogs",
            notes="Same short-circuit as aux_01, via TARGET_TABLE['product_cogs'] is None.")


# ── the manifest ──────────────────────────────────────────────────────────────

MANIFEST_PREAMBLE = """# Fixture manifest — the spec the KPI harness asserts against

Generated by `tests/fixtures/generate.py`. **Do not hand-edit**: change the
expectations in that file and regenerate, so the files and the spec cannot drift.

Every expectation here is *declared intent*, written by reading the pipeline's
rules. None of it is produced by running the pipeline — a manifest derived from
the thing it measures would assert only that the pipeline agrees with itself.

Regenerate (deterministic, byte-identical):

```bash
python3 tests/fixtures/generate.py
```

## Columns

| Column | Meaning |
|---|---|
| **Platform (input, not asserted)** | what the merchant picked on `/imports`; the harness writes it onto the `import_jobs` row and never checks it back |
| **Dataset** | what the *file* is, as `detect_dataset` resolves it. **Asserted.** `—` means the run never reaches `clean_thai`, so no dataset is resolved |
| **Outcome** | `import_jobs.status` the merchant sees when the run ends |
| **DLQ code** | `ingestion_dlq.error_code` for this file, or `—` for no DLQ row at all |
| **Ingests** | whether rows must reach the fact tables. `no` means the hard gate applies: **zero** rows, and `ingestion_staging` empty |
| **KPI** | which denominator this file counts toward |

**Why platform is an input and dataset is an assertion.** Nothing in a file's
bytes says which platform exported it — the merchant states it in the UI — so
"derive it and check it matches" is not available, and asserting a value the
harness itself supplied would prove only that the harness can remember its own
argument. `detect_dataset(headers, platform)` returns a *dataset*, scored from
the header row, using the declared platform only to break a tie
(`mapping.py:284-296`). That is a real decision the pipeline makes, so it is the
one that is checked — and it closes the hole the unasserted platform leaves: a
wrong platform surfaces as the file resolving to an unexpected dataset.

The merchant view and the engineering view disagree on three files by design
(`ok_20`, `fix_08`, `fix_09`): a duplicate and an empty file are successes to the
merchant and still worth counting to an engineer.
"""

MANIFEST_CODA = """
## Error-code reachability

Seven codes exist (`airflow/dags/buzzly_common/dlq.py`, mirrored by the CHECK
constraint in `supabase/migrations/20260805150000_ingestion_dlq_and_atomic_promote.sql`).
Only five can be produced by uploading a file, and only four by a *malformed*
one. This is a finding, not a gap in the corpus.

| Code | Fixtures | Reachable from a file? |
|---|---|---|
| `SCHEMA_MISMATCH` | fix_01, fix_02, fix_03 | yes |
| `TYPE_COERCION_FAILED` | fix_04, fix_05, fix_06 | yes |
| `EMPTY_PAYLOAD` | fix_07, fix_08, fix_09 | yes |
| `ROW_VALIDATION_FAILED` | fix_10, fix_11, fix_12 | yes |
| `DUPLICATE_BATCH` | ok_20 | yes — but it is a **success**, so it scores under KPI-2, not KPI-3 |
| `ENCODING_ERROR` | fix_13 | **UNREACHABLE — and the attempt is a bug.** `reader.ENCODINGS` ends in `latin-1`, which decodes every possible byte sequence, so the `raise UnreadableFile("...encoding could not be determined")` at `reader.py:87` can never execute. The one path that gets close — a UTF-16 BOM with an odd byte count — raises a bare `UnicodeDecodeError` from `reader.py:76`, which `detect_format` does not catch, so the task crashes and **no DLQ row is written at all**. `fix_13` pins that behaviour as a known failure. |
| `UNKNOWN` | none | **UNREACHABLE by design.** Written only when `promote_batch` itself throws (`buzzly_import_pipeline.py:830`) — an infrastructure fault, not a property of any file. `dlq.py:26-28` states that a non-zero `UNKNOWN` count is a defect report about the classifier rather than about the data, so a fixture that manufactured one would be measuring the wrong thing. |

## Limitations this corpus documents

**L-1 — a date cell may not carry a time.** `thai._ISO_DATE` is anchored
(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})$`), so `2026-07-18T09:30:00+07:00` in a date
column is `unreadable_date` and the row is rejected. Asia/Bangkok timestamps
therefore appear in the *valid* files only where a real export puts them — an
export banner (`ok_11`) and unmapped columns (`ok_08`, `ok_14`) — and `fix_04`
pins the rejecting behaviour deliberately.

**L-2 — `shopee_income` and `product_cogs` have no target table.**
`targets.TARGET_TABLE` maps both to `None`, so those files short-circuit at
`clean_thai`: the job succeeds, no rows are stored, and no DLQ row is written.
They are in `aux/` and score under neither KPI, because a file that succeeds
while storing nothing is not an ingestion success.

**L-3 — `ENCODING_ERROR` is dead code.** See the reachability table.

## Ordering and reset

Every fixture gets a scoped DB reset before it runs, so results are independent
— **except `ok_20`**, which must run immediately after `ok_01` with no reset in
between. `hash_dedupe` detects a duplicate by finding a *previously completed
import of the same bytes*; a reset would delete exactly that evidence and the
file would ingest normally instead.
"""


def kpi_for(item: Expectation) -> str:
    """Which denominator a file counts toward. One rule, two readers.

    Used by both renderings below so the prose table and the machine-readable
    spec cannot disagree about what is being scored.
    """
    if item.group == "valid":
        return "KPI-2"
    return "KPI-3" if item.scored else "excluded"


def render_manifest() -> str:
    lines = [MANIFEST_PREAMBLE]

    groups = (
        ("valid", "## Valid — KPI-2 Ingestion Success (20 files)",
         "All 20 must end `succeeded`. Nineteen must put rows in the fact tables; "
         "`ok_20` is the duplicate no-op and must put in none."),
        ("malformed", "## Malformed — KPI-3 DLQ Capture (12 scored + 1 known failure)",
         "All must be refused with **zero** rows reaching the fact tables and an empty "
         "`ingestion_staging`. `fix_13` is excluded from the score; see below."),
        ("aux", "## Auxiliary — not scored (2 files)",
         "Parse without error, target table not implemented. Scope limitation L-2."),
    )

    for group, heading, blurb in groups:
        lines.append(f"\n{heading}\n\n{blurb}\n")
        lines.append("| File | Simulates | Platform (input, not asserted) | Dataset "
                     "| Outcome | DLQ code | Ingests | KPI |")
        lines.append("|---|---|---|---|---|---|---|---|")
        for item in EXPECTATIONS:
            if item.group != group:
                continue
            lines.append(
                f"| `{item.filename}` | {item.what} | `{item.platform}` | "
                f"{f'`{item.dataset}`' if item.dataset else '—'} | "
                f"`{item.job_status}` | "
                f"{f'`{item.dlq_code}`' if item.dlq_code else '—'} | "
                f"{'yes' if item.ingests else 'no'} | {kpi_for(item)} |"
            )

    lines.append("\n## Per-file notes\n")
    for item in EXPECTATIONS:
        if item.notes:
            lines.append(f"- **`{item.filename}`** — {item.notes}")

    lines.append(MANIFEST_CODA)
    return "\n".join(lines) + "\n"


def render_spec() -> str:
    """The same expectations, for the harness rather than for a reader.

    `MANIFEST.md` is the document; this is the identical data with the fields a
    prose table has no business carrying — `depends_on`, `reset_before`,
    `scored`. Both are rendered from the one ``EXPECTATIONS`` list in the same
    run, so they cannot drift, and the harness never has to scrape markdown to
    learn what it is asserting.
    """
    return json.dumps(
        {
            "generated_by": "tests/fixtures/generate.py",
            "seed": SEED,
            "fixtures": [
                {
                    "filename": item.filename,
                    "group": item.group,
                    "what": item.what,
                    "platform": item.platform,
                    "dataset": item.dataset,
                    "job_status": item.job_status,
                    "dlq_code": item.dlq_code,
                    "ingests": item.ingests,
                    "scored": item.scored,
                    "kpi": kpi_for(item),
                    "depends_on": item.depends_on,
                    "reset_before": item.reset_before,
                    "notes": item.notes,
                }
                for item in EXPECTATIONS
            ],
        },
        ensure_ascii=False,
        indent=2,
    ) + "\n"


def main() -> None:
    for directory in (VALID, MALFORMED, AUX):
        if directory.is_dir():
            shutil.rmtree(directory)

    build_valid()
    build_malformed()
    build_aux()

    # Byte-distinctness matters: two accidentally identical valid files would
    # make the second a DUPLICATE_BATCH and fail KPI-2 for a reason that has
    # nothing to do with the pipeline.
    seen: dict[bytes, str] = {}
    for item in EXPECTATIONS:
        data = (ROOT / item.filename).read_bytes()
        twin = seen.get(data)
        if twin is not None and item.depends_on is None:
            raise SystemExit(f"{item.filename} is byte-identical to {twin} but is not "
                             "declared as a duplicate")
        seen.setdefault(data, item.filename)

    (ROOT / "MANIFEST.md").write_text(render_manifest(), encoding="utf-8")
    (ROOT / "MANIFEST.json").write_text(render_spec(), encoding="utf-8")

    counts = {group: sum(1 for e in EXPECTATIONS if e.group == group)
              for group in ("valid", "malformed", "aux")}
    print(f"valid={counts['valid']} malformed={counts['malformed']} aux={counts['aux']} "
          f"total={len(EXPECTATIONS)}")
    print(f"manifest -> {ROOT / 'MANIFEST.md'}")
    print(f"spec     -> {ROOT / 'MANIFEST.json'}")


if __name__ == "__main__":
    main()
