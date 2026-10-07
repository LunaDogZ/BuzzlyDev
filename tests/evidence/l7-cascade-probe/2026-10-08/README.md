# L-7 mechanism probe — 2026-10-08

Tests the hypothesis recorded in `docs/HANDOFF_INGESTION_KPI.md` (L-7, update
2026-09-09): *deleting a workspace silently erases its import history*.

## Method

`probe.py`, run against the cloud project with the service_role key from
`mock-api/.env`:

1. Create a throwaway workspace (owner = the KPI test workspace's owner).
2. Insert one `import_jobs` row under it.
3. Delete that workspace by id (blast radius asserted = 1 row first).
4. Count the job row again; read `audit_logs_enhanced` since the start.

## Result (`output.txt`, run twice, identical)

| Check | Result |
|---|---|
| job row before delete | 1 |
| job row after delete | **0** |
| `audit_logs_enhanced` rows written | **0** |
| table totals before vs after | identical (probe left nothing behind) |

**The mechanism is real.** `import_jobs.team_id … ON DELETE CASCADE` removes a
workspace's entire import history with no audit trace, while `ad_insights`
(no delete action on `ad_account_id`) keeps the ingested facts.

## What this does and does not prove

* It proves the **door exists** and leaves no trace. It does **not** prove a
  workspace was actually deleted between 2026-08-10 and 2026-09-02 — the nine
  original rows are unrecoverable, so their workspace id cannot be checked.
* The delete ran as service_role, which bypasses anything the app logs itself.
  The app has no workspace-delete code path (`src/` never calls
  `.from("workspaces").delete()`), but RLS policy *"Only team owners can delete
  teams"* lets an owner do it via the API, and the dashboard/SQL editor can too.
* `PROTECTED_BASELINE` was **not** changed by this probe.
