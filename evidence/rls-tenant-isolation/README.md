# Cross-tenant isolation — measured before and after `20260828120000`

Question asked: *does workspace A actually fail to read workspace B's ad data?*

Answered behaviourally, not by reading policy text: sign in as a real customer
over `/auth/v1/token`, read other workspaces' rows through PostgREST, and
resolve each row's true owner with `service_role` — i.e. through a path the
policies under test do not control.

Reproduce:

```bash
node scripts/dev-employee-fixture.mjs create owner   # prints the export lines
export OWNER_E2E_EMAIL=… OWNER_E2E_PASSWORD=…
node scripts/tenant-isolation-probe.mjs evidence/rls-tenant-isolation/after.json
node scripts/dev-employee-fixture.mjs destroy
```

Actors: customer `e2e@buzzly.test` (owns `b022da17…`, "E2E Walk Workspace")
reading against `7c3976f5…` ("TEST", a different owner), plus a throwaway
`owner` employee for the employee leg.

## Result

| | before | after |
|---|---|---|
| A — ads path across tenants (6 tables) | isolated | isolated |
| B — `social_posts` visible to the customer | 89 of 89, **76 foreign** across 4 workspaces | 13, **0 foreign** |
| B — `customer_activities` | 5,070 of 5,070 | 0 foreign |
| B — `feedback` | 100 of 100, from 30 users | 0 foreign |
| C — owner employee reach | 100 / 100 / 5,070 / 967 | 100 / 100 / 5,070 / 967 |
| D — forge an audit row as another user | **written** | refused 403 |
| D — anon forges an error row as a real user | **written** | refused 401 |
| E — customer reads a row that IS theirs | (vacuous) | readable in all three |

Section A was already correct before the fix and is included as the regression
guard: `ad_insights`, `ads`, `campaigns`, `ad_accounts`, `workspaces` and
`workspace_members` all returned 0 to the customer while `service_role` returned
82/20/4/4/1/1 on the identical filter. The workspace design was never the
problem.

## Why the probe is built the way it is

**Every negative is paired with a positive.** "The customer saw 0 rows" is only
evidence when `service_role` saw rows on the same query; otherwise the table is
reported INCONCLUSIVE. Section E exists for the same reason in the other
direction — after the fix the customer reads 0 feedback rows, which is equally
what a policy that locked everyone out would produce, so E writes a row that
genuinely belongs to the customer and requires the surviving policy to hand it
back. Section D confirms an accepted write by *finding the row with
service_role*, not by trusting the status code.

**`Prefer: return=minimal` on every write probe.** The first run used
`return=representation` and read 403 as "not exploitable". That was wrong:
representation appends `RETURNING`, which also needs a SELECT policy the
customer does not have, so the refusal came from the read and said nothing about
the write. With `return=minimal` — what `supabase.from().insert()` actually
sends — both forgeries succeeded. The finding was nearly dismissed by the
measurement instrument, not by the system under test.

**Counts come from the `content-range` header, not `data.length`.** PostgREST
caps a payload at 1000 rows, which understated `customer_activities` as
"1000 of 5070" on the first run when the true figure was all 5,070.

**Do not audit RLS from the migration files.** `supabase/migrations/` still
contains `USING (true)` policies on `ads` and `ad_groups`
(`20260218000001_consolidated_rls.sql:666,672`) and a `nuclear_rls_fix` that was
marked-applied-but-never-run. None of that reflects the live database, where
both tables are correctly scoped by `is_team_member`. The live catalog came from
`supabase db dump --linked` and agreed with the behavioural result on every
table.

## Rows written by the probe

Sections D and E insert into `audit_logs_enhanced`, `error_logs`, `feedback` and
`customer_activities`, each tagged with the run's `probe_id`, and delete exactly
those rows before exit — aborting if the delete count does not match the write
count. Table totals after the after-run were unchanged: 967 / 67 / 100 / 5,070.
