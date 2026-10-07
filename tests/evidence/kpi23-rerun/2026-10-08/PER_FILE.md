# KPI-2 / KPI-3 re-measure, 2026-10-08: per file, both runs

Run 1 started 2026-10-07T18:52:56+00:00, run 2 started 2026-10-07T19:19:07+00:00. Expected values come from `tests/fixtures/MANIFEST.json`, unchanged (fix_13 left frozen). *Rows written* = rows added across the six promote tables.

| File | KPI | Expected status / DLQ / stores | Run 1: status / DLQ / rows ok of total / rows written / verdict | Run 2: same fields | Runs identical |
|---|---|---|---|---|---|
| `valid/ok_01_meta_en_iso_plain.csv` | KPI-2 | succeeded / — / ingests | succeeded / — / 12 of 12 / 45 / pass | succeeded / — / 12 of 12 / 45 / pass | yes |
| `valid/ok_02_meta_th_be_slash_baht.csv` | KPI-2 | succeeded / — / ingests | succeeded / — / 12 of 12 / 45 / pass | succeeded / — / 12 of 12 / 45 / pass | yes |
| `valid/ok_03_meta_th_month_name.csv` | KPI-2 | succeeded / — / ingests | succeeded / — / 12 of 12 / 45 / pass | succeeded / — / 12 of 12 / 45 / pass | yes |
| `valid/ok_04_tiktok_iso.csv` | KPI-2 | succeeded / — / ingests | succeeded / — / 12 of 12 / 45 / pass | succeeded / — / 12 of 12 / 45 / pass | yes |
| `valid/ok_05_shopee_ads_baht_word.csv` | KPI-2 | succeeded / — / ingests | succeeded / — / 10 of 10 / 26 / pass | succeeded / — / 10 of 10 / 26 / pass | yes |
| `valid/ok_06_minimal_columns.csv` | KPI-2 | succeeded / — / ingests | succeeded / — / 10 of 10 / 36 / pass | succeeded / — / 10 of 10 / 36 / pass | yes |
| `valid/ok_07_meta_en_utf8_bom.csv` | KPI-2 | succeeded / — / ingests | succeeded / — / 12 of 12 / 45 / pass | succeeded / — / 12 of 12 / 45 / pass | yes |
| `valid/ok_08_thai_invisibles_ict_column.csv` | KPI-2 | succeeded / — / ingests | succeeded / — / 12 of 12 / 45 / pass | succeeded / — / 12 of 12 / 45 / pass | yes |
| `valid/ok_09_semicolon_delimiter.csv` | KPI-2 | succeeded / — / ingests | succeeded / — / 10 of 10 / 39 / pass | succeeded / — / 10 of 10 / 39 / pass | yes |
| `valid/ok_10_tab_delimiter.csv` | KPI-2 | succeeded / — / ingests | succeeded / — / 10 of 10 / 39 / pass | succeeded / — / 10 of 10 / 39 / pass | yes |
| `valid/ok_11_title_banner_ict.csv` | KPI-2 | succeeded / — / ingests | succeeded / — / 12 of 12 / 45 / pass | succeeded / — / 12 of 12 / 45 / pass | yes |
| `valid/ok_12_blank_and_totals_rows.csv` | KPI-2 | succeeded / — / ingests | succeeded / — / 10 of 10 / 39 / pass | succeeded / — / 10 of 10 / 39 / pass | yes |
| `valid/ok_13_cp874_thai.csv` | KPI-2 | succeeded / — / ingests | succeeded / — / 10 of 10 / 39 / pass | succeeded / — / 10 of 10 / 39 / pass | yes |
| `valid/ok_14_unmapped_extra_columns.csv` | KPI-2 | succeeded / — / ingests | succeeded / — / 12 of 12 / 42 / pass | succeeded / — / 12 of 12 / 42 / pass | yes |
| `valid/ok_15_empty_optional_cells.csv` | KPI-2 | succeeded / — / ingests | succeeded / — / 12 of 12 / 45 / pass | succeeded / — / 12 of 12 / 45 / pass | yes |
| `valid/ok_16_large_120_rows.csv` | KPI-2 | succeeded / — / ingests | succeeded / — / 120 of 120 / 249 / pass | succeeded / — / 120 of 120 / 249 / pass | yes |
| `valid/ok_17_lf_line_endings.csv` | KPI-2 | succeeded / — / ingests | succeeded / — / 10 of 10 / 39 / pass | succeeded / — / 10 of 10 / 39 / pass | yes |
| `valid/ok_18_quoted_commas_in_thai.csv` | KPI-2 | succeeded / — / ingests | succeeded / — / 10 of 10 / 39 / pass | succeeded / — / 10 of 10 / 39 / pass | yes |
| `valid/ok_19_mixed_date_formats.csv` | KPI-2 | succeeded / — / ingests | succeeded / — / 12 of 12 / 45 / pass | succeeded / — / 12 of 12 / 45 / pass | yes |
| `valid/ok_20_duplicate_of_ok_01.csv` | KPI-2 | succeeded / DUPLICATE_BATCH / nothing | succeeded / DUPLICATE_BATCH / 0 of 0 / 0 / pass | succeeded / DUPLICATE_BATCH / 0 of 0 / 0 / pass | yes |
| `malformed/fix_01_SCHEMA_MISMATCH.csv` | KPI-3 | failed / SCHEMA_MISMATCH / nothing | failed / SCHEMA_MISMATCH / 0 of 8 / 0 / pass | failed / SCHEMA_MISMATCH / 0 of 8 / 0 / pass | yes |
| `malformed/fix_02_SCHEMA_MISMATCH.csv` | KPI-3 | failed / SCHEMA_MISMATCH / nothing | failed / SCHEMA_MISMATCH / 0 of 8 / 0 / pass | failed / SCHEMA_MISMATCH / 0 of 8 / 0 / pass | yes |
| `malformed/fix_03_SCHEMA_MISMATCH.csv` | KPI-3 | failed / SCHEMA_MISMATCH / nothing | failed / SCHEMA_MISMATCH / 0 of 0 / 0 / pass | failed / SCHEMA_MISMATCH / 0 of 0 / 0 / pass | yes |
| `malformed/fix_04_TYPE_COERCION_FAILED.csv` | KPI-3 | failed / TYPE_COERCION_FAILED / nothing | failed / TYPE_COERCION_FAILED / 0 of 9 / 0 / pass | failed / TYPE_COERCION_FAILED / 0 of 9 / 0 / pass | yes |
| `malformed/fix_05_TYPE_COERCION_FAILED.csv` | KPI-3 | failed / TYPE_COERCION_FAILED / nothing | failed / TYPE_COERCION_FAILED / 0 of 9 / 0 / pass | failed / TYPE_COERCION_FAILED / 0 of 9 / 0 / pass | yes |
| `malformed/fix_06_TYPE_COERCION_FAILED.csv` | KPI-3 | failed / TYPE_COERCION_FAILED / nothing | failed / TYPE_COERCION_FAILED / 0 of 9 / 0 / pass | failed / TYPE_COERCION_FAILED / 0 of 9 / 0 / pass | yes |
| `malformed/fix_07_EMPTY_PAYLOAD.csv` | KPI-3 | failed / EMPTY_PAYLOAD / nothing | failed / EMPTY_PAYLOAD / 0 of 0 / 0 / pass | failed / EMPTY_PAYLOAD / 0 of 0 / 0 / pass | yes |
| `malformed/fix_08_EMPTY_PAYLOAD.csv` | KPI-3 | succeeded / EMPTY_PAYLOAD / nothing | succeeded / EMPTY_PAYLOAD / 0 of 0 / 0 / pass | succeeded / EMPTY_PAYLOAD / 0 of 0 / 0 / pass | yes |
| `malformed/fix_09_EMPTY_PAYLOAD.csv` | KPI-3 | succeeded / EMPTY_PAYLOAD / nothing | succeeded / EMPTY_PAYLOAD / 0 of 0 / 0 / pass | succeeded / EMPTY_PAYLOAD / 0 of 0 / 0 / pass | yes |
| `malformed/fix_10_ROW_VALIDATION_FAILED.csv` | KPI-3 | failed / ROW_VALIDATION_FAILED / nothing | failed / ROW_VALIDATION_FAILED / 0 of 9 / 0 / pass | failed / ROW_VALIDATION_FAILED / 0 of 9 / 0 / pass | yes |
| `malformed/fix_11_ROW_VALIDATION_FAILED.csv` | KPI-3 | failed / ROW_VALIDATION_FAILED / nothing | failed / ROW_VALIDATION_FAILED / 0 of 9 / 0 / pass | failed / ROW_VALIDATION_FAILED / 0 of 9 / 0 / pass | yes |
| `malformed/fix_12_ROW_VALIDATION_FAILED.csv` | KPI-3 | failed / ROW_VALIDATION_FAILED / nothing | failed / ROW_VALIDATION_FAILED / 0 of 8 / 0 / pass | failed / ROW_VALIDATION_FAILED / 0 of 8 / 0 / pass | yes |
| `malformed/fix_13_ENCODING_ERROR.csv` | excluded (not scored) | failed / ENCODING_ERROR / nothing | failed / ENCODING_ERROR / 0 of 0 / 0 / **XPASS (fails strict)** | failed / ENCODING_ERROR / 0 of 0 / 0 / **XPASS (fails strict)** | yes |
| `aux/aux_01_shopee_income.csv` | excluded (not scored) | succeeded / — / nothing | succeeded / — / 0 of 0 / 0 / pass | succeeded / — / 0 of 0 / 0 / pass | yes |
| `aux/aux_02_product_cogs.csv` | excluded (not scored) | succeeded / — / nothing | succeeded / — / 0 of 0 / 0 / pass | succeeded / — / 0 of 0 / 0 / pass | yes |
