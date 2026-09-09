# KPI-6 — preparing the study environment, 2026-09-09

**What this records.** On 2026-09-05 the SUS protocol listed six prerequisites
and two of them were hard blockers: T4 had no failed import to find, and T1 had
almost no data inside the window it asks about. This is what was done about
them, verified **through the study account's own token** — every check below
went through RLS as the participant's session will, not through `service_role`.

## Before and after

| # | Prerequisite | 2026-09-05 | **2026-09-09** |
|---|---|---|---|
| 1 | Production URL | ⬜ not deployed | ✅ deployed, carries HEAD |
| 2 | Study account | ⬜ "not created" | ✅ **it already existed** — see below |
| 3 | T4 needs a failed import | 🔴 all ingestion tables empty | ✅ one failed import, 7 rejections, 7 reasons |
| 4 | T1 needs data in the last 30 days | 🔴 41 rows, newest 2026-08-14 | ✅ **80 rows** in the window |
| 5 | T2/T3 need ≥ 2 sources | ✅ | ✅ `import` 333 · `mock` 82 · `meta_live` 33 |
| 6 | T5 needs a coverage range | ✅ → 2026-08-14 | ✅ **2025-07-10 → 2026-09-09** |

## #4 — the data, and why it was not inserted directly

A fixture was generated (`study-fixture/generate.mjs`, seed `20260909`,
deterministic, regenerates byte-identically) covering 2026-08-11 → 2026-09-09,
60 rows, in the Shopee export format with **Buddhist-era dates**. It was then
**uploaded through the application by a signed-in user and ingested by the real
Airflow pipeline** — `succeeded, 60 of 60 rows`.

Inserting the rows straight into `ad_insights` with `service_role` would have
been faster and would have produced data whose provenance was a lie: rows marked
`data_source = import` that no import ever produced. T2 asks the participant to
name where the numbers came from. The answer has to be true.

**The fixture was refused on its first attempt, and that was correct.** The
first version put two rows on each day — one per ad placement — and the pipeline
rejected the file whole: *30 of 60 rows, `duplicate_row`*. The validator
identifies a row by `(date, campaign_name, ad_group_name, ad_name)`
(`airflow/dags/buzzly_common/validate.py:80`), and `ประเภทโฆษณา` maps to
`ad_type`, which is **not** in that key. Two rows differing only by placement are
one row as far as the validator is concerned, and since the target's ad id is
derived from campaign + group + ad name (`targets.py:370`), accepting both would
have let one silently overwrite the other. **The refusal protected the data; the
fixture is what had to change** — each row now carries its own ad name.

Worth carrying into the thesis as a limitation stated plainly: *a merchant
export that splits one day's figures by placement, without distinct ad names,
is refused in full rather than silently collapsed.*

## #3 — the failed import, produced rather than seeded

`fixtures/imports/edge-cases/broken-rows.csv` was uploaded the same way. Result:
`failed`, 10 rows read, **0 imported**, **7 quarantined**, with a downloadable
bilingual error report. Seven distinct reasons — missing date, impossible date
(31/02/2569), negative impressions, non-numeric clicks, clicks exceeding
impressions, a duplicate row, and a short row. Full record:
`evidence/ingestion-e2e/2026-09-09/`.

**A second failed import was deleted, and this says why.** The refused first
version of the study fixture (30 × `duplicate_row`) also appeared on `/imports`.
T4 asks *"how many rows did the system reject, and why"* — with two failed
files that question has two answers and the task stops being scorable. That job
row was created by this preparation twenty minutes earlier, not by any real
history, so it was removed: blast radius counted before the delete (1 job, 30
row-errors, both confirmed), executed by id, and verified after — 3 jobs remain,
exactly one failed, `import_row_errors` back to 7.

## #2 — the study account, which turned out to already exist

`sus-study@buzzly.test` (`6ea65de9…`) was created on **2026-09-05 17:20**, the
same day the protocol was written, and signed in once 27 seconds later. It is
`viewer` on the study workspace, active, email-confirmed, and sees exactly one
workspace.

Two things about it are worth recording rather than assuming:

**It has no `profile_customers` row.** Neither does `e2e@buzzly.test`, the
account the visual walk uses, and every customer page renders for that one — so
this is the normal state for these accounts, not a fault to fix before Friday.
It has a `customer` row (backfilled 2026-09-06).

**It is not read-only, and it was tested rather than trusted:**

| attempt | result |
|---|---|
| rename the workspace | ✅ refused — `200` with an empty body, i.e. RLS matched no row; name unchanged when read back with `service_role` |
| delete `ad_insights` rows | ✅ refused — same shape, nothing deleted |
| **insert an `import_jobs` row** | 🔴 **allowed — HTTP 201** |

The insert policy is `is_team_member(...) AND uploaded_by = auth.uid()` and does
not consult the role; `src/pages/Imports.tsx` has no role check either. The
migration's own comment says "team members can start an import", so this is
design, not oversight — but the protocol's phrase "read-only" was wrong and has
been corrected. The junk row this test created was deleted immediately (counted:
1, deleted by `storage_path`, verified gone).

**Note on the empty-body refusal.** Both blocked writes answered `HTTP 200` with
`[]`, not an error. Reading that as success is the trap recorded in the RLS
notes: the check is not the status code, it is reading the row back afterwards.
Both were read back.

## The password

None was recorded — not in the repo, not in any session note. The account had
been created, signed in once, and left. A password was set on 2026-09-09 so the
facilitator can sign in. If one had been written down elsewhere it no longer
works.

## What is still open for Friday

* **`APP_BASE_URL` is set to `http://localhost:8080`** on the cloud project —
  confirmed by matching the secret's digest against the hash of that string, so
  this is not a guess. It is *set*, not missing, which is what earlier notes
  said. Nothing in the tasks touches it; a participant who wandered into
  "connect Meta" would be bounced to localhost. One command fixes it and it
  needs the founder's hands: `supabase secrets set APP_BASE_URL=https://buzzly-dev.vercel.app`.
* **The pilot session has not been run.** The protocol requires one, uncounted,
  before the first real participant.
