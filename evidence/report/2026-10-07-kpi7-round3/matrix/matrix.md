# KPI-7 round 3 — OWASP Top 10:2021 applicability matrix, all ten rows re-verified

| | |
|---|---|
| **Commit under assessment** | `f0e05d9` (`f0e05d9ccde87ea99eaffd9d8e978e1cf5af3d01`); since then only evidence files and probe scripts under `scripts/kpi7-round3-*` changed, no application source |
| **Deployed bundle** | `/assets/index-WAh02M2U.js`, the same file round 2 measured; `src/` differs from `f7f60f0` only in the regenerated `types.ts`, which does not reach runtime code |
| **Database state** | `20261007183000`, `20261007190000`, `20261007193000` applied (founder push), plus round 2's `20261007065910`, `20261007101000`, `20261007120000` |
| **Spec** | `docs/KPI_SPEC.md` § KPI-7, pre-registered `da02849`, **not edited** |
| **Date** | 2026-10-07 ICT |
| **Raw command output** | `commands-output.txt` (this directory); every number below is from it or from the cited evidence file |

Previous rounds: `evidence/kpi7-security/…` (round 1) and
`evidence/report/2026-10-07-kpi7-round2/matrix/` (round 2). Neither is edited by this round.

## Summary

| Row | Applies | Status at `f0e05d9` | Moved since round 2? | Whose |
|---|---|---|---|---|
| A01 Broken Access Control | yes | ✅ **mitigated**: no open A01 finding; accepted residuals listed in the row | **yes**: A01-6 closed, A01-7/8 found and closed | ours (policies, functions) + inherited (RLS engine) |
| A02 Cryptographic Failures | yes | ✅ re-verified | no | ours + inherited (TLS) |
| A03 Injection | yes, narrowly | ✅ re-verified | no | ours + inherited |
| A04 Insecure Design | yes | ✅ re-verified; **A04-1 recorded** (residual) | new residual recorded | ours |
| A05 Security Misconfiguration | yes | ✅ re-verified | no | ours |
| A06 Vulnerable Components | yes | ✅ re-verified, 0 Critical | no (same packages, same advisories) | ours |
| A07 Identification & Auth | yes | ✅ re-verified | no | mostly inherited |
| A08 Software & Data Integrity | yes | ✅ re-verified | corpus 246 → 249 migrations; modified-after-commit still 27 | ours |
| A09 Logging & Monitoring | yes | ✅ re-verified; A09-1 still open; **A09-3 recorded** (residual) | new residual recorded | ours |
| A10 SSRF | yes | ✅ re-verified, no surface found | no | ours |

**10/10 rows answered. No `N/A` claimed.**

---

## A01 — Broken Access Control — ✅ mitigated

### Findings since round 2

| ID | Defect | Status |
|---|---|---|
| A01-1 … A01-5 | (rounds 1–2) | ✅ closed. A01-1/2 re-probed for the round-2 close-out: round 1's anon probe, unchanged, ×2, the same 11 catalogue tables anon-readable as in round 1 (`../round2-closeout/`) |
| **A01-6** | Viewer (any active member) could write 21 tables through PostgREST, plus an indirect route into `ad_insights` via `import_jobs` + the `imports` bucket | ✅ **closed**: `20261007183000`, 47 membership-only write policies replaced by `has_permission()` rules that mirror the frontend role table |
| **A01-7** | Nine SECURITY DEFINER functions executable by `anon`/`authenticated` with no caller check, incl. a cross-tenant leak of report recipients' emails and user ids (`process_scheduled_reports_with_preferences`), cross-tenant campaign auto-stop, a global debug read (`debug_dashboard_visibility`) | ✅ **closed**: `20261007190000`, EXECUTE revoked from PUBLIC, anon, authenticated |
| **A01-8** | Four DEFINER functions with a frontend caller whose check let the wrong caller through: anon ran the global tier jobs; inactive/unapproved employees passed; any customer could read another's coupon state | ✅ **closed**: `20261007193000`, caller check inside each body |

### Control (b)

- Writes: `has_permission((SELECT auth.uid()), <team>, '<key>')` per table, keys
  `manage_settings` / `edit_campaigns` / `delete_campaigns` / `edit_prospects` /
  `export_data` (`../PHASE1.md`); `sync_history`, `conversion_events`: no member
  write at all; `team_activity_logs`: own rows only. SELECT and staff policies unchanged.
- Functions: full sweep of all 66 `public` functions executable by anon/authenticated (`../FUNCTIONS.md`).

### Verification (c) — behavioural, real JWTs over PostgREST, no service key in any probe

| Instrument | Result |
|---|---|
| `scripts/kpi7-round3-probe.mjs`: 7 accounts × every round-3 table (INSERT / UPDATE / DELETE as defined), `imports` uploads, forged `uploaded_by` / forged activity-log actor, `campaign_tags` SELECT, test-ws owner against the outsider workspace | **428/428 as declared, two runs identical** (incl. attempt counts); 0 timeout retries (`../a01/probe-run-{1,2}.json`); teardown found exactly the rows the declared rules leave, both runs identical (`../a01/teardown-{1,2}.json`) |
| `scripts/kpi7-round3-revoke-probe.mjs`: nine revoked functions as anon and as a customer | **18/18 `42501`** (anon 401, customer 403), ×2 identical; positive control anon → `is_team_member` = 200 (`../post-push/`) |
| `scripts/kpi7-round3-function-probe.mjs`: four functions given caller checks, anon + non-employee customer | **9/9 as declared**, ×2 identical. The discount rows cannot fail on production (0 discounts exist); the discriminating test is on the replica (`../FUNCTIONS.md`) |
| `scripts/kpi7-round3-campaigns-select.mjs` | viewer 2 / editor 2 campaigns, same ids, **before and after the push** |

Positive path for active employees: **tested on the local copy only, not on production** (no employee login; none created).

### Static counts (`commands-output.txt`)

| Control | round 2 (`f7f60f0`) | today |
|---|---|---|
| migrations in corpus | 246 | **249** |
| `ENABLE ROW LEVEL SECURITY` statements | 138 | 138 |
| `CREATE POLICY` statements | 560 | **609** (49 created by `20261007183000`) |
| `security_invoker` | 4 | 4 |
| `TeamPermissionsGuard` use sites | 17 | 17 |
| `CustomerProtectedRoute` in `App.tsx` | 3 | 3 |
| employee role gates `App.tsx:217,228,239` | 3 | 3 |

### Accepted residuals (not open findings)

1. **`meta-sync` (round 2, founder decision B):** any member can trigger a re-fetch from Meta; the values come from Meta, not the caller.
2. **Known issue C (round 2):** `custom_permissions` grants. A viewer with `{"manage_settings": true}` can now write `workspace_api_keys` (the database honours custom permissions through `has_permission`, as the UI does), but `ad_accounts` writes still require `can_manage_team`. The half-made connection round 2 described is still possible. The database refuses the part the role may not do.
3. **11 anon-readable catalogue tables** (round 1, reviewed and accepted; unchanged).
4. **Write buttons still shown to roles that may not write** (UX only; the database refuses).

### Rating, from the facts only

Every A01 finding known at the start of round 3 (A01-6), and every one found
during it (A01-7, A01-8), is closed, and each closure is proven behaviourally
with real sessions or, for the employee positive path and the discount
discrimination, on a local replica of the cloud's image. What remains is the
four accepted residuals above, none of which lets a role write or read beyond
what the role table grants. **A01: mitigated.**

---

## A02 — Cryptographic Failures

| Control | Today | Round 2 |
|---|---|---|
| `service_role` in `dist/assets/` | **0 files** | 0 |
| JWTs in bundle | **1, `{"role":"anon","ref":"aokzvknggtccgwbavszj"}`** | same |
| `META_ACCESS_TOKEN` in bundle | **0** | 0 |
| `META_ACCESS_TOKEN` in source | `mock-api/meta/client.ts` + 4 `scripts/*.mjs`, **0 in `src/`** (plus the gitignored `mock-api/.env`, `.env.bak`) | same |
| tracked `.env` files | only 4 `*.example` | same |

## A03 — Injection

Hand-built SQL literals in `src/` **0** · `.rpc(` sites **21** · Zod import sites **3**. A03-1 stands. Unchanged.

## A04 — Insecure Design

`data_source` references (filtered form) **16**, unfiltered **22** (round 2: 16 / 22) · `.delete(` in `mock-api/meta/*.ts` **0**.
**A04-1 (new, residual, founder decision):** `award_loyalty_points(p_action_type)`
awards any active mission's points once per caller without checking that the
action happened. It affects only the caller's own wallet and tier. Not fixed.

## A05 — Security Misconfiguration

All seven headers present live on `/` and on the hashed asset (`commands-output.txt`):
CSP (`connect-src` = `'self'` + the two Supabase origins), HSTS
`max-age=31536000; includeSubDomains`, `nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `COOP:
same-origin`. `vercel.json` unchanged since `f7f60f0` (`git diff --stat` empty).
Pre-scan smoke: 0 CSP violations (`../smoke-prescan/`). ZAP: README criterion 2.

## A06 — Vulnerable and Outdated Components

`npm audit --omit=dev`, two runs, identical: **0 Critical · 7 High · 2 Moderate**
over 188 production packages: the same nine packages, severities and advisory ids
as round 2, same lockfile (`a2679b7f…`). README criterion 3.

## A07 — Identification and Authentication Failures

`persistSession` / `autoRefreshToken` `true` / `true` (`client.ts:28-29`) ·
employee role gates unchanged · `onAuthStateChange` files: the same 11-file list
as round 2 (9 non-test). Unchanged.

## A08 — Software and Data Integrity Failures

Lockfile tracked, `a2679b7f…` · migrations modified after first commit **27**,
most recent `3844db9` 2026-03-24, unchanged · the three round-3 migrations were
**added**, none edited.

## A09 — Security Logging and Monitoring Failures

`logError(` sites **32** · `ipify` comment and privacy test only (A09-2 stays closed).
**A09-1 still open, accepted:** no alerting on `error_logs` / `audit_logs_enhanced`.
**A09-3 (new, residual, founder decision):** `team_activity_logs` now accepts
only rows whose actor is the caller, but any active member can still insert an
entry in their own name with any `action` text. Other people's names can no
longer be forged.
Closed in round 3 (as part of A01-7): `log_signup_trigger_error` let anyone with
the anon key write arbitrary `error_logs` rows.

## A10 — Server-Side Request Forgery

Literal Graph hosts at `mock-api/meta/client.ts:109`, `_shared/metaClient.ts:62`,
`_shared/meta.ts:70`; `connect-src` limited to our two Supabase origins.
**No SSRF surface found.** Unchanged.

---

## Findings register

| ID | Cat | Status at `f0e05d9` |
|---|---|---|
| A01-1, A01-2 | A01 | ✅ closed (round 1), re-probed (round-2 close-out) |
| A01-3, A01-4, A01-5 | A01 | ✅ closed (round 2), still closed |
| **A01-6** viewer writes on 21 tables + import path | A01 | ✅ **closed** `20261007183000`, verified 428/428 ×2 |
| **A01-7** anon/authenticated-callable DEFINER functions (9) | A01 | ✅ **closed** `20261007190000`, verified 18/18 ×2 |
| **A01-8** wrong-caller checks in four DEFINER functions | A01 | ✅ **closed** `20261007193000`, verified 9/9 ×2 (prod) + replica |
| A04-1 mission points without the mission | A04 | 🟡 residual, accepted |
| A05-1, A06-0/1/2, A09-2 | — | ✅ closed (round 1), still closed |
| A09-1 no alerting | A09 | 🔴 open, accepted |
| A09-3 activity-log action text | A09 | 🟡 residual, accepted |
| A03-1, A08-1 | — | 🟡 accuracy corrections, stand |
