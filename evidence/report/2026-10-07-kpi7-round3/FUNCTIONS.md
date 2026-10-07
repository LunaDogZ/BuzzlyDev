# KPI-7 round 3: every `public` function that anon or authenticated can EXECUTE

Read live on 2026-10-07 before any change (`before/functions-snapshot.sql` →
`before/functions-live.json`: signature, DEFINER/INVOKER, ACL, full source).
Functions owned by an extension are excluded. **66 functions:**

- **27 cannot be called directly.** These are 26 trigger functions and 1 event
  trigger (`rls_auto_enable`), all PL/pgSQL. PL/pgSQL refuses a direct call
  ("trigger functions can only be called as triggers"). That is documented
  behaviour; I did not re-test it here. Their EXECUTE grant is irrelevant, and
  no change is made.
- **39 can be called** through `/rest/v1/rpc/<name>`. Both `has_role` overloads
  count separately; A + B + C below = 9 + 4 + 26 = 39.

Callers: `functions/code-callers.txt` (grep of `src`, `supabase/functions`,
`airflow/dags`, `mock-api/server.ts`, `scripts`) and `functions/db-references.csv`
(RLS policies, views and other function bodies that call it).
**pg_cron is not installed on the cloud project.** `pg_available_extensions`
shows `installed_version = NULL`, and `cron.job` does not exist. So the schedule in
`20260314003003_campaign_cron_job.sql` was skipped (that migration raises a
NOTICE and continues), and today no cron job calls anything.

Legend: **D** = SECURITY DEFINER (bypasses RLS) · **I** = INVOKER (caller's RLS)
· anon/auth = EXECUTE held today.

## A. Unsafe, with no legitimate anon/authenticated caller → REVOKED (`20261007190000`)

| Function | | anon/auth | Check | Cross-workspace effect | Legitimate caller |
|---|---|---|---|---|---|
| `process_scheduled_reports_with_preferences()` | D | ✅/✅ | none | **reads every workspace's due `scheduled_reports`; returns recipient email + user id (from `auth.users`) + report name; writes `next_run_at`/`last_run_at` on each** | none (cron not installed; no code caller) |
| `auto_stop_completed_campaigns()` | D | ✅/✅ | none | sets `campaigns.status='completed'`, pauses `ads`, writes `audit_logs` for every qualifying campaign in every workspace | none. The `campaign-auto-stop` Edge Function does not call it; it has its own logic, with service_role |
| `create_weekly_digest_notifications()` | D | ✅/✅ | none | inserts a `workspace_notifications` row for every member of every workspace | none |
| `debug_dashboard_visibility()` | D | ✅/✅ | mentions `auth.uid()` in a comment only | global counts of workspaces, ad accounts and insights; latest 3 insights with account name and **team id** | none. It was granted to anon on purpose in `20260218221500_debug_func.sql:83` as a debug aid |
| `get_team_role(uuid, uuid)` | D | ✅/✅ | none | any user's role in any workspace | none (0 policies, 0 functions, 0 code) |
| `get_employee_role(uuid)` | D | ✅/✅ | none | any user's staff role name | none |
| `get_notification_preferences(uuid)` | D | ✅/✅ | none | any user's 3 notification flags | only other DEFINER functions owned by postgres: `create_weekly_digest_notifications`, `fn_notify_budget_alert`, `process_scheduled_reports_with_preferences`. These keep working because the owner keeps EXECUTE (proven below) |
| `increment_discount_usage(uuid)` | D | ✅/✅ | none | `usage_count + 1` on any discount, so anyone can exhaust a coupon's `usage_limit` | none |
| `log_signup_trigger_error(text, uuid, text, text)` | D | ✅/✅ | none | inserts any text into `error_logs` (log forging, A09) | `handle_new_user` (DEFINER, owner postgres); unaffected |

## B. Unsafe, but a frontend path calls it → caller check added inside the function (`20261007193000`, founder decision)

| Function | | Check today | Hole | Frontend caller | Proposed check inside the function |
|---|---|---|---|---|---|
| `evaluate_inactivity_tier_downgrades()` | D | `IF auth.uid() IS NOT NULL AND NOT EXISTS (employees …) THEN RAISE` | **anon passes** (uid is NULL), so anyone can run the global tier-downgrade pass. An authenticated employee row with any status also passes | `src/hooks/useTierManagement.tsx:651` (support pages) | `IF auth.uid() IS NULL OR NOT public.is_employee(auth.uid()) THEN RAISE` (`is_employee` requires active + approved) |
| `sync_tier_from_lifetime_points()` | D | same `auth.uid() IS NOT NULL AND NOT is_employee` pattern | **anon passes**, so anyone can run the global tier recompute plus the history backfill | `useTierManagement.tsx:670` | same as above |
| `get_available_discounts(uuid)` | D | none | for **any** `p_customer_id`, shows which published discounts that user has *not* collected, so another customer's coupon collection can be inferred. The catalogue itself is global by design | `useCustomerCoupons.tsx:92` passes `user.id` (:93) | return nothing unless `p_customer_id = auth.uid()` |
| `update_tier_retention_period(uuid, integer)` | D | `EXISTS (SELECT 1 FROM employees WHERE user_id = auth.uid())`, without status or approval | anon is refused. A **suspended or unapproved employee** can still change loyalty tier retention. That is staff authorization, not workspace isolation | `useTierManagement.tsx:631` | use `public.is_employee(auth.uid())` |

All four need `CREATE OR REPLACE FUNCTION`. A REVOKE would break the support pages.
Note: for the first two, revoking from **anon only** would also close the hole
without touching the function body, because the frontend calls as authenticated.

## C. Safe: no change

| Function | | Why safe | Caller |
|---|---|---|---|
| `is_team_member`, `can_manage_team`, `has_permission`, `has_role(uuid,text)`, `has_role(uuid,app_role)`, `is_employee`, `has_employee_role` | D | answer only for `_user_id = auth.uid()` (they return false otherwise) | **used by RLS policies**: is_team_member 47 · can_manage_team 18 · has_permission 6 · has_role (both overloads) 109 · is_employee 15 · has_employee_role 16. Revoking them would break RLS for every user. Also `meta-sync/index.ts:199`, `meta-oauth/index.ts:109` |
| `get_platform_connection_status(uuid)` | D | filters on `is_team_member(auth.uid(), _team_id)` | (referenced by name only in `types.ts`) |
| `ensure_loyalty_wallet`, `get_my_loyalty_tier`, `get_my_team_ids` | D | only the caller's own rows (`auth.uid()`); `get_my_team_ids` reads `team_members`, which no longer exists, so it errors | `SignUp.tsx:180`, `useLoyaltyTier.tsx:138`, none |
| `apply_collected_discount`, `validate_collected_discount`, `redeem_reward`, `award_loyalty_points` | D | NULL uid refused; act on the caller's own coupon / wallet only | `useSubscription.tsx:277`, `PaymentMethodDialog.tsx:113`, `useCustomerRewards.tsx:82`, 5 sites |
| `admin_override_tier`, `manual_override_customer_tier`, `get_tier_history_for_support`, `search_customers_for_support`, `send_promo_to_customer` | D | NULL uid refused and `is_employee` (active + approved) required | `useTierManagement.tsx:569, :127, :433`; none; none |
| `create_ad_with_mirror_post`, `promote_batch`, `discard_staging_batch`, `get_customer_journey_funnel_totals`, `get_customer_journey_monthly_data`, `try_cast_uuid` | I | run under the caller's RLS, so they cannot exceed what the caller could do directly (`create_ad_with_mirror_post` already has no anon grant) | `useAds.tsx:223`; Airflow with service_role; `useFunnelData.tsx:72`; `useCustomerJourneyMonthlyData.tsx:43`; storage policies |

Observation, not A01: `award_loyalty_points(p_action_type)` lets any signed-in
customer claim any active mission's points once, without checking that the
action happened. That is a business-logic integrity issue on the caller's own
wallet. Recorded only.

## Was the report-recipient leak exploitable before today? (grant history only, not probed)

- `process_scheduled_reports_with_preferences()` is created only in
  `20260320000010_notification_preferences_integration.sql` (first committed
  `58ca813`, 2026-03-18 02:48 +0700). That file has no `GRANT` or `REVOKE` for it,
  and no later migration grants or revokes it.
- The live default privileges (`pg_default_acl`) for functions that `postgres`
  creates in `public` are `{postgres, anon, authenticated, service_role}=X`, and the
  live ACL is `=X/postgres … anon=X/postgres authenticated=X/postgres …` (PUBLIC
  too).
- **So from the moment `20260320000010` was applied until this migration, anyone
  holding the public anon key could call it.** The migration ledger stores
  versions, not apply times, so the exact start date cannot be read from the
  database; the earliest possible date is the 2026-03-18 commit.
- Whether it was ever *called* cannot be told from grants. pg_cron was never
  installed, so not even a legitimate run happened. I did not check whether any
  `scheduled_reports` rows exist, or what values `last_run_at` holds (not asked;
  grant history only).
- The same applies to every function in table A: `debug_dashboard_visibility`
  since `20260218221500` (explicit `GRANT … TO anon`), and `get_team_role` /
  `get_employee_role` since `20260218000000_consolidated_schema.sql` (explicit
  `GRANT ALL … TO anon`).

## Replica test (`public.ecr.aws/supabase/postgres:17.6.1.084`, the cloud's image)

Dump of 2026-10-07 18:48, loaded public then storage (2 known `auth.jwt()` errors).
Both migrations applied with `-1 -v ON_ERROR_STOP=1` → exit 0.

| Check | Result |
|---|---|
| pg_cron enabled locally; the 9 revoked functions scheduled every 2 s as `postgres` | **12 succeeded / 0 failed each** (`functions/replica-cron-results.txt`) |
| each function called as `anon` and as `authenticated` (`SET ROLE`) | **18 / 18 → `ERROR 42501 permission denied for function …`**; the connection still answers `select 1` after each; **0** "terminated by signal" lines in the server log (`functions/replica-role-calls.txt`) |
| positive control: `anon` calls `is_team_member(NULL, NULL)` (not revoked) | returns `f`, so `anon` can still call what was not revoked |
| DEFINER chain: a postgres-owned DEFINER wrapper calling `get_notification_preferences` and `log_signup_trigger_error`, executed as `anon` | `chain ok email_reports=true`, the same mechanism `handle_new_user` and `fn_notify_budget_alert` use (rolled back) |
| `before/rollback-functions.sql` applied after the migration | ACLs of all 9 **match the live ACLs** exactly |

The crash caveat from round 2 §4 still applies: on `.106` an anon
permission-denied segfaults the backend. The cloud is on `.084`.

## Replica test of `20261007193000` (same image, all three migrations applied)

Test identities seeded on the replica only: an active+approved support employee,
a suspended employee, an active but unapproved employee, two customers, one
loyalty tier and one published discount. Each call ran in its own rolled-back
transaction with `request.jwt.claim(s)` set and `SET LOCAL ROLE`.

| Function | active employee (support-page path) | suspended | unapproved | customer | anon |
|---|---|---|---|---|---|
| `evaluate_inactivity_tier_downgrades()` | ✅ `{"downgraded_count": 0}` | ❌ employees_only | ❌ | ❌ | ❌ |
| `sync_tier_from_lifetime_points()` | ✅ `{"updated_count": 0, "backfilled_count": 0}` | ❌ employees only | ❌ | ❌ | ❌ |
| `update_tier_retention_period(tier, 60)` | ✅ `{"success": true}` | ❌ employees_only | ❌ | ❌ | ❌ |

`get_available_discounts`: customer A asking for A → **1 row**; A asking for B → **0**;
anon asking for B → **0** (`functions/replica-caller-checks-after.txt`).

**Control:** `before/rollback-function-bodies.sql` (the live definitions)
re-applied on the same replica. The same matrix then shows every hole that was
there: anon ran `evaluate…` and `sync…`, a suspended employee ran `evaluate…` and
`update_tier_retention_period`, and A asking for B got **1 row**
(`functions/replica-caller-checks-before.txt`). After that rollback all four
definitions and ACLs are **byte-identical to live**. The migration is generated by
`before/build_function_fixes.py` from the live text: one exact-string guard
substitution per function, each required to match exactly once.

Live employees on 2026-10-07: 5 rows, **all active + approved** (dev 3, owner 1,
support 1), so no current staff member loses access.
