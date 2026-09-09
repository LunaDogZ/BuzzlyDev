# KPI-7 criterion 1 — the eight carried-forward rows, re-verified against the delivered build

| | |
|---|---|
| **Commit under assessment** | `f354ac47df795014c06d408240a2aa3510debbf0` |
| **Source tree under assessment** | **identical to `29a88bb`** — `git diff --stat 29a88bb f354ac4 -- src/ vercel.json package-lock.json` is empty. The intervening commit added evidence only, so this re-verification speaks for the deployed build (`/assets/index-CfQNKCC9.js`) |
| **`spec_commit`** | `da02849` — `docs/KPI_SPEC.md`, **not edited by this run** |
| **Date** | 2026-09-09 ICT |
| **What this file is** | the missing half of criterion 1. The matrix was completed at `da02849`; two of its ten rows (A05, A06) were re-verified at `29a88bb`. **This file re-verifies the other eight** — A01, A02, A03, A04, A07, A08, A09, A10 |
| **What this file is not** | a new matrix. Applicability (column a) is settled and unchanged; this re-runs the *verification* (column c) and records where a number moved |

**The rule this file is written under.** Every number below was re-measured
today by the command shown. Where it differs from the figure in
`da02849…/matrix.md`, both are given and the difference is explained. Nothing is
copied forward silently — a re-verification that reproduces the old numbers by
quoting them would verify nothing.

---

## Summary

| Row | Status at `f354ac4` | Moved since `da02849`? |
|---|---|---|
| A01 Broken Access Control | ✅ **re-verified — and this is the row that changed most** | yes — from *partially verified* to **fully verified, twice, on the live project** |
| A02 Cryptographic Failures | ✅ re-verified | no |
| A03 Injection | ✅ re-verified | no — the Zod correction still stands |
| A04 Insecure Design | ✅ re-verified | no |
| A07 Identification & Auth | ✅ re-verified | yes — **more `onAuthStateChange` sites than the matrix recorded** (see the row) |
| A08 Software & Data Integrity | ✅ re-verified | corpus grew 236 → 243 migrations; the dated exception is **unchanged at 27** |
| A09 Logging & Monitoring | ✅ re-verified | yes — **finding A09-2 is closed**; no alerting is still absent |
| A10 SSRF | ✅ re-verified | yes — **finding A05-1's dangling host is gone from the code path** |

**10/10 rows answered, 10/10 now verified at the delivered build** (A05 and A06
at `29a88bb`, these eight today).

---

## A01 — Broken Access Control

**The one that matters, and the only row whose status genuinely changed.**

At `da02849` this row was **PARTIALLY VERIFIED**: the static evidence was
complete, but the behavioural probe could not run because the Supabase project
was NXDOMAIN. It was run on 2026-08-28 once the project returned
(`evidence/kpi7-security/fc86210…/`), found two real defects, and those were
remediated. **Today's run is an independent third execution, twelve days later,
against the build that was actually delivered.**

### Static evidence, re-counted today

| Control | `da02849` | today | Command |
|---|---|---|---|
| `ENABLE ROW LEVEL SECURITY` statements | 136 | **138** | `grep -rhc "ENABLE ROW LEVEL SECURITY" supabase/migrations/*.sql \| paste -sd+ \| bc` |
| `CREATE POLICY` statements | 557 | **558** | `grep -rhoc "CREATE POLICY" supabase/migrations/*.sql \| paste -sd+ \| bc` |
| distinct tables with RLS enabled | 122 | **125** | same grep, `ALTER TABLE` target de-duplicated |
| `TeamPermissionsGuard` use sites | 17 | **17** | `grep -rn TeamPermissionsGuard src/` |
| `CustomerProtectedRoute` wrappers in `App.tsx` | 3 | **3** | `grep -c` |
| employee role gates | 3 | **3** | `src/App.tsx:217,228,239` |
| `security_invoker` anywhere in the corpus | **0** | **4** | `grep -rn security_invoker supabase/migrations/*.sql` — all four in `20260822150000_close_anon_readable_views.sql`, the A01 remediation |

The last line is the useful one: at assessment time **no view in the corpus set
`security_invoker`**, which is precisely why two views could hand an RLS bypass
to `anon`. That is no longer true.

### Behavioural evidence — the probe, re-run today

`node scripts/kpi7-anon-probe.mjs a01-relations.txt a01-anon-probe.json`
105 relations (103 tables + 2 views), each read **twice** — once as `anon`, once
as `service_role`. Raw output: `a01-anon-probe.json`.

| Verdict | 2026-08-22 (before fix) | 2026-08-28 (after fix) | **today** |
|---|---|---|---|
| `anon blocked` — service_role saw rows, anon saw none | 52 | 53 | **53** |
| `INCONCLUSIVE` — empty for both roles, proves nothing | 40 | 40 | **41** |
| `ANON-READABLE` | **13** | 11 | **11** |

**Today reproduces the remediated state exactly.** A row-by-row diff against
the 2026-08-28 run finds **one** difference in 105 relations:
`debug_insights_linkage`, absent from that run's output, today answers **404 —
not in the schema cache**, i.e. the dropped view stays dropped. Everything else
is verdict-identical.

The two defects the probe originally found are both closed, and closed
*observably*, not by reading the migration:

| Finding | Then | Today, as `anon` |
|---|---|---|
| **A01-1** `audit_logs_view` — 967 rows of `user_email`, `ip_address`, `user_id` without a session | **High** | **`401 permission denied for view audit_logs_view`** |
| **A01-2** `debug_insights_linkage` — 50 rows across all tenants | Medium | **`404` — view dropped** |

### The 11 that remain anon-readable, checked again rather than assumed

`business_types` (8) · `platforms` (9) · `industries` (8) ·
`point_earning_rules` (5) · `genders` (4) · `loyalty_tiers` (4) ·
`payment_methods` (3) · `role_employees` (3) · `subscription_plans` (3) ·
`currencies` (2) · `reward_items` (1)

Three were re-read in full today rather than trusted from the count —
`role_employees`, `reward_items`, `point_earning_rules`. Every row is
catalogue data: role *definitions* (`owner`/`support`/`dev` with a permission
level), a loyalty reward description, a points rule. **No tenant identifier, no
personal data, no workspace reference.** The contrast that makes this
meaningful: `user_roles`, which holds the *assignments* (38 rows), is blocked.

**The tenant-bearing tables are all in the blocked column, each with the
service_role control showing the instrument works:**
`ad_insights` (3,314 rows to service_role, 0 to anon) · `audit_logs_enhanced`
(1,286) · `points_transactions` (138) · `error_logs` (109) ·
`social_posts` (89) · `profile_customers` (73) · `loyalty_points` (73) ·
`customer` (62) · `campaigns` (24) · `workspace_members` (23) ·
`ad_accounts` (18) · `workspaces` (14) · `workspace_api_keys` (10) ·
`employees` (5) · `payment_transactions` (4).

**Recorded honestly:** the ingestion tables — `import_jobs`,
`import_row_errors`, `ingestion_staging`, `ingestion_batches`, `invoices` — are
`INCONCLUSIVE`, because they are empty for `service_role` too. The probe is
designed to refuse to call that a pass, and it does. (The emptiness itself is a
separate known issue, L-7 in the project notes.)

---

## A02 — Cryptographic Failures

Re-run against `dist/assets/`, the same build hash the production deployment
serves (`index-CfQNKCC9.js`).

| Control | Verification run today | Result |
|---|---|---|
| No `service_role` key in the shipped bundle | `grep -rl service_role dist/assets/` | **0 files** |
| The only JWT shipped is the `anon` key | every `eyJ…` in `dist/assets/*.js` decoded, `role` claim read | **1 token · `{"iss":"supabase","ref":"aokzvknggtccgwbavszj","role":"anon"}`** |
| No Meta token in the bundle | `grep -rl META_ACCESS_TOKEN dist/assets/` | **0** |
| Meta credentials server-side only | `grep -rln META_ACCESS_TOKEN src/ mock-api/ scripts/` | **`mock-api/meta/client.ts` + 4 `scripts/*.mjs`; zero hits in `src/`** — never behind a `VITE_` prefix |
| No `.env` tracked in git | `git ls-files \| grep -E "(^\|/)\.env"` | **only 4 `*.example` files** |

**Unchanged from `da02849`. The row is re-verified, not re-asserted.**

---

## A03 — Injection

| Control | Verification run today | Result |
|---|---|---|
| No hand-built SQL on the client | grep for `SELECT … FROM` / `INSERT INTO` / `DROP TABLE` literals across `src/**` | **0 matches** |
| Parameterised RPC boundary | `grep -rn "\.rpc(" src/` | **21 call sites**, all named arguments |
| Ingestion validation | `20260805150000_ingestion_dlq_and_atomic_promote.sql` present | see A04 |

**The correction stands.** Zod is still imported in exactly **3 files**
(`src/lib/validations/auth.ts`, `src/pages/support/ActivityCodes.tsx`,
`src/components/social/analytics/AdGroupFormDialog.tsx`). The spec's
description of it as a system-wide input-validation control was wrong at
`da02849` and is still wrong; the chapter must describe it as a form-UX control
on three screens. **Re-checking did not make this go away, which is the point of
re-checking.**

---

## A04 — Insecure Design

| Control | Verification today | Result |
|---|---|---|
| Atomic, all-or-nothing promote | migration present; **KPI-3 frozen at 12/12, zero rows leaked across six fact tables + `ingestion_staging`** (`tests/RESULTS.md`) | holds |
| Dead-letter queue | same | holds — 12/12 with the correct error code |
| Provenance column | `grep -rn data_source src/` | **22 references** (was 22) |
| **Delete guard** — "a sync may only delete what a sync wrote" | `grep -rn "\.delete(" mock-api/meta/*.ts` | **0 call sites.** The 3 `delete` hits in the live Meta leg are comments describing the guard; the 10 `.delete()` calls in `mock-api/server.ts` remain confined to the mock full-replace path |

Unchanged. This row's verification is a frozen KPI rather than a claim written
for this document, which is why it is the strongest row in the matrix.

---

## A07 — Identification and Authentication Failures

| Control | Verification today | Result |
|---|---|---|
| Session persistence + auto-refresh | `src/integrations/supabase/client.ts:25-31` | `persistSession: true`, `autoRefreshToken: true` — unchanged |
| Employee role gating | `src/App.tsx:217,228,239` | `["dev","owner"]`, `["support","owner"]`, `["owner"]` — unchanged |
| Auth-state propagation | `grep -rn onAuthStateChange src/` | ⚠️ **moved — 9 non-test source sites, not 2** |

⚠️ **A number the matrix got right for its date and that is now wrong.**
`da02849` recorded two `onAuthStateChange` subscriptions (`PlanContext`,
`useEmployeeAuth`). Today there are **nine** in source: `App.tsx`,
`CustomerProtectedRoute.tsx`, `contexts/PlanContext.tsx`,
`hooks/useEmployeeAuth.tsx`, `hooks/useLoyaltyTier.tsx`,
`hooks/usePlatformConnections.tsx`, `pages/Auth.tsx`, `pages/Landing.tsx`,
`pages/SignUp.tsx`.

This is not a defect and not drift — it is the **KPI-4 optimisation pass**
(`536c50b`…`29a88bb`), which moved auth-event handling into the components that
needed it and taught three providers to ignore events that change nothing. It
is recorded here because a matrix row that says "2 sites" against a build with
9 would be false, and because the chapter's security section and its
performance section are describing the same commits from two directions.

**The row's substance is unchanged: A07 is mostly inherited.** Password
hashing, token issuance, rotation and expiry are Supabase's implementation.
Ours is the wiring and the role model, and the wiring now has more sites.

---

## A08 — Software and Data Integrity Failures

| Control | Verification today | Result |
|---|---|---|
| Dependency integrity | `git ls-files package-lock.json` | tracked; `sha256 a2679b7f…` |
| Frozen test corpus | `tests/fixtures/MANIFEST.json` | present; KPI-2/3 reproduced 35/35 identically across two runs |
| Migrations append-only | `git log --diff-filter=M -- supabase/migrations/` | **27 files modified after first commit — the same 27**, most recent `3844db9`, **2026-03-24** |

The corpus grew from 236 to **243** migrations since the assessment. **The
exception did not grow with it: still 27, still all inside the inherited
Feb–Mar MVP shell, still nothing modified during the research period.** Fifteen
weeks and seven new migrations later, the claim "append-only is enforced for
the research work" has more evidence behind it than it did, not less.

---

## A09 — Security Logging and Monitoring Failures

| Surface | `da02849` | today |
|---|---|---|
| `logError(` call sites | 33 | **32** |
| audit call sites | 77 | **82** |
| Sync provenance / notifications | 2 / 8 | unchanged |

**🟢 FINDING A09-2 IS CLOSED — and it was closed by removal, not by
allow-listing.** The matrix recorded that `src/lib/auditLogger.ts` fetched the
client IP from `https://api.ipify.org` on every audit event: an undisclosed
third-party request from the user's browser, writing a raw public address into
`audit_logs_enhanced`. As of `8d9522b` the fetch is gone, `ip_address` is
written as `null`, and the file carries the reasoning in place of the code —
including why the value was worthless (a browser-reported IP is trivially
forged) and what to do instead if a real need appears (take it server-side, and
disclose it).

`grep -rn ipify src/` returns **2 hits: a comment and a privacy regression
test**. No call site.

This matters beyond the finding: the removal is what makes the KPI-6 consent
script (`evidence/kpi6-sus/protocol.md`) true when it is read to a participant
this Friday.

**🔴 A09-1 is still open and still accepted: there is no alerting.** Rows
accumulate in `error_logs` and `audit_logs_enhanced` and nothing watches them —
no threshold, no notification, no on-call path. Detection is retrospective and
manual. This is a design limitation the chapter must state, not a defect
introduced since.

---

## A10 — Server-Side Request Forgery

| Question | Finding today |
|---|---|
| Does the browser app make user-controlled outbound requests? | **No.** The only `https://` hosts in non-test `src/**` are documentation links rendered as anchors (`supabase.com` ×4), test/example strings, and one comment naming the removed host |
| Does `mock-api` fetch a URL an attacker can steer? | **No.** `mock-api/meta/client.ts:109` still builds every Graph call as `new URL(\`https://graph.facebook.com/${config.version}${path}\`)` — literal host |
| CSP `connect-src` as deployed | `'self' https://aokzvknggtccgwbavszj.supabase.co wss://aokzvknggtccgwbavszj.supabase.co` — **two hosts, both ours** |

**🟢 FINDING A05-1 IS CLOSED, and closed by failing shut.** The hard-coded
fallback to `https://mock-api-sable.vercel.app/` — a stale auto-named
deployment this project neither owns nor allows in its own CSP — is gone
(`eae9135`). `MOCK_API_BASE_URL` is now `string | null`, callers go through
`backendUrl()`, and an unconfigured backend raises `BackendNotConfiguredError`
instead of guessing a host. A regression test asserts the string
`mock-api-sable` never reappears in the resolved base URL.

The A10 conclusion is unchanged and now has one fewer adjacent hazard: **A10
applies, and no SSRF surface was found.**

---

## The declared CSP exception that is withdrawn

`docs/KPI_SPEC.md` § KPI-7 A05 and `da02849…/matrix.md` both declare
`api.ipify.org` as a CSP exception, with the reason *"`src/lib/auditLogger.ts`
fetches the client IP for audit rows"*.

**That exception no longer exists.** The fetch was removed (`8d9522b`, finding
A09-2 above) and the host is **not in the deployed policy** — `connect-src` is
`'self'` plus the two Supabase origins and nothing else.

**Neither the spec nor the `da02849` matrix is edited to say so, and that is
deliberate.** `docs/KPI_SPEC.md` is the pre-registration: what was declared
before measuring is a fact about the experiment's design and stays as declared.
The `da02849` matrix is a dated assessment and past rounds are not edited. The
withdrawal is recorded **here**, in the dated file that supersedes them, which
is the same discipline every other round in this KPI follows.

**For the chapter:** three CSP exceptions were declared in advance
(`style-src 'unsafe-inline'`, Google Fonts, `api.ipify.org`) plus
`worker-src 'self' blob:`. **Two remain and are justified in the ZAP analysis;
the third was withdrawn by deleting the feature that needed it.** A declared
exception that gets removed rather than defended is the better outcome, and the
pre-registration is what makes it visible.

---

## Findings register — status at this commit

Every finding from `da02849…/matrix.md`, re-checked today. Nothing was fixed
*by* this assessment.

| ID | Cat | Severity | Status at `f354ac4` | Closed by |
|---|---|---|---|---|
| A01-1 | A01 | **High** | ✅ **closed** — `anon` gets `401 permission denied` | `20260822150000_close_anon_readable_views.sql` |
| A01-2 | A01 | Medium | ✅ **closed** — view dropped, `404` | same migration |
| A06-0 | A06 | **Critical** | ✅ **closed** — lockfile pins `jspdf@4.2.1`, 0 Critical in both runs at `29a88bb` | `eae9135` |
| A06-1 | A06 | Medium | ✅ **closed** — `tailwindcss-animate` is in `devDependencies`; prod tree 365 → 188 packages | `eae9135` |
| A06-2 | A06 | Low | ✅ **closed** — no `three`/`@react-three/*` entry remains in `package.json` | `eae9135` |
| A05-1 | A05 | Medium | ✅ **closed** — fails closed, no fallback host | `eae9135` |
| A09-2 | A09/A02 | Low (privacy) | ✅ **closed** — collection removed entirely | `8d9522b` |
| **A09-1** | A09 | Low (design) | 🔴 **open, accepted and disclosed** — no alerting on `error_logs` / `audit_logs_enhanced` | — |
| A03-1 | A03 | (accuracy) | 🟡 **stands** — Zod is 3 files, not a system-wide control; the spec's wording is corrected here, not in the spec | — |
| A08-1 | A08 | (accuracy) | 🟡 **stands** — 27 migrations modified, all pre-2026-03-24, none in the research period | — |

**Seven of ten closed. The three that remain are two accuracy corrections and
one accepted design limitation — none of them a live defect.**

---

## What criterion 1 now claims

> The OWASP Top 10 (2021) applicability matrix answers **10 of 10** categories,
> with no category blank and no `N/A` claimed. Every row's verification has been
> re-executed against the delivered build: A05 and A06 on 2026-09-08, the
> remaining eight on 2026-09-09. The behavioural probe that the original
> assessment could not run — 105 relations read as `anon` and as `service_role`
> — has now been executed three times across nineteen days, and reproduces the
> post-remediation state exactly.

**Criterion 1: MET, and now verified rather than carried.**

With criteria 2, 3 and 4 met at `29a88bb`, **all four pre-registered criteria of
KPI-7 are met.**

The honest boundary, stated so the chapter does not overreach: this is a
**passive** scan plus a **static and behavioural** matrix. No authenticated
active scan, no penetration test, and no attempt to defeat RLS with a valid
session for another tenant beyond the tenant-isolation probe already recorded in
`evidence/rls-tenant-isolation/`. What is claimed is what was measured.

---

## Files

```
evidence/kpi7-security/f354ac4…/
  a01-relations.txt          the 105 relations, unchanged population
  a01-anon-probe.json        raw probe output, today
  matrix-reverification.md   this file
  meta.json                  environment pin and exact commands
```
