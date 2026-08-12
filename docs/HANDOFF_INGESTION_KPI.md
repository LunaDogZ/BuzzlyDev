# Handoff — Ingestion KPI verification (KPI-2 / KPI-3)

**Written 2026-08-10.** Purpose: let a fresh session resume with zero
re-discovery. Read this top to bottom before touching anything.

Deliverable being built: evidence artifacts for two research KPIs, not green
checkmarks. `tests/RESULTS.md` (file → expected → actual → pass/fail, plus a
summary line per KPI) and `tests/evidence/dlq_dump.csv` (raw DLQ table, thesis
appendix).

---

## 1. Current state

| Step | Status |
|---|---|
| Step 0 — inventory | **complete** (findings in §2) |
| Step 1 — fixtures | **complete**, commits `5fec2f4` + `d7b4565` |
| Step 2 — harness `tests/test_ingestion_kpi.py` | **complete** |
| Step 3 — run + `tests/RESULTS.md` + `tests/evidence/dlq_dump.csv` | **complete** |

Branch `feat/airflow-import-pipeline`. 35 fixtures, `tests/fixtures/MANIFEST.md`
and `MANIFEST.json` are frozen and committed. **Open items A–D are all resolved
— see §6 for what was decided and §6b for the limitation the work turned up.**

Re-measure with one command (~20 minutes, sequential by design):

```bash
python3 -m pytest tests/test_ingestion_kpi.py -v
```

Each run archives its own outcomes to `tests/evidence/runs/`, and the next run's
`RESULTS.md` compares itself against the previous one — two runs that agree
fixture-for-fixture are the re-runnability evidence, which a single run cannot
be.

### Environment as it actually is

- Airflow runs in Docker (`buzzly_airflow-*` containers), REST on
  `http://localhost:8081`, healthy.
- Airflow Variables `BUZZLY_SUPABASE_URL` / `BUZZLY_SUPABASE_SERVICE_ROLE_KEY`
  point at the **cloud** project `https://aokzvknggtccgwbavszj.supabase.co`.
- The local `supabase_db_Buzzly_Real` container **does not have** the
  `ingestion_dlq` / `ingestion_staging` / `ingestion_batches` tables — those
  migrations were never applied locally. The real ingestion path is the cloud
  project. This is why the reset is workspace-scoped rather than a local wipe.
- Live cloud counts at Step 1 (the baseline to protect): **881 `ad_insights`,
  9 `import_jobs`, 3 `ingestion_dlq`**.

---

## 2. Step 0 inventory — findings

### 2.1 The seven DLQ error codes

Defined `airflow/dags/buzzly_common/dlq.py:38-59`. Mirrored by the CHECK
constraint at
`supabase/migrations/20260805150000_ingestion_dlq_and_atomic_promote.sql:123-131`.
`airflow/tests/test_dlq.py` reads the migration and fails if the two drift — a
code Python can emit but the database rejects would turn a refusal into a
*second* failure, losing the row that explains the first.

| Code | Reachable from file content? |
|---|---|
| `SCHEMA_MISMATCH` | yes — headers do not map to a storable dataset; also `.xls`/unopenable-xlsx via `classify_unreadable` |
| `TYPE_COERCION_FAILED` | yes — majority of rejected rows are `unreadable_date` / `unreadable_number` / `short_row` |
| `EMPTY_PAYLOAD` | yes — 0 bytes, no data rows, no column headings |
| `ROW_VALIDATION_FAILED` | yes — majority `missing_required` / `negative_value` / `clicks_exceed_impressions` / `duplicate_row` |
| `DUPLICATE_BATCH` | yes — **but it is a success**, see §3.5 |
| `ENCODING_ERROR` | **NO — dead code**, see §2.2 |
| `UNKNOWN` | **NO — infrastructure only**, see §2.3 |

**Only four codes are reachable from a malformed file.** That is a finding, and
it is recorded in `MANIFEST.md` rather than papered over.

### 2.2 Why `ENCODING_ERROR` is dead code

`reader.ENCODINGS` (`reader.py:42`) is
`("utf-8-sig", "utf-8", "cp874", "tis-620", "cp1252", "latin-1")`. **`latin-1`
decodes every possible byte sequence**, so the loop in `detect_encoding` can
never fall through, and the
`raise UnreadableFile("The file's text encoding could not be determined.")` at
**`reader.py:87`** is unreachable.

The one path that gets close is a UTF-16 BOM: `reader.py:75-76` short-circuits
to `data.decode("utf-16")` **outside any try block**. A UTF-16 BOM with an odd
byte count raises a bare `UnicodeDecodeError`, which is *not* an
`UnreadableFile`. The `detect_format` task catches only `UnreadableFile`
(`buzzly_import_pipeline.py:516`), so:

- the task crashes,
- `_fail_with_message` is never called,
- `_write_dlq` is never reached,
- **no DLQ row is written at all.**

Verified empirically against `fix_13`:
`UNCAUGHT UnicodeDecodeError: 'utf-16-le' codec can't decode byte 0x41 in position 2456: truncated data`.

### 2.3 Why `UNKNOWN` is infrastructure-only

Written from exactly one place: the `except` around `ingest_ad_performance` in
`upsert_target` (`buzzly_import_pipeline.py:830`) — i.e. `promote_batch` itself
threw. It is a property of the database round-trip, never of a file.
`dlq.py:26-28` states the intent directly: `UNKNOWN` is never raised by any
classification, and a non-zero count of it is a defect report about the
classifier rather than about the data. A fixture manufacturing one would be
measuring the wrong thing.

### 2.4 Two vocabularies — do not conflate them

**Row-level codes** (`validate.py`, `records.py`) go to `import_row_errors` and
the merchant's downloadable CSV. **They never appear in the DLQ.** There are
seven, and `dlq.ROW_CODE_GROUPS` (`dlq.py:65-75`) rolls them up:

| Row-level code | Rolls up to |
|---|---|
| `unreadable_date`, `unreadable_number`, `short_row` | `TYPE_COERCION_FAILED` |
| `missing_required`, `negative_value`, `clicks_exceed_impressions`, `duplicate_row` | `ROW_VALIDATION_FAILED` |

The dividing line is **who failed**: we could not read their cells
(coercion) vs we read them fine and the rules refused the row (validation).
Roll-up is by majority, and **a tie goes to `ROW_VALIDATION_FAILED`**
(`dlq.py:107-126`) — a coercion failure is a validation failure in the broad
sense, so the rule code is never false about a mixed file.

*Consequence for fixture design:* a fixture aiming at `TYPE_COERCION_FAILED`
must produce strictly more coercion problems than validation problems. This is
why `fix_06`'s truncated rows keep their date and campaign columns — dropping
those would add two `missing_required` per row against one `short_row` and flip
the roll-up. `Issue("short_row", ...)` carries `column_name=None`
(`records.py:111-114`), so it does **not** suppress `missing_required` the way a
column-scoped issue does (`validate.py:74-78`).

### 2.5 Where DLQ rows are written

Table `public.ingestion_dlq`. RLS enabled, **no policy for `authenticated`** —
service_role only, deliberately: merchant exports carry order and revenue data
and the failure detail can quote offending values.

Columns: `id, import_job_id (FK ON DELETE SET NULL), team_id, batch_id,
original_filename, file_hash, platform, error_code (CHECK), error_message,
stage, rows_attempted, rows_rejected, detail jsonb, dag_run_id, occurred_at`.

Identifying details are **denormalised on purpose** — the FK is `SET NULL` so a
merchant deleting an import cannot erase the engineering record of why it
failed.

Unique partial index `ingestion_dlq_job_key` on `import_job_id` (migration
`:152-153`) enforces **exactly one DLQ row per job in the database**, not by
convention. Writers upsert on that key, so a retried task rewrites its own row.

Single writer: `_write_dlq()` at `buzzly_import_pipeline.py:153`. Four call
sites:

| Call site | Code |
|---|---|
| `hash_dedupe` (`:483`) | `DUPLICATE_BATCH` |
| `_fail_with_message` (`:279`) | `classify_unreadable(message)` — reached from `detect_format` and `parse` |
| `_record_refusal` in `finalize` (`:223`, `:255`) | `EMPTY_PAYLOAD`, or `SCHEMA_MISMATCH` when headers were the problem, else `classify_rejections(...)` |
| `upsert_target` except (`:830`) | `UNKNOWN` |

**`_write_dlq` swallows its own exceptions** (`:191`, `except Exception: log.exception`).
Deliberate: a merchant's import must not end differently because our diagnostic
ledger was unreachable. The documented trade — and it matters to KPI-3 — is that
a failed DLQ write shows up as a **missing row**. The harness reading a gap and
failing is a true report; an import failing because its post-mortem could not be
filed would not be. **So the harness must treat an absent DLQ row as a real
failure, never retry it into existence.**

### 2.6 The three atomicity layers

1. **`promote_batch()`** — migration
   `20260805150000_ingestion_dlq_and_atomic_promote.sql:175-421`. Rows buffer
   into `ingestion_staging` over N requests, then **one** PostgREST call commits
   six tables (`ad_groups`, `campaigns`, `ads`, `campaign_ads`, `ad_insights`,
   `sync_history`) in one transaction. One request = one transaction is the
   whole design. Staging inserts are deliberately *not* atomic — staging is not
   production, and rows for a batch that never promoted are garbage.
2. **The `upsert_target` guard** — `buzzly_import_pipeline.py:746-754`.
   `if ledger["rows_quarantined"]: return "not committed"`. **This is where
   file-level all-or-nothing actually happens** — nothing is even staged.
3. **`terminal_status()` / `reported_counts()`** — `pipeline.py:189-252`. No
   `partial` status exists any more; `rows_ok` is forced to 0 on a refused file,
   while `rows_quarantined` stays at the real count (so the three stored
   counters intentionally do not sum on a refused file).

Plus `discard_staging_batch()` (migration `:437-449`), called after a failed
promote so the buffer does not linger.

`pipeline.assert_consistent` (`:167`) enforces
`rows_ok + rows_quarantined == rows_total` on the **ledger** before `finalize`
writes anything.

### 2.7 Target tables

`targets.TARGET_TABLE` (`targets.py:73-77`):

```python
"ad_performance": "ad_insights",
"shopee_income":  None,
"product_cogs":   None,
```

`None` means `clean_thai` short-circuits (`buzzly_import_pipeline.py:590-602`):
job succeeds, `rows_total` zeroed, **no DLQ row** (because `_record_refusal`
returns early on `ledger["skipped"]`). See decision §3.4.

---

## 3. Decisions made, and why

### 3.1 Twelve malformed files across four codes; two codes marked UNREACHABLE

Rather than fake 7/7 coverage. **Reachability analysis is a stronger result than
pretending complete coverage** — it says something true about the system.
`MANIFEST.md` carries a reachability table stating, per code, whether a file can
produce it and why not when it cannot.

### 3.2 `fix_13` is XFAIL and the bug is NOT fixed here

`fix_13_ENCODING_ERROR.csv` documents the real bug in §2.2. The agreed sequence:

1. harness green with the xfail documented ← **we are here**
2. a **separate, explicitly approved session** applies the fix
3. the xfail flips to pass

That gives before/after evidence in the thesis instead of an untested patch.
**Do not fix `reader.py` opportunistically. Do not "improve" it while passing
by.** `fix_13` is excluded from the KPI-3 denominator (12 scored, not 13).

### 3.3 Reset is workspace-scoped; never truncate

**The 881 `ad_insights` rows are live data reserved for a different KPI.** Never
truncate cloud tables under any circumstance. Reset is scoped by the test
workspace / test ad account only (§4).

### 3.4 KPI-2 denominator is 20 `ad_performance` files only

`shopee_income` and `product_cogs` fixtures live in `aux/`, are **unscored**, and
are asserted only as "parses without error, target table not implemented". They
succeed while storing nothing, and **a file that succeeds while storing nothing
is not an ingestion success**. Documented as scope limitation L-2.

### 3.5 `DUPLICATE_BATCH` is a success no-op, so it belongs in the valid set

The merchant view and the engineering view disagree here **on purpose**: the
merchant is told, correctly, that their data is already imported; the engineer
gets a `DUPLICATE_BATCH` row because a file that went in and produced no rows is
worth counting. It scores under KPI-2 (as a success), never under KPI-3. It must
insert **no second copy** of `ok_01`'s rows.

### 3.6 Leak detection is a diff across six tables plus staging

**`ad_insights` has no `batch_id` and no `import_job_id` column** — the columns
are `id, ad_account_id, campaign_id, ads_id, date, impressions, clicks, spend,
roas, conversions, reach, ctr, cpc, cpm, created_at`. So "zero rows inserted
from that batch" cannot be a `WHERE batch_id = …`; it must be a **before/after
count diff scoped to the test workspace**, taken across **all six tables
`promote_batch` writes**. Asserting only `ad_insights` would miss a leak into
`campaigns` / `ads`.

Additionally: **`ingestion_staging` must be empty after each malformed file**,
which is what proves `discard_staging_batch()` actually ran rather than merely
that the fact tables stayed clean.

---

## 4. Approved WHERE clauses

Approved verbatim. FK delete order confirmed safe. `:test_team` and
`:test_ad_account` are created by the harness; no row predating this suite
matches either.

```sql
-- Suite start and between fixtures.
DELETE FROM ad_insights     WHERE ad_account_id IN (SELECT id FROM ad_accounts WHERE team_id = :test_team);
DELETE FROM campaign_ads    WHERE campaign_id IN (SELECT id FROM campaigns WHERE team_id = :test_team);
DELETE FROM ads             WHERE team_id = :test_team;
DELETE FROM ad_groups       WHERE team_id = :test_team;
DELETE FROM campaigns       WHERE team_id = :test_team;
DELETE FROM sync_history    WHERE team_id = :test_team;
DELETE FROM ingestion_staging WHERE batch_id IN (SELECT uuid5_batch_id(id) FROM import_jobs WHERE team_id = :test_team)
                                 OR batch_id IN (SELECT batch_id FROM ingestion_batches WHERE team_id = :test_team);
DELETE FROM ingestion_batches WHERE team_id = :test_team;
DELETE FROM ingestion_dlq     WHERE team_id = :test_team;
DELETE FROM import_row_errors WHERE import_job_id IN (SELECT id FROM import_jobs WHERE team_id = :test_team);
DELETE FROM import_jobs       WHERE team_id = :test_team;
```

No statement touches a row outside `:test_team`.

**Two corrections to what was approved, both found while implementing it.**

1. **`ad_insights` cannot be scoped to one ad account.** `resolve_ad_account`
   opens one account per *platform* (`targets.py:158-196`), and the corpus
   uploads under `meta`, `tiktok` and `shopee_ads` — three accounts for one
   workspace. `WHERE ad_account_id = :test_ad_account` would have left two
   platforms' rows in place, so the before/after leak diff of §3.6 would have
   measured against dirty state. Scoped to the team's accounts instead.
2. **`ingestion_staging` cannot be found through `ingestion_batches`.** A batch
   row is written *by* `promote_batch`, so a batch that never promoted has none
   and the subquery returns the empty set — for exactly the orphans it was meant
   to reach. See L-4 in §6b: this also made the harness's "staging is empty
   after a refused file" assertion pass vacuously. The harness re-derives each
   job's batch id (`uuid5(IMPORT_NAMESPACE, "batch\x1f" || job_id)`, written as
   `uuid5_batch_id()` above for readability — there is no such SQL function; the
   harness computes it in Python) and proves the derivation against a genuinely
   promoted batch once per run, so the check cannot silently query an id that
   matches nothing.

---

## 5. Two flagged consequences

**5.1 `MANIFEST.md` is now harness input, not just documentation.** It carries a
`Platform` column the harness needs to write the `import_jobs` row. See open
item D — this creates a circularity that must be resolved.

**5.2 Suite re-runnability depends on the suite-start reset.** On a second run,
`ok_01`'s bytes have already been ingested by run 1, so `hash_dedupe` would
short-circuit it as a duplicate and **KPI-2 would score 19/20 for a reason that
has nothing to do with the pipeline**. The suite-start reset must clear the test
workspace's `import_jobs`, or the harness is only correct the first time.

---

## 6. Open items — ALL RESOLVED

> **Resolved 2026-08-10.** Kept in full below, with what was decided appended to
> each. The reasoning is the useful part; deleting it would leave the next
> session re-deriving it.

**A — resolved.** `kpi_harness.assert_dependency_ingested` re-derives `ok_01`'s
sha256 and refuses to run `ok_20` unless a *succeeded* import of those exact
bytes with `rows_ok > 0` already exists for the test workspace. `fix_12` was
**verified, not assumed**: `validate_records` builds its `seen` dict locally per
call (`validate.py:137,152-165`), so duplicate detection is intra-file only, and
it was run standalone after a full reset — `ROW_VALIDATION_FAILED`, 7 of 8 rows
rejected, zero leak. It needs no guard, as suspected.

**A.1 — a finding the guard produced.** The rule "`ok_20` runs immediately after
`ok_01`" is about *execution* order, and `ok_20` is **listed last** in the valid
group. The first full run took the listed order, put eighteen resets between the
pair — each deleting the workspace's `import_jobs` — and the guard stopped the
suite. Without it, `ok_20` would have ingested cleanly and scored a KPI-2 pass
while testing nothing about duplicate detection. `kpi_harness.execution_order`
now places a dependent immediately after its dependency and self-checks that any
fixture skipping its reset is preceded by the thing it depends on.

**B — resolved.** Counted as *total minus ours*, never with a `neq` filter: `neq`
also drops rows whose column is NULL and would understate the very total it is
protecting. Verified at suite start, at suite end, and on both sides of every
reset.

**C — resolved without a migration.** The count-then-delete-then-verify option,
implemented as: every filter counted **before any delete runs**, an over-ceiling
count aborting with nothing deleted, each delete reporting its row count, each
filter re-counted to zero afterwards, and the protected counts re-verified on
both sides. No RPC, so no migration and no approval needed. See §4 for the two
scoping corrections this turned up.

**D — resolved as decided.** `Platform (input, not asserted)` plus a new asserted
`Dataset` column, read from the ledger `clean_thai` returns on XCom. Regeneration
left all 35 CSVs byte-identical. A `MANIFEST.json` was added alongside
`MANIFEST.md`, rendered from the same `EXPECTATIONS` list in the same run, because
the harness needs `depends_on` / `reset_before` / `scored` and a prose table has
no business carrying them.

### The original items, for their reasoning

### A. `ok_20` order guard (and check `fix_12`)

`ok_20` depends on `ok_01` having run *and* on skipping the per-fixture reset.
If `ok_01`'s `file_hash` is not already present in `import_jobs` when `ok_20`
runs, the harness must **fail loudly with an explicit message**, not ingest it
as a fresh file. As designed, a `-k ok_20` run or a randomized order would pass
for the wrong reason.

Apply the same reasoning to `fix_12`. *Note for the implementer:* `fix_12`'s
duplication is **within a single file** (one row repeated eight times, caught by
`validate`'s `IDENTITY_FIELDS` seen-set), so it has **no cross-file dependency**
and needs no guard — but verify that before concluding it, rather than trusting
this line.

### B. Snapshot three live counts, not one

Assert unchanged at **suite start AND suite end**, each scoped to everything
*outside* `:test_team` / `:test_ad_account`:

- `ad_insights` = 881
- `import_jobs` = 9
- `ingestion_dlq` = 3

All three go in `RESULTS.md` as evidence.

### C. Reset blast-radius guard

Wrap the reset in a transaction. **Before committing, count the rows each
DELETE would remove**; if any count exceeds what the test workspace could
plausibly hold, **ROLLBACK and abort the suite**. This is a hard stop between a
scoping bug and live data.

*Implementation note:* the cloud path is PostgREST (see §7), where one request
is one transaction and a multi-statement transaction is not directly available.
Either do count-then-delete-then-verify per table with an abort threshold, or
add a `SECURITY DEFINER` RPC that does the whole reset transactionally. **Adding
an RPC is a migration — get approval first.** Do not silently downgrade this
requirement to "count first and hope".

### D. `MANIFEST.md` circularity on `Platform` — DECISION MADE

**Chosen: mark `Platform` as input-only / not-asserted, AND add a new `Dataset`
column that IS asserted.**

Rationale: `Platform` is what the merchant picked in the `/imports` UI. It is
genuinely an *input*, not a property of the file — there is nothing in the bytes
to derive it from, so "derive it and assert it matches" is not available.
`detect_dataset(headers, platform)` returns a **dataset**, not a platform, and
uses `platform` only as a tie-break (`mapping.py:284-296`).

But the risk you identified is real and the dataset assertion closes it: a wrong
`Platform` value would show up as the file resolving to an unexpected dataset
(e.g. an ad file declared `shopee_income` short-circuiting at `clean_thai` with
no target table). So:

- `MANIFEST.md` gains a **"Platform (input, not asserted)"** column header.
- `MANIFEST.md` gains a **`Dataset`** column — declared intent, one of
  `ad_performance` / `shopee_income` / `product_cogs` — which the harness
  asserts against what the pipeline actually resolved.

Both changes go in `tests/fixtures/generate.py` (the `Expectation` dataclass and
`render_manifest`), then regenerate. **Regeneration is byte-identical for the
CSVs** — only `MANIFEST.md` changes — so the corpus stays frozen.

---

## 6b. Known limitations

### L-4 — the `stage_rows` → `promote_batch` crash window

**The all-or-nothing guarantee covers what the database does, not what happens
to the process in between.** A file is committed by a single `promote_batch`
call, and PostgREST runs one request in one transaction, so the six ad tables
either all take the file or none of them do. That property holds. What is not
covered is the interval *before* the commit request is issued.

`upsert_target` writes a file in two phases
(`buzzly_common.targets.ingest_ad_performance`):

```python
staged = stage_ad_performance(client, batch_id, payload, sync_history=sync_history)
result = client.promote_batch(batch_id, import_job_id, team_id)
```

`stage_rows` buffers the file into `ingestion_staging` over as many requests as
it needs — deliberately **not** atomic, because staging is not production.
Cleanup of that buffer has exactly two paths, and both live in this process:

* `promote_batch` deletes the batch's staged rows inside the same transaction
  that commits it (migration `20260805150000_...:411`), so a successful import
  leaves nothing behind and a rolled-back one keeps its buffer;
* the `except` clause in `upsert_target` (`buzzly_import_pipeline.py:838-841`)
  calls `discard_staging_batch` when the promote raises.

**Neither runs if the worker disappears between the two calls** — an OOM kill, a
container eviction, a `SIGKILL`, a node failure. The staged rows are then
orphaned: nothing reads `ingestion_staging` except `promote_batch`, and only by
batch id, so they are inert rather than dangerous, but nothing deletes them
either. The buffer grows by one file's worth of rows per occurrence, forever.

The window is narrow — one HTTP round-trip — but it is not zero, and it widens
with file size, because `stage_rows` sends 500 rows per request and the last of
those requests is what the crash has to land after.

**Why no fixture can reach it.** Every fixture in this corpus is a *file*, and
this fault is not a property of any file's content. Reaching it requires killing
the worker process inside a specific inter-request gap, which is an
infrastructure event injected from outside the pipeline — the same category as
`UNKNOWN` in the DLQ vocabulary (§2.3), and unreachable for the same reason.
A fixture that appeared to produce it would be measuring the harness's ability
to kill a container, not the pipeline's handling of merchant data. The corpus
therefore documents the gap rather than manufacturing it, and every fixture's
`ingestion_staging` assertion passes because no fixture takes this path.

**Why it went unnoticed until now.** The reset SQL approved in §4 scoped the
staging cleanup as
`ingestion_staging WHERE batch_id IN (SELECT batch_id FROM ingestion_batches WHERE team_id = …)`.
`ingestion_batches` rows are written *by* `promote_batch`, so a batch that never
promoted has none — the subquery returns the empty set for exactly the orphans
it was meant to find. The same scoping bug would have made the harness's
"staging is empty after a refused file" assertion pass vacuously, against an
empty result set, without ever looking at a buffer. The harness now derives the
batch id from the job id (the same `uuid5` the pipeline uses) and proves that
derivation against a genuinely promoted batch once per run.

**Candidate mitigation: a staged-batch reaper keyed on age.** A scheduled job —
`pg_cron` in the database, or a task on the existing two-minute
`buzzly_import_sensor` — deleting `ingestion_staging` rows whose `created_at` is
older than a threshold comfortably above the longest plausible promote
(an hour is ~two orders of magnitude of headroom). Age is a safe key precisely
because of the atomicity design: staging is written and consumed inside one
task, so a batch still buffered an hour later has no live run behind it. A
narrower variant reaps only batches with no `ingestion_batches` row *and* whose
`import_jobs` row has reached a terminal status, which is unambiguous but needs
two joins to establish what age establishes on its own. Neither is implemented,
and neither should be implemented in the same session that measures the
pipeline — a reaper added now would change the thing being measured.

### L-5 — the live Meta test account's `purchase` signal is not a sale

**What the pipeline does, and why it is not going to change.** The Meta
connector stores `conversions` from the purchase action types the approved
mapping names — `offsite_conversion.fb_pixel_purchase` and
`onsite_conversion.purchase` — and nothing else. That is a deliberate division
of responsibility: **the pipeline records what the platform reported; it does
not reinterpret it.** True Net Profit is confirmed against Shopee escrow in a
separate layer, so a wrong number here cannot silently become a wrong profit
figure — it has a second source to disagree with.

**The limitation to state when the figure is used.** The connected account
(`act_1025260845170202`) runs **messaging campaigns**. Measured 2026-08-12, it
reports **29 `onsite_conversion.purchase`** over its whole history, on ads whose
objective is a Messenger conversation rather than a checkout. So the 29 is a
**conversion signal as Meta defines it, not a transactional sale**, and no
revenue is attached to it — which is also why `roas` is stored NULL and the
dashboard honestly shows ROAS 0.0x and revenue ฿0 for this source.

Any thesis sentence that reads "29 purchases" must instead read "29 purchase
*events as reported by Meta* on messaging campaigns". The reconciliation KPI is
unaffected: it checks that our number equals the platform's number, and it does.

**A second measured fact worth keeping**, because it justifies a rule that would
otherwise look like fussiness: `omni_purchase` is **not** a duplicate of
`onsite_conversion.purchase` on this account — the two disagree per day
(2025-07-13: 8 vs 7 · 2025-07-14: 5 vs 6). Summing both, which a naive
"add everything that looks like a purchase" mapping would do, inflates the total
from 29 to 58. The exclusion is load-bearing, not hygiene.

## 7. How to run things

### Run the suite (once Step 2 exists)

```bash
python3 -m pytest tests/test_ingestion_kpi.py -v
```

One command, re-runnable, screenshot-able. That is a hard requirement.

### Regenerate fixtures (deterministic, byte-identical)

```bash
python3 tests/fixtures/generate.py
```

### Airflow REST API

Base `http://localhost:8081`. **Airflow 3 auth is `POST /auth/token` returning a
bearer token, not basic auth** — the old form fails with a misleading 401. There
is a working client to copy rather than rewrite:
`airflow/research/orchestration.py:80-137` (`token()`, `get()`, `dag_runs()`,
`task_instances()`).

Defaults: `BUZZLY_AIRFLOW_URL=http://localhost:8081`,
`BUZZLY_AIRFLOW_USER=airflow`, `BUZZLY_AIRFLOW_PASSWORD=airflow`.

- Trigger: `POST /api/v2/dags/buzzly_import_pipeline/dagRuns` with
  `conf = {"import_job_id": "<uuid>"}`
- Poll: `GET /api/v2/dags/{dag_id}/dagRuns` and
  `GET /api/v2/dags/{dag_id}/dagRuns/{run_id}/taskInstances`

Trigger directly rather than waiting on `buzzly_import_sensor` (which polls
every 2 minutes with a 30s webhook grace). **`buzzly_import_pipeline` must be
unpaused** — triggering a paused DAG returns success and queues a run that never
executes.

### What the harness must create per fixture (the real upload contract)

Mirrors `src/hooks/useImportJobs.tsx:247-280`. **The object must exist in
Storage before the `import_jobs` row**, or the DAG can pick up a job whose
object is missing.

1. Mint `jobId = uuid4()`.
2. Upload bytes to bucket **`imports`**, path
   `{team_id}/{jobId}/{storage_safe_filename}`.
3. Insert `import_jobs` row: `id, team_id, uploaded_by, platform, storage_path,
   original_filename, file_hash (sha256 hex), file_size_bytes`.
4. Trigger the DAG with `conf={"import_job_id": jobId}`.

`file_hash` must be the true sha256 of the bytes — `verify_artifact`
re-derives it and fails the run on a mismatch
(`buzzly_import_pipeline.py:434-440`). `hash_dedupe` compares this hash, so
getting it wrong silently breaks the `ok_20` duplicate case.

Supabase access is service_role over PostgREST:
`airflow/dags/buzzly_common/supabase.py` (`SupabaseClient`, bucket constant
`IMPORTS_BUCKET = "imports"` at `:33`).

### Useful existing tests

`cd airflow && python3 -m unittest discover tests` — offline unit + fixture
tests, no Airflow and no database. `test_ingest.py:245+` runs the *old*
`fixtures/imports/` corpus end-to-end offline; `test_dlq.py` guards the
code/CHECK-constraint drift.

---

## 8. Standing constraints for this work

- Do not touch pipeline business logic without explicit approval.
- **Never** silently patch the pipeline to make a test pass. If something fails,
  **STOP and report** which failures are real bugs vs bad fixtures.
- `Decimal` for all money and metric comparisons. Never `float`.
- Everything re-runnable with one command.
