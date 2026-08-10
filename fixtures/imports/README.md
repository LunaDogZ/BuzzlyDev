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

It also writes **`ground-truth.json`**: the true typed value of every cell of
`meta/ads-export-thai-dirty.csv`, and the verdict every row of
`edge-cases/broken-rows.csv` must receive. The generator holds those values a moment
before serialising them into Buddhist-era dates, `฿` and thousands separators, so the
answer key is produced by no parser and can be used to score any of them. The
measurement harness (`airflow/research/`) reads it; scoring a parse against a re-parse
would have measured agreement rather than accuracy.

## Files

| File | Simulates | Exercises |
|---|---|---|
| `meta/ads-export-clean.csv` | Meta Ads Manager export, English headers, ISO dates | Happy path — the baseline every other file is compared against |
| `meta/ads-export-thai-dirty.csv` | The same export saved from Thai Excel | **The parser's real job.** UTF-8 BOM, Buddhist-era dates in two formats, `฿` + thousands separators, trailing/non-breaking whitespace, blank result cells, a blank line, and a `รวมทั้งหมด` summary row that must be dropped rather than ingested |
| `tiktok/ads-export.csv` | TikTok Ads export | A second ad platform with different headers/units; only some campaigns are mirrored here, as with a real merchant |
| `shopee/income-report.csv` | Shopee income statement, one row per order line | **Feeds the wedge.** Per-order commission / transaction / service / shipping fees — the numbers that make true profit invisible to sellers |
| `shopee/ads-report.csv` | Shopee Ads performance report | A third ad spend source that must be merged with the other two |
| `shopee/products-cogs.csv` | The merchant's own cost sheet | Supplies COGS — without it True Net Profit cannot be computed at all |
| `edge-cases/broken-rows.csv` | A file with one defect per row | Quarantine logic: 10 data rows → **3 pass validation, 7 are quarantined** with 7 distinct reason codes. The job ends **`failed` and stores nothing** — a file is imported only in full, so the 3 valid rows are refused along with the rest (see `pipeline.terminal_status`). The 7 reasons still reach `import_row_errors` and the merchant's error report, and the file is written to `ingestion_dlq` as `ROW_VALIDATION_FAILED`. Also the labelled set for measuring quarantine precision/recall — see `ground-truth.json` |
| `edge-cases/headers-only.csv` | Export with no data rows | Must succeed with 0 rows, not crash |
| `edge-cases/empty.csv` | Zero-byte file | Must fail cleanly with a useful message |

## The data tells one coherent story

All files describe the **same business over the same 30 days**. Ad spend, orders, and COGS
are tied to the same SKUs on purpose — random assignment would make per-SKU profitability
meaningless, and per-SKU profit is the single number this fixture exists to make computable.

Totals across the set — recomputed from the files themselves on 2026-08-05 by the
ingestion pipeline and cross-checked with a plain `awk` pass, which agree exactly.
(An earlier version of this section quoted figures from a superseded generation of
the fixtures; the CSVs were right and the prose was stale.)

```
ยอดผู้ซื้อชำระ (Gross)   ฿2,863,986   (3,458 order lines)
− ค่าธรรมเนียม Shopee      ฿327,839   (11.4%)  commission  ฿153,219
                                              transaction  ฿91,935
                                              service      ฿61,294
                                              shipping     ฿21,390
− ต้นทุนสินค้า (COGS)    ฿1,557,930
− ค่าโฆษณารวม              ฿373,218   Meta ฿234,429 + TikTok ฿109,160
                                     + Shopee Ads ฿29,629
──────────────────────────────────────
= TRUE NET PROFIT          ฿604,999   (21.1% of gross)
```

Divide gross by ad spend and you get a blended **7.67x**, which is the number the
merchant sees and the reason they keep scaling. The 21.1% below it is the number they
cannot see, and it is the whole product.

### The margin spread is deliberate

Per-SKU: gross margin after Shopee fees and COGS, then the ad spend of that SKU's own
campaigns subtracted. ROAS is the spend-weighted figure across that SKU's campaigns, as
the platforms report it.

| SKU | Product | Reported ROAS | Margin before ads | True net profit |
|---|---|---:|---:|---:|
| `BZ-ELC-001` | หูฟังบลูทูธไร้สาย | **9.67x** | ฿26,695 (4.5%) | **−฿59,291** ⛔ |
| `BZ-BND-001` | เซตของขวัญรวม 3 ชิ้น | **16.89x** | ฿76,960 (11.2%) | +฿41,952 (6.1%) ⚠️ |
| `BZ-SKN-001` | เซรั่มวิตามินซี 30ml | 8.35x | ฿423,994 (56.8%) | +฿297,680 (39.8%) |
| `BZ-SUP-001` | คอลลาเจนเปปไทด์ 200g | 12.09x | ฿333,531 (52.6%) | +฿260,605 (41.1%) |
| `BZ-ACC-001` | กระเป๋าผ้าแคนวาส | 4.86x | ฿80,620 (56.9%) | +฿57,265 (40.4%) |
| `BZ-ACC-002` | ขวดน้ำเก็บความเย็น 500ml | — organic | ฿19,143 (55.2%) | +฿19,143 |
| `BZ-SKN-002` | ครีมกันแดด SPF50 50g | — organic | ฿17,275 (54.6%) | +฿17,275 |

The seven rows sum to ฿634,629; the remaining ฿29,629 is the `Shopee Ads - สินค้าขายดี`
campaign, which names no SKU and so cannot be attributed to one — ฿634,629 − ฿29,629 =
the ฿604,999 above. That unattributable line is realistic, not an oversight: a merchant
running a store-wide ad has exactly this problem.

**Rank the SKUs by ROAS and by profit and the two orders disagree everywhere it
matters.** The earbuds sit mid-table on ROAS at 9.67x — comfortably above the 7.67x the
account averages, the kind of number that gets a budget increase — while destroying
฿59k. The single highest ROAS in the set, 16.89x, belongs to the gift bundle, whose real
margin is the second-thinnest at 6.1%. Meanwhile the canvas bag looks like the account's
worst campaign at 4.86x and returns 40.4%.

That inversion is the persona's stated fear — scaling budget into a negative-margin SKU
because the only number they can see says to — and it is why the fixture must contain a
loss-maker. A set where every SKU is profitable cannot demonstrate the product's value
proposition, and one where ROAS and profit agree cannot either.

## Notes

- Thai numerals (๐–๙) are **not** used anywhere; all figures use normal digits.
- Buddhist-era years (2569 = 2026) **are** used in the Thai/Shopee files, because real
  Thai exports contain them and converting them is genuine parser work.
- Files use CRLF line endings, as Excel writes.
- Adjust volume/shape by editing `PRODUCTS`, `CAMPAIGNS`, `DAYS` or `SEED` at the top of
  `generate.mjs`, then regenerate.
