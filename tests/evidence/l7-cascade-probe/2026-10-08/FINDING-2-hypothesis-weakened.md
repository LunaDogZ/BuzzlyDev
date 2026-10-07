# L-7 — the cascade hypothesis does not explain all of the loss (2026-10-08, later)

The probe in `README.md` shows that deleting a workspace silently cascades its
`import_jobs` away. A follow-up read of the live schema and data cuts against
that being *the* cause.

## Two facts (live, read 2026-10-08)

1. **A workspace that owns ad data cannot be deleted.** `ad_accounts`,
   `campaigns`, `ads`, `ad_groups` and `subscriptions` reference `workspaces`
   with **no delete action** (`confdeltype = 'a'`), so `DELETE FROM workspaces`
   fails while any of those rows exist.
2. **The imported rows' workspace still exists.**

   | ad_insights `data_source='import'` | created | workspace (via ad_accounts.team_id) | exists |
   |---|---|---|---|
   | 273 rows | 2026-08-05 | E2E Walk Workspace `b022da17…` | **yes** |
   | 800 | 2026-09-07 | KPI-5 Load Test Workspace | yes |
   | 60 | 2026-09-09 | E2E Walk Workspace | yes |
   | 12 | 2026-10-07 | Ingestion KPI harness | yes |

`resolve_ad_account` opens the account under the *job's* `team_id`, so the job
that produced the 273 rows of 2026-08-05 belonged to E2E Walk Workspace — which
was never deleted. Its job row is nonetheless gone.

## Reading

* At least one of the vanished jobs was **not** removed by a workspace cascade.
  The cascade remains a real door (and is why item 3 adds a delete audit), but
  it is no longer a sufficient explanation for L-7.
* Inference, not proof: that the 2026-08-05 job was one of the 9 counted in the
  2026-08-10 baseline rests on dates — the original rows cannot be listed.
* Remaining candidates include a direct delete on `import_jobs` (service_role,
  dashboard, SQL editor) or a delete on its other parent paths. Nothing in this
  repo issues one outside the harness's team-scoped reset.

L-7 stays open.
