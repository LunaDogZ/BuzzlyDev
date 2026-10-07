# Parse-guard end-to-end — 2026-10-08

`python3 -m pytest tests/test_parse_guard_e2e.py -s` against local Airflow +
the cloud KPI test workspace (scoped reset; protected counts held to a
snapshot taken at start, because `PROTECTED_BASELINE` is stale — L-7).

| file | DAG | job | DLQ | rows stored (6 promote tables) |
|---|---|---|---|---|
| valid UTF-16 LE | success | succeeded | — | campaigns 1, ads 1, campaign_ads 1, **ad_insights 2**, sync_history 1 |
| valid UTF-16 BE | success | succeeded | — | ad_insights 0 new (same 2 rows upserted), sync_history 1 |
| truncated UTF-16 | failed | failed | **ENCODING_ERROR** | 0 |
| oversized csv field (`_csv.Error`) | failed | failed | **UNKNOWN** | 0 |

Result: 1 passed, 2 subtests passed (172 s).

## Negative control
The same oversized-field file run against the **previous** DAG (`HEAD` before
the guard): DAG failed, job failed, **DLQ rows: none**, `parse` task failed —
the file vanished from the dead-letter queue. With the guard it is recorded as
`UNKNOWN`. So the passing assertion is produced by the change, not by the
fixture.
