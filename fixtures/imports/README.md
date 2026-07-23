# Merchant upload fixtures

Sample `.csv` files that simulate **what a Thai D2C merchant already has on their own
machine and uploads into Buzzly** when a platform API cannot be connected.

This is the counterpart to `mock-api/` — that simulates a platform *API*, these simulate
a merchant's *exported files*. Together they cover both ingestion paths.

Regenerate with:

```bash
node fixtures/imports/generate.mjs
```

`generate.mjs` is deterministic (fixed PRNG seed `20260723`, fixed 30-day window
`2026-06-24 → 2026-07-23`). Regenerating produces byte-identical files, so measurements
taken against them stay reproducible across runs — required for the research write-up.

## Files

| File | Simulates | Exercises |
|---|---|---|
| `meta/ads-export-clean.csv` | Meta Ads Manager export, English headers, ISO dates | Happy path — the baseline every other file is compared against |
| `meta/ads-export-thai-dirty.csv` | The same export saved from Thai Excel | **The parser's real job.** UTF-8 BOM, Buddhist-era dates in two formats, `฿` + thousands separators, trailing/non-breaking whitespace, blank result cells, a blank line, and a `รวมทั้งหมด` summary row that must be dropped rather than ingested |
| `tiktok/ads-export.csv` | TikTok Ads export | A second ad platform with different headers/units; only some campaigns are mirrored here, as with a real merchant |
| `shopee/income-report.csv` | Shopee income statement, one row per order line | **Feeds the wedge.** Per-order commission / transaction / service / shipping fees — the numbers that make true profit invisible to sellers |
| `shopee/ads-report.csv` | Shopee Ads performance report | A third ad spend source that must be merged with the other two |
| `shopee/products-cogs.csv` | The merchant's own cost sheet | Supplies COGS — without it True Net Profit cannot be computed at all |
| `edge-cases/broken-rows.csv` | A file with one defect per row | Quarantine logic: every bad row goes to `import_row_errors`, the 2 valid rows still land, job ends `partial` |
| `edge-cases/headers-only.csv` | Export with no data rows | Must succeed with 0 rows, not crash |
| `edge-cases/empty.csv` | Zero-byte file | Must fail cleanly with a useful message |

## The data tells one coherent story

All files describe the **same business over the same 30 days**. Ad spend, orders, and COGS
are tied to the same SKUs on purpose — random assignment would make per-SKU profitability
meaningless, and per-SKU profit is the single number this fixture exists to make computable.

Totals across the set:

```
ยอดผู้ซื้อชำระ (Gross)   ฿1,092,640
− ค่าธรรมเนียม Shopee      ฿127,743   (11.7%)
− ต้นทุนสินค้า (COGS)      ฿366,075
− ค่าโฆษณารวม              ฿257,827   (Meta + TikTok + Shopee Ads)
────────────────────────────────────
= TRUE NET PROFIT          ฿340,996
```

### The margin spread is deliberate

Per-SKU, once fees and ad spend are applied:

| SKU | Product | Reported ROAS | True net profit |
|---|---|---:|---:|
| `BZ-ELC-001` | หูฟังบลูทูธไร้สาย | **10.09x** | **−฿59,293** ⛔ |
| `BZ-BND-001` | เซตของขวัญรวม 3 ชิ้น | **16.81x** | +฿41,952 (6.9%) ⚠️ |
| `BZ-SKN-001` | เซรั่มวิตามินซี 30ml | 8.80x | +฿297,681 (45%) |
| `BZ-SUP-001` | คอลลาเจนเปปไทด์ 200g | 12.70x | +฿260,607 (46%) |

The earbuds campaign looks like the account's **second-best performer** on ROAS while
actually destroying ฿59k, and the highest-ROAS campaign of all has the thinnest real
margin. That inversion is the persona's stated fear — scaling budget into a
negative-margin SKU — and it is why the fixture must contain a loss-maker. A set where
every SKU is profitable cannot demonstrate the product's value proposition.

## Notes

- Thai numerals (๐–๙) are **not** used anywhere; all figures use normal digits.
- Buddhist-era years (2569 = 2026) **are** used in the Thai/Shopee files, because real
  Thai exports contain them and converting them is genuine parser work.
- Files use CRLF line endings, as Excel writes.
- Adjust volume/shape by editing `PRODUCTS`, `CAMPAIGNS`, `DAYS` or `SEED` at the top of
  `generate.mjs`, then regenerate.
