# KPI-7 (OWASP Top 10:2021) — round 3

> **Status: pre-push draft.** Phase 1 is complete; the three migrations are written,
> replica-tested and dry-run, and **not pushed**. Phase 2 (probes, UI regression,
> matrix, ZAP ×2, npm audit ×2) fills in the results below. **No overall KPI-7
> verdict is assigned here.** The verdict is the founder's.

| | |
|---|---|
| **Spec** | `docs/KPI_SPEC.md` § KPI-7, pre-registered `da02849`; thresholds and criteria **not changed** |
| **Round 1 / round 2** | `evidence/kpi7-security/…` and `evidence/report/2026-10-07-kpi7-round2/`, not edited (round 2 received only the founder-authorised, append-only "Post-measurement note") |
| **Migrations (written, not applied)** | `20261007183000_member_writes_follow_role_permissions` · `20261007190000_revoke_unscoped_definer_functions` · `20261007193000_tier_and_discount_functions_check_caller` |

## What round 3 changes

1. **Viewer writes on the 21 tables** in round 2's "Remaining A01 findings", plus
   `import_jobs` and the `imports` bucket. 47 membership-only write policies are
   dropped and replaced by `has_permission()` rules that mirror the frontend's
   role table. Per-table rationale: `PHASE1.md`.
2. **Nine SECURITY DEFINER functions** that `anon` and `authenticated` could call
   with no caller check have EXECUTE revoked. These include the cross-tenant leak of
   report recipients' emails and the cross-tenant campaign auto-stop. Full sweep of
   all 66 functions: `FUNCTIONS.md`.
3. **Four SECURITY DEFINER functions that the frontend calls** get a caller check
   inside the body; the rest of each body is the live text, unchanged.
   `evaluate_inactivity_tier_downgrades`, `sync_tier_from_lifetime_points` and
   `update_tier_retention_period` now require an active, approved employee
   (`is_employee`); before, anon passed the first two and an inactive or
   unapproved employee passed all three. `get_available_discounts` now returns
   nothing unless `p_customer_id` is the caller. Consequence: a session with no
   user (pg_cron as postgres, service_role) is refused by the three tier
   functions; nothing calls them that way today.

## Founder decisions recorded for this round (2026-10-07)

| Item | Decision |
|---|---|
| `social_posts`, `social_comments`, `post_personas` | `edit_campaigns` |
| `reports`, `scheduled_reports`, `email_campaigns` | `export_data` |
| `sync_history`, `conversion_events` | drop member writes, no replacement |
| `campaign_tags` | split: SELECT with identical USING + writes on `edit_campaigns` |
| `tags` DELETE | `edit_campaigns` |
| `team_activity_logs` | own rows only (`user_id = caller`) accepted |
| Anon-callable DEFINER functions | fix in round 3 (A01: unauthenticated cross-tenant access) |
| Round-1 anon probe for the round-2 close-out | run with the service key as a declared one-time exception (read-only positive control) |
| Four DEFINER functions with a frontend caller (`FUNCTIONS.md` §B) | check inside the function (`20261007193000`); revoking from anon alone rejected |
| `award_loyalty_points` | not fixed; recorded as an A04 residual |
| Fixture seed rows for the round-3 tables | allowed in the fixture script, setup only |

## Residual findings (recorded, not fixed)

- **A09: forged activity-log text.** Under the own-rows rule, any active member,
  a viewer included, can insert `team_activity_logs` entries in their own name with
  any `action` text (for example a fake `member_removed`). Other people's names can no
  longer be forged. Closing this needs the log write to move into the database or
  behind `can_manage_team` per action. No redesign this round (founder decision).
- **Known UX issue: write buttons are still shown to roles that may not write.**
  Only `src/pages/Campaigns.tsx:564, :592, :608` hides write controls by role. On
  every other page a viewer (or an editor, where the key is `export_data` or
  `manage_settings`) still sees create / edit / delete buttons, and after the push a
  click returns a database (RLS) error instead of succeeding. Frontend not changed
  (scope guard).

- **A04: mission points without the mission.** `award_loyalty_points(p_action_type)`
  (SECURITY DEFINER, signed-in callers only) awards any active mission's points
  once per caller without checking that the action happened, so a customer can
  call it directly and claim, for example, the `pro_upgrade` points. It affects
  only the caller's own wallet and tier, not another tenant. Not fixed (founder
  decision).

## pg_cron is not installed on the cloud project

`pg_available_extensions` reports `pg_cron` with `installed_version = NULL`, and
`cron.job` does not exist (read 2026-10-07). `20260314003003_campaign_cron_job.sql`
(campaign auto-stop, every 15 min) and `20260320000010` (weekly digest, Monday
09:00) each schedule their job only if pg_cron is present, and otherwise raise a
NOTICE and continue. No migration schedules
`process_scheduled_reports_with_preferences` at all, and no Edge Function calls it.
**So the database-side campaign auto-stop and the weekly digest have never run on
the cloud project, and nothing has ever sent a scheduled report.** (The `campaign-auto-stop` Edge Function is a separate path with
its own logic; whether anything invokes it was not part of this check.) Round 3 does not
install pg_cron. The revokes keep EXECUTE for `postgres`, so a future cron job
running as `postgres` still works, which was proven on the replica. The three tier
functions in item 3 above would refuse such a job.

## Exposure windows (grant history only, not probed)

### The report-recipient leak

Grant history only, not probed (detail in `FUNCTIONS.md`).
`process_scheduled_reports_with_preferences()` was created by
`20260320000010_notification_preferences_integration.sql` (first committed
2026-03-18). No migration granted or revoked it explicitly, and the project's
default privileges give `anon` and `authenticated` EXECUTE on every function
`postgres` creates in `public`. **From the moment that migration was applied
until `20261007190000`, anyone holding the public anon key could call it.** The
ledger does not record apply times. pg_cron was never installed, so not even the
intended scheduled run ever happened. Whether the function was ever *called*
cannot be determined from grants.

### `debug_dashboard_visibility()`

Created only by `20260218221500_debug_func.sql` (first committed `04ffa17`,
2026-02-19 04:02 +0700), which grants it **explicitly**:
`GRANT EXECUTE … TO anon` (line 83), `… TO service_role` (84),
`… TO authenticated` (85). No later migration redefines, revokes or drops it.
The live ACL on 2026-10-07 still holds PUBLIC, anon and authenticated. **From the
moment that migration was applied until `20261007190000`, anyone holding the
public anon key could read the global workspace / ad-account / insight counts and
the three latest insights with their account names and workspace ids.** The
earliest possible date is the 2026-02-19 commit; the ledger does not record apply
times. Whether it was ever called cannot be determined from grants.

## Pre-push measurements

**Fixture.** `scripts/kpi7-round2-fixture.mjs setup` now also seeds one marker row
(`kpi7r3-seed`) per round-3 table in both the test and the outsider workspace,
including two campaigns (one with an ad account, one without). `import_jobs` is
deliberately not seeded, because a `pending` insert fires the pipeline webhook. Setup was
run twice; the second run returned identical ids (`a01/fixture-setup-{1,2}.json`).

The first attempt failed before writing anything
(`a01/fixture-setup-0-failed-listUsers.txt`). Round 2 created all seven accounts
on first run, so the script's "account already exists" branch had never run, and
both of its lookups fail on this project: `profile_customers` has no `email`
column, and `auth.admin.listUsers` answers "Database error finding users". The
fixture now prefers the user id it recorded in round 2, checked against the email
with `getUserById`. Not investigated further, and not changed: `auth.users` holds 30
rows with NULL `confirmation_token`/`recovery_token`/`email_change`, a known
cause of that GoTrue error. It would also affect the dashboard's user list.

**`campaigns` SELECT before the push** (`scripts/kpi7-round3-campaigns-select.mjs`,
user JWTs, no service key, run twice, runs identical):

| Role | HTTP | Count | Content-Range | Same ids as declared |
|---|---|---|---|---|
| viewer | 200 | **2** | `0-1/2` | ✅ |
| editor | 200 | **2** | `0-1/2` | ✅ |

Raw: `a01/campaigns-select-before-{1,2}.json`.

## Post-push (2026-10-07, after the founder's push) — partial

Phase 2 was paused at the smoke test for the founder's Postgres log check, and
resumed after the `ad_insights` 500s were classified as pre-existing (see "Known
issue" below). Results:

- **Migrations applied:** `supabase migration list --linked` shows `20261007183000`,
  `20261007190000` and `20261007193000` in both columns (`post-push/migration-list.txt`).
- **`campaigns` SELECT after the push:** viewer **2**, editor **2**, `0-1/2`, the
  same ids as declared, two runs identical; **equal to the pre-push table**
  (`a01/campaigns-select-after-{1,2}.json`).
- **Live function definitions re-read:** all three tier functions carry
  `IF auth.uid() IS NULL OR NOT public.is_employee(auth.uid())`;
  `get_available_discounts` carries the `p_customer_id IS DISTINCT FROM auth.uid()`
  guard. ACLs unchanged.
- **Production negative probes** (`scripts/kpi7-round3-function-probe.mjs`, anon key
  plus a non-employee customer login, no service key): **9/9 as declared, two runs
  identical** (`post-push/function-probe-run-{1,2}.json`).

  | Function | anon | signed-in non-employee customer |
  |---|---|---|
  | `evaluate_inactivity_tier_downgrades` | HTTP 400 `P0001 employees_only` | HTTP 400 `P0001 employees_only` |
  | `sync_tier_from_lifetime_points` | HTTP 400 `P0001 permission_denied: employees only` | same |
  | `update_tier_retention_period` (non-existent tier id, so a failed guard could not write) | HTTP 400 `P0001 employees_only` | same |
  | `get_available_discounts(<another customer's id>)` | 200, 0 rows | 200, 0 rows |

  ⚠️ **The discount rows prove nothing on production.** The positive control
  (own id) also returns 0 rows, because production holds **0 discounts in total**
  (read 2026-10-07). An empty answer is therefore the only possible answer, fixed
  or not. The discriminating test is the replica one (`FUNCTIONS.md`): with the
  live definition, customer A asking for B's id got 1 row; with the fix, 0. No
  discount was created on production to make the probe discriminating, because
  the discount catalogue is global and every customer would see it.
- **Employee support page:** **the positive path for active employees was tested
  on the local copy only, not on production.** No employee login is available,
  and no employee account was created (founder decision).

## Known issue — intermittent HTTP 500 on `ad_insights` reads (classified pre-existing, not a round-3 regression)

**Observed after the push, in the deployed app** (`post-push/smoke*/`). `/dashboard`
intermittently receives HTTP 500 on its `ad_insights` reads (`HEAD …select=id…`
counts and `GET …select=date…`), for owners and editors alike:

| Account | Completed walks (logged) | Walks with ≥1 `ad_insights` 500 | `ad_insights` 500s per walk |
|---|---|---|---|
| `e2e@buzzly.test` (owner, real workspace) | 3 smoke | 1 | 0, 9, 0 |
| `kpi7r2-owner` (test workspace) | 2 smoke + 1 capture | 1 | 6, 0 · 0 |
| `kpi7r2-editor` (test workspace) | 3 smoke + 1 capture | 4 | 2, 5, 10 · 1 |
| `kpi7r2-viewer` (test workspace) | 2 capture | 0 | 0 · 0 |

Five further capture walks died on a 30 s page-load timeout before measuring
anything, and one earlier editor capture walk (0 errors) was not logged. Neither
is counted above.

- **Error code:** response header `proxy-status: PostgREST; error=57014`, which is
  Postgres `query_canceled` (statement timeout, 8 s for `authenticated`, or a
  cancel request) (`post-push/ad-insights-500-capture.log`).
- **User-visible effect:** pages still render after retries (the `e2e` dashboard
  shows its 81.9K impressions), but in the walk with 9 failures the data-source
  selector opened on a **different default label**, "ข้อมูลจริงทั้งหมด" instead of
  "ไฟล์ที่อัปโหลด (Airflow)". The label depends on the per-source counts that failed.
- **Single requests succeed:** the same queries sent one at a time return 200 for
  editor, owner and viewer, at **0.5–1.5 s each** (`post-push/ad-insights-direct-requests.txt`).
- **The query is fast in the database:** `EXPLAIN ANALYZE` as the editor plans in
  ~20 ms and executes in 6–18 ms (`post-push/ad-insights-explain-as-editor.txt`).
  `pg_stat_activity` showed an idle database with no long-running statements.
- **Its plan touches nothing round 3 changed:** `ad_insights`, `ad_accounts`,
  `workspace_members`, `workspaces`, and the helpers `is_team_member`, `has_role`
  and `has_employee_role`. None of their policies changed and none was revoked.

**The same failure existed in September, before round 3**, in the KPI-4/KPI-5 raw
evidence (searched read-only):

- **k6 (KPI-5)**, `evidence/kpi5-k6/<commit>/run-N/metrics.csv`, HTTP 500 on
  `/rest/v1/ad_insights`:

  | Run | ICT window | HEAD 500 | GET 500 |
  |---|---|---|---|
  | `4c13722/run-1` | 2026-09-07 16:08:49–16:16:24 | 134 | 89 |
  | `4c13722/run-2` | 2026-09-07 16:48:11–16:50:39 | 7 | 5 |
  | `4c13722/run-3` | 2026-09-07 17:25:54–17:32:16 | 260 | 146 |
  | `29a88bb/run-1` | 2026-09-09 15:40:31–15:41:09 | 7 | 3 |
  | `29a88bb/run-2` | 2026-09-09 16:19:06–16:20:27 | 11 | 4 |
  | `29a88bb/run-3` | 2026-09-09 16:58:13–17:05:22 | 45 | 48 |

  In the heavier runs, 500s also hit `ad_accounts`, `profile_customers` and
  `workspaces`; `/auth/v1/token` answered 504 and 429.
- **Lighthouse (KPI-4)**, `evidence/kpi4-lighthouse/<commit>/<form>/R2-dashboard/run-N.json`
  (`network-requests` audit), a **single-user page load with no concurrent load**,
  `/rest/v1/ad_insights` 500 in **8 of 24** dashboard runs:
  `4c13722` desktop run-3 (×5, 2026-09-07 08:31Z), mobile run-1 (×5, 08:36Z),
  run-4 (×7, 08:38Z); `29a88bb` desktop run-3 (×7, 2026-09-08 12:50Z),
  run-5 (×9, 12:51Z), mobile run-3 (×7, 12:55Z), run-4 (×13, 12:56Z),
  run-6 (×4, 12:57Z).
- **Not captured in September:** no response bodies or headers. k6 records only
  `error_code 1500` (generic HTTP 500), and Lighthouse records only `statusCode`.
  So September proves **the same status on the same endpoint**, not the same
  `57014`. The strings `57014`, "canceling statement" and "statement timeout" occur
  in no KPI-4/KPI-5 file.

**Postgres log check (founder, 2026-10-07).** Supabase Dashboard → Logs →
Postgres shows `57014 canceling statement due to statement timeout` from
**20:19 ICT onward**. **Limitation:** the query window was the last 60 minutes
(19:55–20:55), which **starts after the push**, so the log neither shows nor
rules out the pre-push state. It confirms that today's 500s are statement
timeouts, not cancel requests.

**Classification (founder decision, 2026-10-07): the pre-existing KPI-4/KPI-5
data-access bottleneck, not a round-3 regression.** Basis:
(a) the September k6 and Lighthouse evidence of the same HTTP 500 on
`/rest/v1/ad_insights`, including single-user Lighthouse dashboard loads;
(b) the query plan touches nothing round 3 changed;
(c) single requests are fast in the database (6–18 ms execution).
**Caveat:** September captured status codes only, so `57014` itself is **not
confirmed for September**; the match is the status code and the endpoint. Nothing
was rolled back. The remedy belongs to the KPI-4/KPI-5 work
(`docs/KPI_FAILURE_ANALYSIS.md`), not to KPI-7.

## Known non-security issue — `auth.users` rows with NULL token columns

30 of 79 `auth.users` rows have NULL `confirmation_token`, `recovery_token`,
`email_change` and `email_change_token_new` (read 2026-10-07). GoTrue's
`auth.admin.listUsers` answers "Database error finding users" on this project. A
NULL in those string columns is the known cause, but that link is not verified
here. It broke the fixture's account lookup (worked around by using recorded ids;
see "Pre-push measurements"), and would also affect any admin user listing.
**Not fixed** (founder decision).

## Phase 2 — to be filled in after the push

- [x] `campaigns` SELECT for viewer and editor after the push: equal (see Post-push)
- [ ] PostgREST probe, 7 accounts × every affected table, ×2, identical
- [ ] Function grants re-read live; anon `rpc/` call → 42501
- [ ] UI regression as editor and as viewer on every page that reads or writes
      these tables
- [ ] Matrix A01–A10, ZAP baseline ×2, `npm audit --omit=dev` ×2; criterion 4 per
      round 1's comparison definition (quoted)
- [ ] "Changes since round 2"
