# KPI-7 round 2 — OWASP Top 10:2021 applicability matrix, all ten rows re-verified

| | |
|---|---|
| **Commit under assessment** | `f7f60f0` (`f7f60f028aa00d8f12e989773cc777416807e599`) |
| **Deployed bundle** | `/assets/index-WAh02M2U.js` — the same content-hashed file `npm run build` produces at `f7f60f0` |
| **Database state** | `20261007101000` applied (REVOKE); `20261007120000` (DROP `seed_demo_insights`) **not applied** at measurement time |
| **Spec** | `docs/KPI_SPEC.md` § KPI-7, pre-registered `da02849` — **not edited** |
| **Date** | 2026-10-07 ICT |
| **Raw command output** | `commands-output.txt` (this directory) — every number below is from it |

Previous rounds: `evidence/kpi7-security/da02849…/matrix.md` (assessment),
`…/29a88bb…/` (A05, A06 re-verified 2026-09-08), `…/f354ac4…/matrix-reverification.md`
(other eight re-verified 2026-09-09). Not edited by this round.

## Summary

| Row | Applies | Status at `f7f60f0` | Moved since round 1? | Whose |
|---|---|---|---|---|
| A01 Broken Access Control | yes | 🟠 **partially mitigated** — see the row | **yes** — new fix, new findings | ours (policies) + inherited (RLS engine) |
| A02 Cryptographic Failures | yes | ✅ re-verified | no | ours (secret handling) + inherited (TLS) |
| A03 Injection | yes, narrowly | ✅ re-verified | no | ours + inherited |
| A04 Insecure Design | yes | ✅ re-verified | no | ours |
| A05 Security Misconfiguration | yes | ✅ re-verified | no | ours |
| A06 Vulnerable Components | yes | ✅ re-verified — 0 Critical | advisory feed moved, packages did not | ours |
| A07 Identification & Auth | yes | ✅ re-verified | no | mostly inherited |
| A08 Software & Data Integrity | yes | ✅ re-verified | corpus 243 → 246 migrations; exception still 27 | ours |
| A09 Logging & Monitoring | yes | ✅ re-verified; A09-1 still open | no | ours |
| A10 SSRF | yes | ✅ re-verified — no surface found | two more literal-host call sites counted | ours |

**10/10 rows answered. No `N/A` claimed.**

---

## A01 — Broken Access Control — 🟠 partially mitigated

### What changed since round 1

Round 1 verified A01 as **cross-tenant** isolation (anon and other-tenant reads).
It did not test **intra-workspace roles**. Two A01 defects of that kind were found
afterwards:

| ID | Defect | Status |
|---|---|---|
| **A01-3** | `is_team_member` ignored `workspace_members.status`: a suspended/removed member kept full access | ✅ closed — `20261007065910` (commit `51e3fc8`), re-verified below |
| **A01-4** | INSERT/UPDATE on `ad_insights` and `ad_accounts` required only membership: a `viewer` could write through PostgREST; "viewer can only view" was enforced in the frontend alone | ✅ closed **for these two tables** — `20261007101000` |
| **A01-5** | `seed_demo_insights(uuid)`: SECURITY DEFINER, no caller check, EXECUTE held by `anon` — anyone with the public anon key could insert 30 rows of fake spend into any ad account with < 5 insight rows | ✅ closed — EXECUTE revoked (`20261007101000`); DROP pending (`20261007120000`) |
| **A01-6** | The same viewer-write shape on 21 other tables, and an indirect path into `ad_insights` through `import_jobs` | 🔴 **open** — README § "Remaining A01 findings" |

### Control (b)

- `ad_accounts` INSERT/UPDATE: `team_manager_insert` / `team_manager_update`,
  both `can_manage_team((SELECT auth.uid()), team_id)`, UPDATE with `WITH CHECK`.
- `ad_insights`: **no** INSERT/UPDATE policy for any client role. Writers are
  service_role only: `meta-sync` (`supabase/functions/meta-sync/index.ts:314`,
  `db = serviceClient()`) and Airflow `promote_batch`.
- `seed_demo_insights`: ACL `{postgres=X/postgres,service_role=X/postgres}` (live).
- Staff policies, DELETE policies and SELECT policies on both tables unchanged.

### Verification (c) — behavioural, real JWTs over PostgREST

`scripts/kpi7-round2-probe.mjs` — no service_role key in the process; writes sent
with `Prefer: return=minimal`; an accepted write is confirmed by the **owner's**
JWT reading it back. Expectations are hand-declared in the script. Fixture:
`scripts/kpi7-round2-fixture.mjs` (new workspace, 7 new `@buzzly.test` users;
suspended and removed members hold role **admin**, so status — not role — is
what must deny them).

**47/47 cases as declared, two runs, identical** (`../a01/probe-run-{1,2}.json`):

| Role | SELECT ad_accounts / ad_insights (test ws) | INSERT ad_accounts | UPDATE ad_accounts | INSERT ad_insights | UPDATE ad_insights |
|---|---|---|---|---|---|
| owner | 1 / 1 | **201, landed** | **204, 1 row** | 403 `42501` | 204, 0 rows |
| admin | 1 / 1 | **201, landed** | **204, 1 row** | 403 `42501` | 204, 0 rows |
| editor | 1 / 1 | 403 `42501` | 204, 0 rows | 403 | 204, 0 rows |
| viewer | 1 / 1 | 403 `42501` | 204, 0 rows | 403 | 204, 0 rows |
| suspended (admin) | **0 / 0** | 403 | 204, 0 rows | 403 | 204, 0 rows |
| removed (admin) | **0 / 0** | 403 | 204, 0 rows | 403 | 204, 0 rows |
| outsider | **0 / 0** (own ws: 1 — control) | 403 | 204, 0 rows | 403 | 204, 0 rows |

`seed_demo_insights` RPC: anon **401 `42501`**, viewer **403 `42501`**, owner
**403 `42501`**; insight count before/after 1 → 1.

A refused UPDATE is HTTP 204 with `Content-Range: */0`, not 403 — RLS filters
the target row out rather than raising. The owner/admin rows (1 row affected,
value read back) are the positive control that the read-back detects a write
that lands.

Post-deploy app check (owner, deployed site): dashboard and `/imports` render;
`meta-oauth/start` returns 200 with a Meta consent URL; the frontend
disconnect write (`ad_accounts.is_active=false`) affects 3 rows as owner and 0
as a viewer, in a rolled-back transaction (`../smoke/`). Full Meta
disconnect/reconnect was **not** run: it revokes the real Meta grant.

### Not re-run this round

**`scripts/kpi7-anon-probe.mjs`** (round 1's 105-relation anon read) reads each
table as `anon` **and as `service_role`**; this round's instructions confine the
service key to fixture setup/teardown. ⏸ Pending a decision — see README.

### Static counts, re-run (`commands-output.txt`)

| Control | round 1 (`f354ac4`) | today |
|---|---|---|
| migrations in corpus | 243 | **246** (`065910`, `101000`, `120000`) |
| `ENABLE ROW LEVEL SECURITY` statements | 138 | 138 |
| `CREATE POLICY` statements | 558 | **560** (the two `team_manager_*`) |
| `security_invoker` | 4 | 4 |
| `TeamPermissionsGuard` use sites | 17 | 17 |
| `CustomerProtectedRoute` in `App.tsx` | 3 | 3 |
| employee role gates `App.tsx:217,228,239` | 3 | 3 |

### Rating, from the facts only

The two tables in scope now enforce the editor/viewer distinction in the
database, and the suspended/removed defect is closed — both proven over
PostgREST with real sessions. **But a viewer can still write through PostgREST
to 21 other tables, and can still drive values into `ad_insights` indirectly
via `import_jobs` + the `imports` bucket** (static evidence; not exercised).
**A01: partially mitigated.**

---

## A02 — Cryptographic Failures

| Control | Today | Round 1 |
|---|---|---|
| `service_role` in `dist/assets/` | **0 files** | 0 |
| JWTs in bundle | **1 — `{"role":"anon","ref":"aokzvknggtccgwbavszj"}`** | same |
| `META_ACCESS_TOKEN` in bundle | **0** | 0 |
| `META_ACCESS_TOKEN` in source | `mock-api/meta/client.ts` + 4 `scripts/*.mjs`, **0 in `src/`** (plus the gitignored `mock-api/.env`, `.env.bak`) | same |
| tracked `.env` files | only 4 `*.example` | same |

Unchanged.

## A03 — Injection

| Control | Today |
|---|---|
| hand-built SQL literals in `src/` (excl. tests, generated types) | **0** |
| `.rpc(` call sites | **21**, named arguments |
| Zod import sites | **3** (`lib/validations/auth.ts`, `pages/support/ActivityCodes.tsx`, `components/social/analytics/AdGroupFormDialog.tsx`) |

A03-1 (Zod is a form-UX control on three screens, not system-wide) **stands**.

## A04 — Insecure Design

| Control | Today |
|---|---|
| atomic promote + DLQ | migrations present; KPI-3 frozen 12/12 (`tests/RESULTS.md`) — not re-run this round |
| `data_source` references in `src/` | **22** (round 1: 22) |
| `.delete(` in `mock-api/meta/*.ts` | **0** |

Unchanged.

## A05 — Security Misconfiguration

All seven headers present live on `/` and on the hashed asset (`curl`, in
`commands-output.txt`): CSP, HSTS `max-age=31536000; includeSubDomains`,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`,
`COOP: same-origin`. `connect-src` = `'self'` + the two Supabase origins.
`vercel.json` unchanged since `29a88bb` (`git diff --stat` empty). Smoke: 0 CSP
violations (`../smoke-prescan/`). ZAP: see README criterion 2.

## A06 — Vulnerable and Outdated Components

`npm audit --omit=dev`, two runs, identical: **0 Critical · 7 High · 2 Moderate**
over 188 production packages — the same nine packages as round 1. Lockfile
unchanged (`a2679b7f…`). The advisory set under them moved: `dompurify`
advisory 1124022 is re-issued as 1240978 (same title) and one new Low,
1241204, appears. Package-level severities unchanged. Details: README criterion 3.

## A07 — Identification and Authentication Failures

| Control | Today |
|---|---|
| `persistSession` / `autoRefreshToken` | `true` / `true` (`client.ts:28-29`) |
| employee role gates | `["dev","owner"]`, `["support","owner"]`, `["owner"]` — unchanged |
| `onAuthStateChange` non-test sites | **9** (round 1: 9) |

Mostly inherited (Supabase Auth). Unchanged.

## A08 — Software and Data Integrity Failures

| Control | Today |
|---|---|
| `package-lock.json` tracked | yes, `a2679b7f…` |
| migrations modified after first commit | **27**, most recent `3844db9` **2026-03-24** — unchanged |
| append-only this round | the three new migrations were **added**, none edited; `20261007101000` was not edited after it was pushed — the DROP is a new file |

## A09 — Security Logging and Monitoring Failures

| Surface | Today |
|---|---|
| `logError(` call sites | **32** (round 1: 32) |
| `ipify` in `src/` | comment + privacy test only — A09-2 stays closed |

**A09-1 still open, accepted:** no alerting on `error_logs` /
`audit_logs_enhanced`. Related, observed this round and not fixed:
`team_activity_logs` has 0 rows although `useTeamManagement.tsx` inserts on
suspend/invite/remove — the suspensions that A01-3 concerns cannot be audited
after the fact. (Audit-call-site count is not re-stated: round 1 did not record
the command that produced "82".)

## A10 — Server-Side Request Forgery

Every Graph call builds a literal host: `mock-api/meta/client.ts:109`,
`supabase/functions/_shared/metaClient.ts:62`, `supabase/functions/_shared/meta.ts:70`
(the last two are the Edge Function leg, not listed in round 1).
`connect-src` allows only our two Supabase origins. **No SSRF surface found.**

---

## Findings register

| ID | Cat | Status at `f7f60f0` |
|---|---|---|
| A01-1, A01-2 | A01 | ✅ closed (round 1) — not re-probed this round (anon probe pending) |
| **A01-3** suspended/removed kept access | A01 | ✅ closed `20261007065910`, re-verified (7 roles × 2 tables) |
| **A01-4** viewer writes ad_insights / ad_accounts | A01 | ✅ closed `20261007101000`, re-verified |
| **A01-5** anon-callable `seed_demo_insights` | A01 | ✅ closed (REVOKE), re-verified; DROP pending |
| **A01-6** viewer writes on 21 other tables + import path | A01 | 🔴 **open** |
| A05-1, A06-0/1/2, A09-2 | — | ✅ closed (round 1), still closed |
| A09-1 no alerting | A09 | 🔴 open, accepted |
| A03-1, A08-1 | — | 🟡 accuracy corrections, stand |
