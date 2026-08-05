"""Header mapping — which merchant column is which canonical field.

The second half of the research core. :mod:`buzzly_common.thai` normalises what
is *inside* a cell; this module decides what a *column* is, which is the harder
half: the same metric arrives as ``Amount spent (THB)`` from Meta, ``Cost
(THB)`` from TikTok, and ``ค่าใช้จ่าย (บาท)`` from Shopee, and the merchant's
Thai Excel may relabel any of them.

Position is not usable as a fallback. The clean and dirty Meta fixtures in
``fixtures/imports/meta/`` are the *same export* — yet the dirty one has 15
columns to the clean one's 16, because Thai Excel dropped ``Delivery status``.
Every column after index 5 shifts. Mapping by name is not a nicety here; a
positional parser silently reads reach as impressions.

Three passes, most-confident first
----------------------------------
1. **Exact** match of the normalised key against a synonym dictionary. Covers
   every header the fixtures actually contain.
2. **Prefix** match after the parenthetical gloss is stripped, so an export that
   appends a unit nobody anticipated (``ค่าใช้จ่าย (บาทไทย)``) still lands.
3. **Fuzzy** match above :data:`FUZZY_THRESHOLD`, which catches typos and stray
   tone marks — a real hazard in Thai, where a mistyped vowel is invisible at a
   glance but makes the string unequal.

A column that survives all three unmatched is *reported*, never guessed. The
unmapped list reaches the merchant, because "we did not recognise this column"
is something they can fix and a wrong guess is not.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

from buzzly_common.thai import normalize_text

# Above this ratio two headers are the same field. Tuned against the fixtures:
# high enough that "ค่าคอมมิชชั่น" and "ค่าบริการ" (both Shopee fees, both
# short) never collide, low enough to absorb a missing tone mark or a doubled
# vowel. Below it we report rather than guess.
FUZZY_THRESHOLD = 0.88

# A trailing gloss in brackets is a unit or an explanation, never the identity
# of the column: "Amount spent (THB)", "CPC (cost per link click)",
# "ค่าใช้จ่าย (บาท)". Stripping it turns three exports' worth of variation into
# one key.
_PARENTHETICAL = re.compile(r"\s*[(（\[][^)）\]]*[)）\]]\s*$")
_PUNCTUATION = re.compile(r"[.\-_/\\:：,]+")


def header_key(header: str) -> str:
    """Normalised comparison key for a column heading."""
    text = normalize_text(header).lower()
    text = _PARENTHETICAL.sub("", text)
    text = _PUNCTUATION.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


# ── canonical schemas ─────────────────────────────────────────────────────────
#
# Field -> the headings that mean it. English first (the platform's own export),
# then Thai (the same file saved from Thai Excel), then the merchant's likely
# hand-edits. Every string here is a claim about a real export, not a guess:
# the fixtures in fixtures/imports/ contain them.

AD_PERFORMANCE: dict[str, tuple[str, ...]] = {
    "date": (
        "reporting starts", "date", "day", "reporting date",
        "วันที่", "วันที่เริ่มต้น", "วันที่รายงาน", "วัน",
    ),
    "date_end": ("reporting ends", "end date", "วันที่สิ้นสุด"),
    "campaign_name": (
        "campaign name", "campaign", "ad campaign",
        "ชื่อแคมเปญ", "แคมเปญ", "ชื่อการรณรงค์",
    ),
    "ad_group_name": (
        "ad set name", "ad group name", "adgroup name", "ad set", "ad group",
        "ชื่อชุดโฆษณา", "ชุดโฆษณา", "ชื่อกลุ่มโฆษณา", "กลุ่มโฆษณา",
    ),
    "ad_name": ("ad name", "ad", "creative name", "ชื่อโฆษณา", "โฆษณา"),
    "ad_type": ("ad type", "placement", "ประเภทโฆษณา"),
    "status": (
        "delivery status", "status", "delivery", "สถานะ", "สถานะการแสดงผล",
    ),
    "impressions": (
        "impressions", "impression", "impr",
        "การแสดงผล", "จำนวนการแสดงผล", "การมองเห็น", "ยอดการแสดงผล",
    ),
    "reach": ("reach", "people reached", "การเข้าถึง", "จำนวนการเข้าถึง"),
    "clicks": (
        "link clicks", "clicks", "click", "link click",
        "คลิกลิงก์", "คลิก", "จำนวนคลิก", "ยอดคลิก",
    ),
    "ctr": ("ctr", "click through rate", "อัตราการคลิกผ่าน", "อัตราการคลิก"),
    "cpc": ("cpc", "cost per click", "ราคาต่อคลิก", "ต้นทุนต่อคลิก"),
    "cpm": ("cpm", "ราคาต่อการแสดงผล 1 000 ครั้ง", "ต้นทุนต่อการแสดงผล"),
    "spend": (
        "amount spent", "cost", "spend", "total spent",
        "จำนวนเงินที่ใช้จ่าย", "ค่าใช้จ่าย", "ยอดใช้จ่าย", "งบที่ใช้",
    ),
    "conversions": (
        "results", "conversions", "conversion", "purchases", "total orders",
        "ผลลัพธ์", "จำนวนคำสั่งซื้อ", "การแปลง", "ยอดสั่งซื้อ", "คำสั่งซื้อ",
    ),
    "cost_per_conversion": (
        "cost per result", "cost per conversion", "cpa",
        "ต้นทุนต่อผลลัพธ์", "ต้นทุนต่อการแปลง",
    ),
    "revenue": (
        "conversion value", "purchase value", "total revenue",
        "ยอดขายจากโฆษณา", "มูลค่าการซื้อ", "ยอดขาย",
    ),
    "roas": (
        "roas", "purchase roas", "complete payment roas",
        "return on ad spend", "ผลตอบแทนจากโฆษณา",
    ),
}

SHOPEE_INCOME: dict[str, tuple[str, ...]] = {
    "order_sn": ("order id", "order sn", "เลขที่คำสั่งซื้อ", "หมายเลขคำสั่งซื้อ"),
    "order_date": ("order date", "transaction date", "วันที่ทำรายการ", "วันที่สั่งซื้อ"),
    "sku": ("sku", "sku reference no", "รหัสสินค้า", "เลขอ้างอิง sku"),
    "product_name": ("product name", "item name", "ชื่อสินค้า", "สินค้า"),
    "quantity": ("quantity", "qty", "จำนวน", "จำนวนชิ้น"),
    "unit_price": ("original price", "unit price", "ราคาขาย", "ราคาต่อชิ้น"),
    "seller_discount": ("seller discount", "ส่วนลดผู้ขาย", "ส่วนลดจากผู้ขาย"),
    "buyer_paid": (
        "total amount paid by buyer", "buyer paid",
        "ยอดที่ผู้ซื้อชำระ", "ยอดชำระของผู้ซื้อ",
    ),
    # The wedge lives in these four. Shopee splits what a seller experiences as
    # "the fee" across separate columns, which is precisely why sellers cannot
    # see their true margin — no single column is the answer.
    "commission_fee": (
        "commission fee", "ค่าคอมมิชชั่น", "ค่าคอมมิชชัน", "ค่าธรรมเนียมการขาย",
    ),
    "transaction_fee": (
        "transaction fee", "ค่าธรรมเนียมการทำรายการ", "ค่าธรรมเนียมธุรกรรม",
    ),
    "service_fee": ("service fee", "ค่าบริการ", "ค่าธรรมเนียมบริการ"),
    "shipping_fee": (
        "shipping fee paid by seller", "shipping fee",
        "ค่าจัดส่งที่ผู้ขายรับผิดชอบ", "ค่าจัดส่ง",
    ),
    "net_payout": (
        "total released amount", "net payout",
        "ยอดโอนสุทธิ", "ยอดเงินที่ได้รับ", "ยอดสุทธิ",
    ),
}

PRODUCT_COGS: dict[str, tuple[str, ...]] = {
    "sku": ("sku", "product code", "รหัสสินค้า"),
    "product_name": ("product name", "ชื่อสินค้า", "สินค้า"),
    "unit_cost": (
        "unit cost", "cost per unit", "cogs",
        "ต้นทุนสินค้าต่อชิ้น", "ต้นทุนต่อชิ้น", "ต้นทุน",
    ),
    "list_price": ("list price", "selling price", "ราคาขายตั้งต้น", "ราคาขาย"),
    "unit": ("unit", "หน่วย"),
}

# Which dataset a file is, and the fields that prove it. `required` are the
# columns without which the file cannot be that dataset at all.
DATASETS: dict[str, dict] = {
    "ad_performance": {
        "fields": AD_PERFORMANCE,
        "required": ("date", "campaign_name"),
        "platforms": ("meta", "tiktok", "shopee_ads", "generic"),
    },
    "shopee_income": {
        "fields": SHOPEE_INCOME,
        "required": ("order_sn", "sku"),
        "platforms": ("shopee_income", "generic"),
    },
    "product_cogs": {
        "fields": PRODUCT_COGS,
        "required": ("sku", "unit_cost"),
        "platforms": ("cogs", "generic"),
    },
}

# Platform declared at upload -> the dataset to try first. The merchant picks
# the report type in the UI, so this is a stated intent; it is a tiebreak, not
# an override, because merchants mis-pick and the columns are the evidence.
PLATFORM_DEFAULT_DATASET = {
    "meta": "ad_performance",
    "tiktok": "ad_performance",
    "shopee_ads": "ad_performance",
    "shopee_income": "shopee_income",
    "cogs": "product_cogs",
}


def _synonym_index(fields: dict[str, tuple[str, ...]]) -> dict[str, str]:
    index: dict[str, str] = {}
    for field, synonyms in fields.items():
        for synonym in synonyms:
            index.setdefault(header_key(synonym), field)
    return index


_INDEXES = {name: _synonym_index(spec["fields"]) for name, spec in DATASETS.items()}


def match_header(header: str, dataset: str) -> tuple[str | None, str]:
    """Resolve one column heading to a canonical field.

    Returns ``(field, how)`` where ``how`` is ``exact``/``prefix``/``fuzzy``/
    ``unmatched`` — recorded so the write-up can report how much of the mapping
    the dictionary handles versus how much needs fuzzy rescue.
    """
    index = _INDEXES[dataset]
    key = header_key(header)
    if not key:
        return None, "unmatched"

    if key in index:
        return index[key], "exact"

    # A longer heading that starts with a known one: "ค่าใช้จ่าย รวม".
    prefixed = [
        (synonym, field) for synonym, field in index.items()
        if len(synonym) >= 4 and (key.startswith(synonym) or synonym.startswith(key))
    ]
    if prefixed:
        synonym, field = max(prefixed, key=lambda pair: len(pair[0]))
        return field, "prefix"

    best_field, best_score = None, 0.0
    for synonym, field in index.items():
        score = SequenceMatcher(None, key, synonym).ratio()
        if score > best_score:
            best_field, best_score = field, score
    if best_score >= FUZZY_THRESHOLD:
        return best_field, "fuzzy"

    return None, "unmatched"


def map_headers(headers: list[str], dataset: str) -> dict:
    """Map a header row to canonical fields.

    The first column to claim a field keeps it. A duplicate heading is recorded
    as a *conflict* rather than silently overwriting, because the second column
    under the same name is usually a different metric the export failed to
    label — reading it as the first would be wrong data, not missing data.
    """
    columns: dict[str, int] = {}
    how: dict[str, str] = {}
    unmapped: list[str] = []
    conflicts: list[str] = []

    for position, header in enumerate(headers):
        field, method = match_header(header, dataset)
        label = normalize_text(header) or f"column {position + 1}"
        if field is None:
            unmapped.append(label)
        elif field in columns:
            conflicts.append(label)
        else:
            columns[field] = position
            how[field] = method

    return {
        "dataset": dataset,
        "columns": columns,
        "match_methods": how,
        "unmapped": unmapped,
        "conflicts": conflicts,
        "missing_required": [
            field for field in DATASETS[dataset]["required"] if field not in columns
        ],
    }


def detect_dataset(headers: list[str], platform: str | None = None) -> tuple[str, dict]:
    """Decide which dataset a header row describes, and map it.

    Scored by how many columns each candidate can claim rather than by the
    platform the merchant selected: a merchant who uploads their COGS sheet
    under "Shopee income" is describing the file wrongly, and the columns are
    not wrong. The declared platform breaks ties only.
    """
    preferred = PLATFORM_DEFAULT_DATASET.get(platform or "")
    scored = []
    for name in DATASETS:
        mapping = map_headers(headers, name)
        score = (
            len(mapping["columns"])
            - 5 * len(mapping["missing_required"])
            + (1 if name == preferred else 0)
        )
        scored.append((score, name, mapping))

    score, name, mapping = max(scored, key=lambda item: item[0])
    return name, mapping
