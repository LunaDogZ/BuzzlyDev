# KPI-7 (OWASP Top 10:2021) — round 3

| | |
|---|---|
| **Date measured** | 2026-10-07 (ICT) |
| **Commit** | `f0e05d9` (`f0e05d9ccde87ea99eaffd9d8e978e1cf5af3d01`); after it, only evidence and `scripts/kpi7-round3-*` changed |
| **Deployed bundle** | `https://buzzly-dev.vercel.app/assets/index-WAh02M2U.js`, the same file round 2 measured (frontend not changed) |
| **Migrations** | **applied** (founder push): `20261007183000_member_writes_follow_role_permissions` · `20261007190000_revoke_unscoped_definer_functions` · `20261007193000_tier_and_discount_functions_check_caller` |
| **Spec** | `docs/KPI_SPEC.md` § KPI-7, pre-registered `da02849`; thresholds and criteria **not changed** |
| **Round 1 / round 2** | `evidence/kpi7-security/…` and `evidence/report/2026-10-07-kpi7-round2/`, not edited (round 2 received only the founder-authorised, append-only "Post-measurement note") |

**No overall KPI-7 verdict is assigned here.** The four pre-registered criteria
are reported with their raw results; the verdict is the founder's.

## The four criteria — raw results

| # | Criterion (verbatim from the spec) | Raw result, round 3 |
|---|---|---|
| 1 | Applicability matrix answers **10/10** categories. An `N/A` is only valid with a written reason. | **10/10 answered, 0 `N/A`.** All ten rows re-verified today (`matrix/matrix.md`, raw `matrix/commands-output.txt`). **A01 rated "mitigated"**: A01-6 (round 2's open finding) and A01-7/A01-8 (found this round) closed and verified; four accepted residuals listed in the row |
| 2 | ZAP baseline: **0 High and 0 Critical** alerts. Medium / Low / Informational are recorded, analysed, and each given either a remediation plan or a written justification for acceptance. | **0 High, 0 Critical in both runs.** 3 Medium · 2 Low · 4 Informational, the same nine alerts (plugin id and risk) as round 2. Analysis below |
| 3 | `npm audit --omit=dev`: **0 Critical** vulnerabilities in production dependencies. High/Moderate recorded with the same treatment as (2). | **0 Critical.** 7 High · 2 Moderate over 188 production packages, the same nine packages and advisory ids as round 2 |
| 4 | Both scans run **twice on the same commit**; the two results must agree. A disagreement is itself reported and investigated before any verdict is written. | See "Criterion 4" below: by round 1's comparison definition, both scans agree |

Pre-scan smoke (mandatory per spec): `node scripts/kpi7-smoke.mjs` → **10/11**,
**0 CSP violations**. The one failure is `2c realtime wss connects`, the same open
item as rounds 1 and 2 (`smoke-prescan/smoke-run-1.json`; output moved there from
`evidence/kpi7-security/<commit>/smoke/`, as round 2 did).

### Criterion 4 — comparison definition (round 1, quoted) and result

Round 1 defined agreement for the two scans as follows:

- ZAP (`evidence/kpi7-security/29a88bb…/summary.md`, § "Criterion 4"): *"The two
  ZAP runs raise exactly the same alerts. What differs is **how many URLs each
  alert was seen on** … **The finding set — which is what the criterion is about
  — is stable.** Reporting the instance counts as identical would have required
  not looking."*
- npm audit (`evidence/kpi7-security/eae9135…/summary.md`, § "Criterion 4"):
  *"Two runs on this commit and lockfile agree on **totals, package set and
  per-package severity**."*

Applied to round 3:

- **ZAP:** the finding set is identical across the two runs: the same 9 alerts,
  plugin ids and risk levels, the same 3/2/4 split, 0 High/Critical in both.
  Instance counts differ on three alerts (table under "ZAP findings"), the same
  kind of difference rounds 1 and 2 recorded.
- **npm audit:** run 1 and run 2 are identical (`vulnerabilities` and `metadata`
  objects equal): totals, package set and per-package severity agree, on lockfile
  `a2679b7f…`.

## Changes since round 2

| | Round 2 (`f7f60f0`) | Round 3 (`f0e05d9`) |
|---|---|---|
| A01-6: member writes on 21 tables + `import_jobs`/`imports` path into `ad_insights` | 🔴 open (static evidence) | ✅ closed, `20261007183000`; **428/428 PostgREST cases as declared, ×2 identical** |
| DEFINER functions executable by anon/authenticated without a caller check | not examined | **A01-7**: 9 found, EXECUTE revoked (`20261007190000`); **18/18 `42501`, ×2** |
| DEFINER functions with a frontend caller and a wrong-caller check | not examined | **A01-8**: 4 found, checks added (`20261007193000`); **9/9 ×2** on production + replica |
| Round 1's anon probe | not re-run | re-run ×2 (declared one-time service-key exception): same 11 anon-readable catalogue tables |
| `seed_demo_insights` | EXECUTE revoked, DROP pending | dropped (`20261007120000`, applied before round 3); `types.ts` regenerated (`94e07a4`) |
| Migrations in corpus / `CREATE POLICY` | 246 / 560 | 249 / 609 |
| Residuals recorded | — | A04-1 (`award_loyalty_points`), A09-3 (activity-log action text) |
| Application source / `vercel.json` / lockfile | — | unchanged except the regenerated `types.ts` |
| ZAP / npm audit | 9 alerts, 0 High/Crit · 0 Crit, 7 High, 2 Mod | **same** alert set · **same** packages and advisories |
| Known issues found while measuring | — | intermittent `ad_insights` 500 (classified pre-existing KPI-4/5 bottleneck); `auth.users` NULL token columns; pg_cron not installed |

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

## Post-push (2026-10-07, after the founder's push)

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

### Observability, 20:50–21:50 ICT today (observation only, not proof of H1)

Founder's Supabase dashboard screenshots, copied to `post-push/observability/`
(checksums in `SHA256SUMS`). They cover **today's window only, not the September
runs**:

- **Memory commitment above the commit limit for the whole hour**, including the
  idle period before testing (`2151-memory-usage-swap-and-commitment-2050-2150.png`).
- **Swap 400–700 MB** while "used" memory stayed small (same file).
- **CPU IOwait spikes up to ~100%** around 21:30–21:40, with very little user CPU
  (`2151-cpu-iowait-and-network-2050-2150.png`).
- **Disk IO budget nearly depleted:** dashboard banner, "after depletion, disk
  throughput will return to its baseline of 5 MB/s"
  (`2149-logs-banner-disk-io-budget-5mbs-baseline.png`), and Supabase's e-mail
  at 21:45 (`2146-email-disk-io-budget-warning.png`,
  `2148-email-disk-io-budget-warning-2.png`).
- Disk IOPS / throughput, connections and disk usage for the same hour:
  `2151-disk-iops-and-throughput-2050-2150.png`,
  `2151-db-connections-and-disk-usage-2050-2150.png`.
- **57014 timeouts after 21:45 may be partly caused by budget depletion.**

**This round's own load in that window** (from evidence-file timestamps, ICT):
PostgREST probes and teardowns 21:04–21:19; UI regression walk 21:20–21:30;
direct `campaigns` reads incl. parallel bursts 21:30–21:33; the three burst runs
21:39:48–21:46; pre-scan smoke ~21:47; ZAP 21:48–22:00 (unauthenticated, landing
and public routes). The IOwait spikes around 21:30–21:40 overlap this round's own
requests, and nothing here separates their share from the background state.

The screenshot `2149-…` shows the dashboard's organisation name, which contains
a personal e-mail address, plus workspace and user ids in request URLs.

## Known non-security issue — `auth.users` rows with NULL token columns

30 of 79 `auth.users` rows have NULL `confirmation_token`, `recovery_token`,
`email_change` and `email_change_token_new` (read 2026-10-07). GoTrue's
`auth.admin.listUsers` answers "Database error finding users" on this project. A
NULL in those string columns is the known cause, but that link is not verified
here. It broke the fixture's account lookup (worked around by using recorded ids;
see "Pre-push measurements"), and would also affect any admin user listing.
**Not fixed** (founder decision).

## A01 verification — PostgREST probe (writes)

`scripts/kpi7-round3-probe.mjs`: real JWTs, anon key only, no service key in the
process. `Prefer: return=minimal,count=exact`; every accepted INSERT/DELETE
confirmed by the **owner's** read-back; expectations hand-declared from the role
table. Fixture: `scripts/kpi7-round2-fixture.mjs setup|teardown`, the only
service-key user; setup seeds marker rows, teardown removes probe rows by marker
behind a blast-radius guard.

**428/428 as declared, run 1 and run 2 identical (including attempt counts), 0
statement-timeout retries** (`a01/probe-run-{1,2}.json`). Coverage, every
case × 7 accounts (owner, admin, editor, viewer, suspended, removed, outsider):

- INSERT / UPDATE / DELETE as the migration defines them on `workspace_api_keys`,
  `ads`, `ad_groups`, `campaigns`, `campaign_ads`, `campaign_tags`, `tags`,
  `budgets`, `customer_personas`, `ad_personas`, `post_personas`,
  `workspace_ad_persona`, `social_posts`, `social_comments`, `reports`,
  `scheduled_reports`, `email_campaigns`, `sync_history`, `conversion_events`;
- `team_activity_logs`: own row (members allowed) and forged actor (all refused);
- `import_jobs`: own `uploaded_by` (owner only) and forged (all refused), inserted
  with status `cancelled` so the pipeline webhook never fires;
- `imports` bucket upload into `<test team>/…` (owner only);
- `campaign_tags` SELECT of the seed link (members 1, others 0);
- the test-workspace owner against the outsider workspace: UPDATE/DELETE of 7
  outsider seeds → 0 rows; INSERT into it → 403.

Positive controls inside the run: every allowed write (including the **editor's**
writes on `edit_campaigns`/`edit_prospects` tables) landed and was read back by
the owner; every refused DELETE left its target row in place (owner read-back = 1).

Teardown after each run found exactly the rows the declared rules leave behind
(the editor's own inserts on the five tables where an editor may insert but not
delete, four own-row activity logs, the owner's `import_jobs` row and upload).
Both teardown reports identical (`a01/teardown-{1,2}.json`). Teardown on a clean
state found 0 rows (`a01/teardown-0-clean.json`), which proves nothing on its own;
the post-probe reports are the proof.

Revoked functions: `post-push/revoked-functions-acl-live.csv` (all nine:
`postgres` and `service_role` only), then `scripts/kpi7-round3-revoke-probe.mjs`
→ **18/18 `42501`** (anon 401, customer 403), ×2 identical; positive control
`post-push/revoke-probe-positive-control.json` (anon → `is_team_member` → 200).

## UI regression (editor and viewer) — gated walk, recorded as such

`scripts/kpi7-round3-ui-smoke.mjs`, deployed app, `kpi7r2-editor` and
`kpi7r2-viewer`, 15 pages each (`ui-regression/smoke.json`, screenshots). **The
walk could not exercise page content or write controls**, because the test
workspace's editor and viewer are on the free plan and the workspace has no
connected platform:

| Pages | What rendered | Why |
|---|---|---|
| `/dashboard`, `/personas`, `/social/planner`, `/social/analytics`, `/social/inbox` | onboarding screen "Complete these two steps" | `useOnboardingGuard`: no connected platform in the workspace |
| `/campaigns`, `/campaigns/:id` | "Pro Plan Required" | `PlanGate feature="campaigns"`; plan is per user (`subscriptions.user_id`) |
| `/analytics`, `/reports`, `/customer-journey`, `/aarrr-funnel` | "ฟีเจอร์นี้ต้องการ PRO Plan" (+ `406` on `subscriptions`: no subscription row) | plan gate |
| `/settings`, `/api-keys`, `/imports`, `/team` | redirect to `/dashboard` | route guards `manage_settings` / `manage_team`, as intended |

What the walk does confirm: the pages' data reads still fire behind the gates and
return. What it does not: any rendered list or button. The evidence that writes
still work for the roles that may write is the 428-case probe above, which
includes the editor's positive writes. No subscriptions were created and no real
workspace's membership was changed (founder decision).

One transient: the viewer's `/personas` load received HTTP 500 on `campaigns`
(the query embedding `campaign_tags`) and `campaign_ads`, headers not captured.
Replayed directly, the same reads gave **90/90 HTTP 200** for viewer, editor
and owner, including parallel bursts of six (`ui-regression/campaigns-reads-direct.txt`).

**Burst test with headers captured** (`scripts/kpi7-round3-burst.mjs`,
`ui-regression/burst-10x.json`): 10 parallel real-browser sessions per role, each
logging in and loading `/dashboard` then `/personas`. Viewer 196 and editor 713
REST responses, **0 HTTP 5xx**, so no error code arose to classify. Two further runs
are recorded as **invalid harness runs**, not results: run 2
(`burst-10x-run2.json`) left 19/20 logins uncompleted after 60 s (auth responses
not captured, cause not recorded); run 3 (`burst-10x-run3-shared-login.json`)
shared one login's storage state and produced ~0 data requests. After the
founder's 21:45 Disk IO warning, no further load test was run.

## ZAP findings — analysis (criterion 2)

Same nine alerts as round 2 (and round 1); the treatment is re-checked, not copied.

| Alert | Risk | Treatment | Re-checked today |
|---|---|---|---|
| CSP: Wildcard Directive [10055] | Medium | accepted: `img-src https:` for platform CDN images | policy unchanged (`matrix/commands-output.txt`) |
| CSP: style-src unsafe-inline [10055] | Medium | accepted, pre-declared in the spec (Radix, Recharts) | unchanged |
| Cross-Domain Misconfiguration [10098] | Medium | accepted: `ACAO: *` on public static files only; data comes from Supabase under RLS; inherited from Vercel | unchanged |
| Strict-Transport-Security Header Not Set [10035] | Low | **false positive**, header present | `curl` on `/` and `/assets/index-WAh02M2U.js` both return `strict-transport-security: max-age=31536000; includeSubDomains` |
| Cross-Origin-Embedder-Policy Missing [90004] | Low | accepted: no `SharedArrayBuffer`; `require-corp` would break cross-origin images | unchanged |
| Modern Web Application, Re-examine Cache-control, Retrieved from Cache, Storable but Non-Cacheable | Info | recorded, no action: public static assets | — |

**Where the two runs differ**, instance counts only (`zap/run-{1,2}.json`):

| Alert | run 1 | run 2 |
|---|---|---|
| Strict-Transport-Security Header Not Set [10035] | ×2 | ×5 |
| Modern Web Application [10109] | ×4 | ×5 |
| Cross-Origin-Embedder-Policy Missing [90004] | ×4 | ×5 |

The other six alerts have equal counts. Console summary of both runs:
`FAIL-NEW: 0 · WARN-NEW: 8 · PASS: 59` (exit code 2 = warnings only; ZAP's console
groups the two 10055 CSP alerts as one warning; the JSON lists nine). Run 1
21:48:33–21:54:48, run 2 21:54:48–22:00:13 ICT. Image
`ghcr.io/zaproxy/zaproxy@sha256:781a2bda…5081ef`, the same digest as rounds 1–2.
ZAP is unauthenticated, as in rounds 1–2: it cannot see any of the A01 changes,
which live behind login and in the database.

## npm audit — analysis (criterion 3)

| Severity | Package | Fix available | Treatment (rounds 1–2, unchanged) |
|---|---|---|---|
| High | `xlsx` | **no** | documented exposure: parses the merchant's own upload in their own browser; server-side Python re-validates; RLS bounds it to their workspace |
| High | `react-router`, `react-router-dom`, `@remix-run/router` | yes | upgrade candidate, a code change needing approval |
| High | `lodash` | yes | `_.template` not called; upgrade recommended |
| High | `ws` | yes | transitive (Supabase realtime) |
| High | `d3-color` | yes | transitive (Recharts) |
| Moderate | `dompurify`, `fflate` | yes | transitive |

No advisory added or removed since round 2. Not fixed, no dependency updated (scope guard).

## Files

```
README.md                         this file
PHASE1.md                         per-table analysis: policies, UI gates, writers, rules
FUNCTIONS.md                      sweep of all 66 executable public functions + replica tests
meta.json                         environment pin, commands, migration state
matrix/matrix.md                  A01–A10, all re-verified; A01 = mitigated
matrix/commands-output.txt        raw output of every matrix command
a01/probe-run-{1,2}.json          428 PostgREST cases each
a01/teardown-{0-clean,1,2}.json   teardown reports
a01/fixture-setup-*.json          fixture output (ids only; the first attempt's failure kept)
a01/campaigns-select-{before,after}-{1,2}.json   campaigns SELECT, viewer/editor
before/                           live pg_policies + function snapshots, generated rollbacks,
                                  replica round-trip tests, db push dry-run
round2-closeout/                  round 1's anon probe ×2 (round-2 close-out)
functions/                        code/DB callers, replica role calls, cron results, caller checks
post-push/                        migration list, smoke walks, 500 capture, EXPLAIN, function and
                                  revoke probes, live ACLs, observability/ screenshots
ui-regression/                    gated walk (smoke.json + screenshots), direct campaigns reads,
                                  burst tests (run 1 valid; runs 2–3 invalid harness runs)
smoke-prescan/smoke-run-1.json    the spec's mandatory pre-scan checklist, 10/11
zap/run-{1,2}.{json,html,md}      raw ZAP output, both runs; console, start/finish stamps
npm-audit/run-{1,2}.json          raw, both runs
```
