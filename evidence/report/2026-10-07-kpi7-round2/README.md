# KPI-7 (OWASP Top 10:2021) — round 2

| | |
|---|---|
| **Date measured** | 2026-10-07 (ICT) |
| **Commit** | `f7f60f0` (`f7f60f028aa00d8f12e989773cc777416807e599`) |
| **Deployed bundle** | `https://buzzly-dev.vercel.app/assets/index-WAh02M2U.js` — the identical content-hashed file a local `npm run build` of `f7f60f0` produces |
| **Migration** | **`20261007101000_ad_tables_writes_service_or_manager_only`** — applied (founder, `supabase db push --linked`). Also in force: `20261007065910_is_team_member_requires_active_status`. Written, **not applied at measurement time**: `20261007120000_drop_seed_demo_insights` |
| **Spec** | `docs/KPI_SPEC.md` § KPI-7, pre-registered `da02849` — thresholds and criteria **not changed** |
| **Round 1** | `evidence/kpi7-security/{da02849,29a88bb,f354ac4,fc86210,eae9135}…/` — **not edited, moved, or re-run into** |

**No overall KPI-7 verdict is assigned here.** The four pre-registered criteria
are reported with their raw results; the verdict is the founder's.

## The four criteria — raw results

| # | Criterion (verbatim from the spec) | Raw result, round 2 |
|---|---|---|
| 1 | Applicability matrix answers **10/10** categories. An `N/A` is only valid with a written reason. | **10/10 answered, 0 `N/A`.** All ten rows re-verified today (`matrix/matrix.md`, raw output `matrix/commands-output.txt`). **A01 rated "partially mitigated"** — two tables fixed and proven, 21 tables + one indirect path still open (below). One round-1 A01 instrument **not re-run** (anon probe — needs the service key; decision pending) |
| 2 | ZAP baseline: **0 High and 0 Critical** alerts. Medium / Low / Informational are recorded, analysed, and each given either a remediation plan or a written justification for acceptance. | **0 High, 0 Critical in both runs.** 3 Medium · 2 Low · 4 Informational — the same nine alerts (plugin id and risk) as both round-1 runs. Analysis below |
| 3 | `npm audit --omit=dev`: **0 Critical** vulnerabilities in production dependencies. High/Moderate recorded with the same treatment as (2). | **0 Critical.** 7 High · 2 Moderate over 188 production packages — the same nine packages as round 1 |
| 4 | Both scans run **twice on the same commit**; the two results must agree. A disagreement is itself reported and investigated before any verdict is written. | ZAP: the **alert set is identical** across runs — same 9 alerts, same plugin ids, same risk levels, same 3/2/4 split, 0 High/Critical in both. **Instance counts differ** on 4 alerts (table below) — the same kind of difference round 1 recorded and explained (the AJAX spider reaches a slightly different URL set each crawl). npm audit: run 1 and run 2 **identical** (`vulnerabilities` and `metadata` objects equal) |

Pre-scan smoke (mandatory per spec): `node scripts/kpi7-smoke.mjs` → **10/11**,
**0 CSP violations**. The one failure is `2c realtime wss connects` — the same
open item round 1 recorded (2 of 5 runs then), not CSP (`smoke-prescan/smoke-run-1.json`).

## Changes since round 1

**What round 1 measured, and what it did not.** Round 1 (2026-09-08/09) verified
A01 as *cross-tenant* isolation — `anon` and other-tenant reads. It never tested
*roles inside a workspace*. Three defects of that kind were found afterwards:

1. **Suspended / removed members kept full access** — `is_team_member()`
   ignored `workspace_members.status`. Fixed by `20261007065910` (commit
   `51e3fc8`). Not changed this round; **re-verified**: a suspended and a
   removed member (both holding role `admin`) read **0** rows of both tables and
   every write is refused.
2. **A viewer could write `ad_insights` and `ad_accounts` through PostgREST.**
   Eight membership-only INSERT/UPDATE policies; "viewer can only view" lived in
   the frontend alone. Fixed by **`20261007101000`**:
   - `ad_insights` — all three member-level write policies **dropped, no
     replacement**. No client path writes this table (grep of `src/` and the
     Edge Functions: none; `meta-sync` writes through `serviceClient()`).
   - `ad_accounts` — five dropped; replaced by INSERT and UPDATE (with
     `WITH CHECK`) on `can_manage_team()`, the predicate `meta-oauth` already
     checks before connecting a platform.
   - Staff, DELETE and SELECT policies unchanged.
3. **`seed_demo_insights(uuid)` was callable by `anon`.** SECURITY DEFINER, no
   caller check: anyone holding the public anon key could insert 30 rows of
   random spend into any ad account with < 5 insight rows. The rows would carry
   `data_source='api'` (the column default) — indistinguishable from real API
   data. **0 such rows exist** in any workspace (checked read-only before the fix;
   0 rows with `data_source='api'`, 0 with both `campaign_id` and `ads_id` NULL),
   so there is no sign it was ever called. EXECUTE revoked from PUBLIC, anon,
   authenticated in `20261007101000`; the function is dropped by
   `20261007120000` (pending).

**Verification of the fix** — `a01/`, real JWTs over PostgREST, no service key
in the probe, **47/47 cases as hand-declared, two runs identical**:

| | owner | admin | editor | viewer | suspended | removed | outsider |
|---|---|---|---|---|---|---|---|
| SELECT both tables, test ws | 1/1 | 1/1 | 1/1 | **1/1** | **0/0** | **0/0** | **0/0** |
| INSERT `ad_accounts` | ✅ 201 | ✅ 201 | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 |
| UPDATE `ad_accounts` | ✅ 1 row | ✅ 1 row | ❌ 0 rows | ❌ 0 rows | ❌ 0 rows | ❌ 0 rows | ❌ 0 rows |
| INSERT `ad_insights` | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 |
| UPDATE `ad_insights` | ❌ 0 rows | ❌ 0 rows | ❌ 0 rows | ❌ 0 rows | ❌ 0 rows | ❌ 0 rows | ❌ 0 rows |

`seed_demo_insights` RPC: **anon 401 `42501`, viewer 403 `42501`, owner 403
`42501`**; no rows written. Every status, body and `Content-Range` is in
`a01/probe-run-{1,2}.json`. A refused UPDATE returns **204 with
`Content-Range: */0`**, not 403 — RLS filters the row rather than raising; the
owner/admin rows are the positive control that the owner read-back detects a
write that does land. Teardown found 0 leftover rows after both runs.

**Other changes since round 1**

- Source: 19 files under `src/` changed (dashboard work); `vercel.json`,
  `package.json`, `package-lock.json` **unchanged** (`git diff --stat 29a88bb f7f60f0`).
- Migrations: 243 → 246 (the three above). `CREATE POLICY` count 558 → 560.
- npm advisory feed (same lockfile): `dompurify` advisory 1124022 re-issued as
  1240978 (same title), one new Low (1241204). Package severities unchanged.
- ZAP image: same digest as round 1.

## Remaining A01 findings (not fixed this round)

A viewer — any **active** member — can do the following through PostgREST with
their own JWT. Each table has at least one membership-only write policy
(`is_team_member`, or an `EXISTS/IN … workspace_members` subquery with no role
check); permissive policies OR together, so a stricter sibling policy does not
help. Full live expressions: `a01/remaining-write-policies.csv`. **Static
evidence from `pg_policies`; not exercised.**

| # | Table | What a viewer could do |
|---|---|---|
| 1 | **`workspace_api_keys`** | Insert, overwrite or delete the workspace's platform connections and their access tokens — disconnect a live integration or point it at a different key |
| 2 | **`import_jobs`** | Insert an import job (`uploaded_by` = self). With `imports` bucket upload also membership-only (`imports_insert_policy`), the `AFTER INSERT` trigger `trg_import_jobs_trigger_airflow` starts the pipeline, which writes **viewer-chosen values** into `ad_insights`, `ad_accounts`, `campaigns`, `ads`, `ad_groups` with service_role. **This is an indirect route around the `ad_insights` fix**, bounded to the viewer's own workspace. Not exercised: it would run a real import on the cloud |
| 3 | `ads` | Create, edit, delete ads |
| 4 | `ad_groups` | Create, edit, delete ad groups |
| 5 | `campaigns` | Create and edit campaigns, and delete them (`team_campaigns_delete` is membership-only — beside a role-aware `has_permission` policy that is thereby overridden) |
| 6 | `campaign_ads` | Link and unlink ads to campaigns (ALL) |
| 7 | `campaign_tags` | Add and remove campaign tags (ALL) |
| 8 | `budgets` | Create, edit, delete budgets |
| 9 | `customer_personas` | Create and edit personas (`personas_*_policy` membership-only, beside role-aware `has_permission` policies) |
| 10 | `ad_personas` | Link and unlink personas to ads (ALL) |
| 11 | `post_personas` | Link and unlink personas to social posts (ALL) |
| 12 | `workspace_ad_persona` | Create and edit the workspace's ad-persona settings |
| 13 | `social_posts` | Create and edit social posts |
| 14 | `social_comments` | Create, edit, delete social comments |
| 15 | `reports` | Create and edit reports |
| 16 | `scheduled_reports` | Create, edit, delete scheduled reports |
| 17 | `email_campaigns` | Create, edit, delete email campaigns |
| 18 | `tags` | Create, edit, delete tags |
| 19 | `sync_history` | Insert, edit, delete sync history — falsify or erase the record of syncs |
| 20 | `conversion_events` | Insert conversion events against the workspace's ad accounts |
| 21 | `team_activity_logs` | Insert arbitrary activity-log entries (forge the audit trail; the table currently has 0 rows) |

A role-aware helper already exists in the database — `has_permission(uid, team,
permission)`, which mirrors the frontend's `defaultRolePermissions` and honours
`custom_permissions` — so the remaining fixes are policy swaps, not new
machinery. Not done: out of scope for this round.

## Known limitations and known issues

1. **`meta-sync` (accepted, founder decision B).** The Edge Function authorises
   with `is_team_member`, then writes with service_role. A viewer can therefore
   trigger a re-fetch from Meta that writes `ad_insights`. The viewer cannot
   choose the values — they come from Meta. Not changed.
2. **Silent connect/disconnect failure for a viewer with `manage_settings`
   (known issue, founder decision C).** `custom_permissions` is honoured in the
   UI, not in the database. A viewer granted `{"manage_settings": true}` — the
   live account `sus-study@buzzly.test` is one — can open `/api-keys`, but:
   - connect: `usePlatformConnections.tsx:385` upserts `ad_accounts` without
     checking the error. The `workspace_api_keys` row is saved, the
     `ad_accounts` row is refused → a half-made connection, no message.
   - disconnect: `usePlatformConnections.tsx:557` updates 0 rows silently
     (verified: 0 rows as that viewer, 3 as owner, rolled back) → the account
     stays `is_active=true` while the UI says disconnected.
   Frontend and account not changed.
3. **Full Meta disconnect/reconnect was not smoke-tested.** Disconnect calls
   `DELETE /{user}/permissions` at Meta, which ends the Facebook user's whole
   grant — both live tokens (E2E Walk Workspace, Testing) share
   `act_1025260845170202` — and reconnecting needs the founder's Facebook login.
   Tested instead: `meta-oauth/start` as owner → 200 with a Meta consent URL;
   the disconnect's `ad_accounts` write at the database layer (above).
4. **REVOKE + anon on a future image.** On `supabase/postgres:17.6.1.106` an
   anon "permission denied for function" segfaults the backend. Re-tested today
   locally: **.084 (the cloud's image) raises `42501` cleanly; .106 dies with
   signal 11.** `20261007101000` is safe on .084. Dropping the function
   (`20261007120000`) removes this exposure for `seed_demo_insights`; four other
   functions already deny anon (`pipeline_setting`, `set_pipeline_setting`,
   `pipeline_webhook_health`, `create_ad_with_mirror_post`).
5. **Round 1's anon probe was not re-run** (needs the service key). A01-1 and
   A01-2 are cited as closed from round 1, not re-probed.
6. **ZAP is unauthenticated**, as in round 1: it cannot see any of the A01
   changes, which live behind login and in the database.

## ZAP findings — analysis (criterion 2)

Same nine alerts as round 1; the round-1 treatment is re-checked, not copied.

| Alert | Risk | Treatment | Re-checked today |
|---|---|---|---|
| CSP: Wildcard Directive [10055] | Medium | accepted — `img-src https:` for platform CDN images | policy unchanged (`curl`, `matrix/commands-output.txt`) |
| CSP: style-src unsafe-inline [10055] | Medium | accepted — pre-declared in the spec (Radix, Recharts) | unchanged |
| Cross-Domain Misconfiguration [10098] | Medium | accepted — `ACAO: *` on public static files only; data comes from Supabase under RLS; inherited from Vercel | unchanged |
| Strict-Transport-Security Header Not Set [10035] | Low | **false positive** — header present | `curl` on `/` and `/assets/index-WAh02M2U.js` both return `strict-transport-security: max-age=31536000; includeSubDomains` |
| Cross-Origin-Embedder-Policy Missing [90004] | Low | accepted — no `SharedArrayBuffer`; `require-corp` would break cross-origin images | unchanged |
| Modern Web Application, Re-examine Cache-control, Retrieved from Cache, Storable but Non-Cacheable | Info | recorded, no action — public static assets | — |

**Where the two runs differ** — instance counts only (`zap/run-{1,2}.json`):

| Alert | run 1 | run 2 |
|---|---|---|
| Re-examine Cache-control Directives [10015] | ×4 | ×5 |
| Strict-Transport-Security Header Not Set [10035] | ×3 | ×5 |
| Modern Web Application [10109] | ×4 | ×5 |
| Cross-Origin-Embedder-Policy Missing [90004] | ×4 | ×5 |

The other five alerts have equal counts. Console summary of both runs:
`FAIL-NEW: 0 · WARN-NEW: 8 · PASS: 59` (ZAP's console groups the two 10055
CSP alerts as one warning; the JSON lists nine). Run 1 17:25:00–17:27:22, run 2
17:27:22–17:29:40 ICT.

## npm audit — analysis (criterion 3)

| Severity | Package | Fix available | Treatment (round 1, unchanged) |
|---|---|---|---|
| High | `xlsx` | **no** | documented exposure: parses the merchant's own upload in their own browser; server-side Python re-validates; RLS bounds it to their workspace |
| High | `react-router`, `react-router-dom`, `@remix-run/router` | yes | upgrade candidate — a code change needing approval |
| High | `lodash` | yes | `_.template` not called; upgrade recommended |
| High | `ws` | yes | transitive (Supabase realtime) |
| High | `d3-color` | yes | transitive (Recharts) |
| Moderate | `dompurify`, `fflate` | yes | transitive; `dompurify` gained one new Low advisory (1241204) since round 1 |

Not fixed, no dependency updated (scope guard).

## Before-state snapshot (rollback)

`before/` holds the pre-push state of every changed object and a tested
`rollback.sql`. **It was reconstructed after the push**, because no snapshot was
taken before it. Sources:

1. `supabase db dump --linked` (schema `public`) taken 2026-10-07 13:43:32 +0700
   for the thesis appendix — before both `20261007065910` and `20261007101000`
   were pushed (its `is_team_member` has no status check).
   sha256 `1105e5ff…cbe6c4`. The file lives in a scratchpad, not in git; the
   extracted statements are copied verbatim into `before/*.sql`.
2. Git history of the creating migrations, to attribute each policy:
   `20260218000001_consolidated_rls.sql` (`team_member_*`, "Team members can
   insert/update ad_accounts"), `20260218221000_fix_ad_insights_rls.sql` (the two
   `public`-role insert policies), rewritten by
   `20260811100100_rls_policies_wrap_auth_uid.sql`;
   `20260219140000_seed_demo_insights_fn.sql` (the function).
3. Cross-check: the 21 policies in the dump match, by name and command, the 21
   read from live `pg_policies` on 2026-10-07 before the push (Phase 1 report).

`rollback.sql` was **tested on a local replica** (`supabase/postgres:17.6.1.084`
loaded from that dump) from both possible states — see `before/rollback-test.md`.
It is not a migration and was not run against the cloud.

## Files

```
README.md                      this file
meta.json                      environment pin, commands, migration state
matrix/matrix.md               A01–A10, all re-verified; A01 = partially mitigated
matrix/commands-output.txt     raw output of every matrix command
a01/probe-run-{1,2}.json       47 PostgREST cases each, status + body + Content-Range
a01/teardown-{1,2}.json        leftovers removed after each run (0 / 0)
a01/remaining-write-policies.csv  live write policies on the 21 open tables
zap/run-{1,2}.{json,html,md}   raw ZAP output, both runs; *.console.txt, start/finish stamps
npm-audit/run-{1,2}.json       raw, both runs
smoke-prescan/smoke-run-1.json the spec's mandatory pre-scan checklist, 10/11
smoke/                         post-push app smoke as owner (dashboard, /imports, /api-keys,
                               meta-oauth/start, disconnect write rolled back)
before/                        reconstructed pre-push state + tested rollback.sql
```
