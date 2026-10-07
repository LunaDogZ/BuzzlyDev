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

## Phase 2 — to be filled in after the push

- [ ] `campaigns` SELECT for viewer and editor after the push: must equal the table above
- [ ] PostgREST probe, 7 accounts × every affected table, ×2, identical
- [ ] Function grants re-read live; anon `rpc/` call → 42501
- [ ] UI regression as editor and as viewer on every page that reads or writes
      these tables
- [ ] Matrix A01–A10, ZAP baseline ×2, `npm audit --omit=dev` ×2; criterion 4 per
      round 1's comparison definition (quoted)
- [ ] "Changes since round 2"
