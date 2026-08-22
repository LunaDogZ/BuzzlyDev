# KPI-7 Layer 1 — OWASP Top 10 (2021) applicability matrix

| | |
|---|---|
| **Commit under assessment** | `da02849c41acd8c8e8832725481eab6c7067294b` |
| **`spec_commit`** | the same commit — `docs/KPI_SPEC.md` was pre-registered by it |
| **Date** | 2026-08-22 (ICT) |
| **Scope** | The React SPA and the Supabase project it reads. `mock-api` (Express, local only) is **out of scope for scanning** but **in scope for this matrix**, because A02 and A10 are about where its credentials and outbound calls go. |
| **Environment note** | Written against the local repository and a production build of the commit above. **The Supabase project host was NXDOMAIN at assessment time** (see A01), so every control that needed a live query is marked *verification pending*, never assumed. |

**Reading rule.** Column (c) is the point of this document. A control that is
only *asserted* is written as asserted and is not counted. Where a check was run,
the command is given so a reader can run it again.

**Shared responsibility.** Every control is `ours` or `inherited`. An inherited
control is part of the system's posture but is **not this project's
engineering**, and the chapter must not present it as such.

---

## Summary

| Cat | Applies | Control verified? | Whose |
|---|---|---|---|
| A01 Broken Access Control | yes — the central one | **partial** — static evidence complete, live probe blocked | ours + inherited |
| A02 Cryptographic Failures | yes | **verified** | ours + inherited |
| A03 Injection | yes, narrowly | **verified, with one honest correction** | ours + inherited |
| A04 Insecure Design | yes | **verified** | ours |
| A05 Security Misconfiguration | yes | **partial** — headers unexercised; one real finding | ours |
| A06 Vulnerable Components | yes | **verified — and it FAILS** | ours |
| A07 Identification & Auth Failures | yes | **verified** | mostly inherited |
| A08 Software & Data Integrity | yes | **verified, with a dated exception** | ours |
| A09 Logging & Monitoring | yes | **verified** | ours |
| A10 SSRF | yes, but no user-controlled surface | **verified** | ours |

**10/10 answered.** No category is left blank and no `N/A` is claimed.

---

## A01 — Broken Access Control

**(a) Applies.** This is the central category for this system. There is no
application server of our own: the browser speaks to PostgREST directly, so
**Row-Level Security is the only thing standing between one merchant's data and
another's.** Everything in the UI is defence in depth on top of it.

**(b) Controls.**

| Control | Artifact | Whose |
|---|---|---|
| RLS enabled per table | 136 `ENABLE ROW LEVEL SECURITY` statements over 122 distinct tables across 236 migrations | ours |
| Policies | 557 `CREATE POLICY` statements | ours |
| `auth.uid()` wrapped in a scalar subquery | `supabase/migrations/20260811100100_rls_policies_wrap_auth_uid.sql` (F-2, 322 `ALTER POLICY`) | ours |
| RLS helpers made `STABLE` and caller-scoped | `supabase/migrations/20260811100000_rls_helpers_stable_and_caller_scoped.sql` (F-1, F-4) | ours |
| Route-level customer guard | `CustomerProtectedRoute`, 3 wrappers in `src/App.tsx` | ours |
| Per-feature permission guard | `TeamPermissionsGuard`, 17 use sites | ours |
| Employee role gating | `EmployeeProtectedRoute allowedRoles=` — `["dev","owner"]` `src/App.tsx:219`, `["support","owner"]` `:230`, `["owner"]` `:241` | ours |
| Policy **enforcement engine** | Postgres RLS as operated by Supabase | **inherited** |

**(c) Verification — this is where the honesty is.**

*Done:* the counts above were produced by reading the migration corpus, not
from memory:

```
grep -rhc "ENABLE ROW LEVEL SECURITY" supabase/migrations/*.sql | paste -sd+ | bc   # 136
grep -rhoc "CREATE POLICY"            supabase/migrations/*.sql | paste -sd+ | bc   # 557
```

*Not done, and it is the check that matters:* **a behavioural probe of all 103
tables and 2 views as the `anon` role.** The probe is written
(`a01-anon-probe.json` is its intended output) and is designed so that it
**cannot pass vacuously** — every relation is read twice, once as `anon` and
once as `service_role`, and a relation that is empty for *both* is reported
`INCONCLUSIVE`, never as a pass. That design is required by CLAUDE.md §12: "no
rows returned" is not evidence unless the same instrument is shown returning
rows when authorised.

It could not be executed on 2026-08-22 because
`aokzvknggtccgwbavszj.supabase.co` returns **NXDOMAIN** from Cloudflare's public
resolver while `supabase.co` resolves normally — i.e. the project is paused or
removed, not a local DNS fault:

```
aokzvknggtccgwbavszj.supabase.co  -> NXDOMAIN
supabase.co                       -> NOERROR 76.76.21.21
```

**A01 is therefore recorded as PARTIALLY VERIFIED.** The static evidence is
complete; the live evidence is outstanding and must be obtained before the
chapter claims A01 is controlled.

---

## A02 — Cryptographic Failures

**(a) Applies.** The app transmits ad spend and revenue figures and holds a
long-lived Meta access token.

**(b) + (c) Controls and their verification.**

| Control | Verification run | Result | Whose |
|---|---|---|---|
| No `service_role` key in the shipped bundle | `grep -rl service_role dist/assets/` | **0 files** | ours |
| The only JWT shipped is the `anon` key | every `eyJ…` in `dist/assets/*.js` base64-decoded and its `role` claim read | **1 token, `role="anon"`, `ref="aokzvknggtccgwbavszj"`** | ours |
| No Meta token in the bundle | `grep -rl META_ACCESS_TOKEN dist/assets/` = 0; a literal `EAA` hit was decoded and is a **Unicode character-class base64 table, not a token** | **clean** | ours |
| Meta credentials server-side only | `META_ACCESS_TOKEN` appears only in `mock-api/meta/client.ts:45,70` and `scripts/meta-*.mjs`, read from `mock-api/.env` — never behind a `VITE_` prefix | **holds** | ours |
| No `.env` tracked in git | `git ls-files | grep .env` returns only four `*.example` files | **holds** | ours |
| TLS in transit | Vercel edge and Supabase endpoints | — | **inherited** |

**Note for the chapter, stated rather than hidden.** The `anon` key being in the
bundle is correct and unavoidable — it is a public identifier, and RLS, not
secrecy of that key, is the access control. This is worth one sentence in the
chapter because a reader who greps the bundle will find it and should already
have been told why it is there.

---

## A03 — Injection

**(a) Applies, narrowly.** The client builds no SQL. The realistic surfaces are
PostgREST filter construction, the 21 `.rpc()` call sites, and the file
ingestion parser.

**(b) + (c).**

| Control | Verification | Result | Whose |
|---|---|---|---|
| No hand-built SQL on the client | grep for `SELECT … FROM` / `INSERT INTO` / `DROP TABLE` string literals across `src/**` | **no raw SQL literals** | ours |
| Parameterised RPC boundary | 21 `.rpc()` call sites pass named arguments, not concatenated SQL | holds | ours + inherited |
| Query parameterisation | PostgREST binds filter values | — | **inherited** |
| Ingestion validation | Python validators + `promote_batch`, `supabase/migrations/20260805150000_ingestion_dlq_and_atomic_promote.sql` | see A04 | ours |

**⚠️ Correction to the spec's starting point, and it must not be glossed.**
`docs/KPI_SPEC.md` lists "Zod validation on forms" as an A03 control. Measured:
**Zod is imported in 3 files only** — `src/lib/validations/auth.ts`,
`src/pages/support/ActivityCodes.tsx`,
`src/components/social/analytics/AdGroupFormDialog.tsx`. It is **not** a
system-wide input-validation control and the chapter must not describe it as
one. The real defence on the data path is RLS plus PostgREST parameterisation,
both of which hold; Zod is a *form UX* control on three screens.

---

## A04 — Insecure Design

**(a) Applies.** The research contribution is a design claim — that ingestion is
all-or-nothing and that provenance is never invented — so this category is where
that claim gets audited.

**(b) + (c).**

| Control | Artifact | Verification | Whose |
|---|---|---|---|
| Atomic, all-or-nothing promote | `promote_batch` in `20260805150000_ingestion_dlq_and_atomic_promote.sql` | **KPI-3: 12/12 fixtures leaked zero rows across six fact tables + `ingestion_staging`** (`tests/RESULTS.md`) | ours |
| Dead-letter queue | same migration | **KPI-3: 12/12 DLQ records with the correct error code** | ours |
| Provenance column | `ad_insights.data_source`, `20260806090000_ad_insights_data_source.sql`, `20260812060000_…_mock_meta_live.sql`; 22 references in `src/` | rendered in the UI source picker (`857cdec`) | ours |
| **Delete guard — "a sync may only delete what a sync wrote"** | the live Meta leg contains **no delete code at all** | `grep -rn "delete" mock-api/meta/*.ts` returns **only comments describing the guard**; every live write is an upsert on a `uuid5`-derived id. The nine `.delete()` calls in `mock-api/server.ts` all belong to the mock `/api/connect` full-replace path | ours |
| Refusing to display what was not measured | `9b12678` removed fabricated `revenue × 0.85`; `db5db64` withholds frequency unless every row reported it | 4 tests + a sabotage check that fails 3/4 when the fallback returns | ours |

This row is the strongest in the matrix, because its verification is an existing
frozen KPI rather than an assertion written for this document.

---

## A05 — Security Misconfiguration

**(a) Applies.**

**(b) Controls.** `vercel.json` (commit `be1ece2`, added 2026-08-14 **before**
pre-registration) sets CSP, HSTS, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy`, and `Cross-Origin-Opener-Policy: same-origin`.

Declared CSP exceptions, each with its reason:

| Exception | Reason |
|---|---|
| `style-src 'unsafe-inline'` | Radix and Recharts write inline `style` attributes |
| `fonts.googleapis.com` / `fonts.gstatic.com` | `src/index.css:1` imports webfonts via `@import` |
| `api.ipify.org` | `src/lib/auditLogger.ts:44` fetches the client IP for audit rows |
| `worker-src 'self' blob:` | export libraries |

**(c) Verification — two gaps, both recorded rather than smoothed over.**

1. **The headers have never been exercised.** `vite preview` does not apply
   `vercel.json`, so no request has ever been served with this CSP. The
   post-deploy smoke checklist in `docs/KPI_SPEC.md` is mandatory before any ZAP
   result counts.

2. 🔴 **FINDING A05-1 — the app has a hard-coded fallback to a third-party host
   that CSP will block.** `src/lib/mockApiKeys.ts:15-21`:

   ```ts
   const rawBackend =
     typeof import.meta.env.VITE_BACKEND_API_URL === 'string' && …length > 0
       ? import.meta.env.VITE_BACKEND_API_URL
       : 'https://mock-api-sable.vercel.app/';
   ```

   Two problems, and they point in opposite directions:
   - `mock-api-sable.vercel.app` is **not in `connect-src`**, so in production
     the call is blocked by our own CSP — a silent functional break.
   - If it *were* allowed, the app would send API-key traffic to a host that the
     project decided on 2026-08-14 **not** to deploy or control. A stale
     auto-named Vercel host is exactly the kind of dangling target that should
     never be a default.

   **Recommended remediation** (a code change — not applied by this assessment):
   fail closed instead. If `VITE_BACKEND_API_URL` is unset, the connect UI
   should disable itself with a stated reason rather than fall back to a host
   nobody owns. Note this is on the *connect/sync write path only*, which is
   driven by the researcher and not by a KPI-6 participant.

3. RLS default-on and `service_role` absent from the bundle — verified under A01
   and A02 respectively.

---

## A06 — Vulnerable and Outdated Components ❌ **FAILS criterion 3**

**(a) Always applies.**

**(b) Control.** `npm audit --omit=dev` over the production dependency tree;
`package-lock.json` committed; Airflow image pinned `buzzly/airflow:3.2.2`.

**(c) Verification — run twice on the same commit and same lockfile
(`sha256 b923ea58…`), as criterion 4 requires. The two runs are byte-identical
in every field compared: totals, package set, and per-package severity.**

```
run-1 = run-2 = {info 0, low 0, moderate 4, high 13, critical 1, total 18}
```

**Correction to a figure carried in the spec:** it says "57 prod dependencies".
57 is the count of **direct** entries in `dependencies`; the audited production
*tree* is **365 packages**. Both numbers are right about different things and
the chapter should use 365.

### Verdict against pre-registered criterion 3 — "0 Critical" — **FAIL**

**1 Critical: `jspdf@4.2.0`** — GHSA-7x6v-j9x4-qf24 (PDF object injection via
FreeText colour) and GHSA-wfv2-pwc8-crg5 (HTML injection in new-window paths).

### Reachability analysis — which of the 18 actually reach a browser

Asserting "it's only a build tool" would be worthless, so it was measured:
`vite build --sourcemap`, then every emitted `.map`'s `sources` array searched
for `node_modules/<pkg>/`. 1,427 modules across 129 chunks. Raw output in
`a06-bundle-reachability.json`.

| Package | Severity | In the browser bundle? | Chunk |
|---|---|---|---|
| **jspdf** | **critical** | **YES** | `jspdf.es.min-CvfpKX18.js` |
| xlsx | high | **YES** | `Reports-BMMx-W__.js` |
| lodash | high | **YES** | recharts chunks |
| d3-color | high | **YES** | recharts + react-simple-maps |
| @remix-run/router · react-router · react-router-dom | high | **YES** | `index-CUrfyO5P.js` |
| dompurify | moderate | **YES** (pulled in by jspdf) | `purify.es-B9ZVCkUG.js` |
| html2canvas | — | YES | `jspdf.es.min-…` |
| ws | high | **no** — `@supabase/realtime-js` uses the browser's native WebSocket | — |
| nanoid · postcss · glob · minimatch · picomatch · brace-expansion · yaml | high/mod | **no** — build toolchain | — |
| uuid | moderate | **no** | — |

**Two structural findings fall out of this, and they are more useful than the
CVE list itself:**

🔴 **FINDING A06-1 — `tailwindcss-animate` sits in `dependencies`,** dragging the
entire Tailwind build toolchain (`tailwindcss` → `postcss`, `sucrase`, `glob`,
`minimatch`, `picomatch`, `brace-expansion`, `yaml`, `nanoid`) into the
*production* tree. **8 of the 18 findings are only present because of this one
misplacement**, and none of those packages reaches a browser. It is a
build-time-only plugin used by `tailwind.config.ts`; it belongs in
`devDependencies`.

🔴 **FINDING A06-2 — `@react-three/drei` is a production dependency that nothing
imports.** `grep -rn "@react-three" src/` returns **zero** matches, and the
sourcemap confirms neither it nor `three` is in any chunk. It is dead weight
carrying the `uuid` moderate advisory and should be removed outright.

### Exposure analysis for the Critical, and it is narrow

Our entire jsPDF call surface is three calls, in two files:

```
src/lib/reportPdf.ts:14   new jsPDF({...})
src/lib/reportPdf.ts:23   pdf.addImage(imgData, "JPEG", ...)
src/lib/reportPdf.ts:24   pdf.output("blob")
src/pages/owner/ExecutiveReport.tsx:130  pdf.output("blob")
```

**Neither vulnerable path is reached.** No FreeText annotation is ever created,
and output is always `"blob"` — never `"dataurlnewwindow"`, which is the
new-window HTML-injection sink. The content rendered into the PDF is a
`html2canvas` raster of our own DOM, not attacker-supplied PDF objects.

**This narrows the exposure. It does not change the verdict.** Criterion 3 was
pre-registered as "0 Critical in production dependencies", not "0 *reachable*
Critical", and the criterion is what it is. **KPI-7 criterion 3 = FAIL, recorded
as FAIL.**

### Remediation, pre-registered in the spec and requiring approval before it runs

`docs/KPI_SPEC.md` already declares the response: *"Critical in npm audit:
report, upgrade if a fixed version exists, re-run."* A fixed version exists —
**`jspdf@4.2.1`** is the current `latest`, and our `^4.2.0` range already admits
it; only the lockfile pins 4.2.0, so `npm update jspdf` resolves it with no
`package.json` change.

That upgrade is **not performed by this assessment**. It is a code change, and
per the spec it is reported as a **separate dated before/after run**, so the
failing run above is preserved as the "before". The threshold does not move.

---

## A07 — Identification and Authentication Failures

**(a) Applies.**

**(b) + (c).**

| Control | Artifact | Whose |
|---|---|---|
| Password auth, session issuance, token refresh | Supabase Auth | **inherited** |
| Session persistence + auto-refresh configured | `src/integrations/supabase/client.ts:28-29` — `persistSession: true`, `autoRefreshToken: true` | ours (configuration only) |
| Auth-state propagation | `supabase.auth.onAuthStateChange` in `src/contexts/PlanContext.tsx:156` and `src/hooks/useEmployeeAuth.tsx:31` | ours |
| Separate employee identity path | `employees` table + `useEmployeeAuth`, roles `dev`/`support`/`owner` | ours |

**Say this plainly in the chapter: A07 is mostly inherited.** Password hashing,
session token issuance, rotation and expiry are Supabase's implementation, not
this project's. What is ours is the *wiring* and the role model. Claiming the
authentication implementation as project engineering would be the single most
common overclaim in an undergraduate security chapter, and this row exists to
prevent it.

---

## A08 — Software and Data Integrity Failures

**(a) Applies.**

**(b) + (c).**

| Control | Verification | Result |
|---|---|---|
| Dependency integrity | `git ls-files package-lock.json` | tracked |
| Migrations append-only | `git log --diff-filter=M -- supabase/migrations/` | **see the exception below** |
| Frozen test corpus with hand-declared expectations | `tests/fixtures/MANIFEST.json`; KPI-2/3 reproduced 35/35 identically across two runs | holds |

**⚠️ Dated exception, stated rather than omitted.** The append-only rule has
**not** held for the whole history: **27 of 236 migration files were modified
after their first commit.** Every one of those modifications falls between
**2026-02-07 and 2026-03-24** — the inherited MVP shell — and the most recent is
`3844db9` (2026-03-24). **Zero migrations have been modified since**, and none
during the research period (from 2026-07-01 onward).

The accurate claim for the chapter is therefore: *append-only is enforced for
the research work and is verifiable by `git log`; the inherited shell predates
the rule.* This matches the independent finding from the 2026-08-11 skills audit
that all its findings sat in the Feb–Mar MVP shell and none in the research code.

---

## A09 — Security Logging and Monitoring Failures

**(a) Applies.**

**(b) + (c).**

| Surface | Table | Call sites |
|---|---|---|
| Application errors | `error_logs` via `logError` (`@/services/errorLogger`) | 33 `logError(` call sites; 5 direct `from("error_logs")` |
| Audit trail | `audit_logs_enhanced` via `src/lib/auditLogger.ts` | 77 audit call sites; 11 direct table writes |
| Sync provenance | `sync_history` | 2 |
| User-facing notifications | `notifications` | 8 |

**What is NOT in place, and the chapter must say so:** there is **no alerting**.
Rows accumulate in `error_logs` and `audit_logs_enhanced`, and nothing watches
them — no threshold, no notification, no on-call path. Detection is entirely
retrospective and manual. `detect_suspicious_points_activity()` exists for
loyalty fraud but is a query, not a monitor.

**Privacy note that belongs here and in A02.** `src/lib/auditLogger.ts:44` sends
a request to `https://api.ipify.org` on audit events to approximate the client
IP. That is an **undisclosed third-party request made from the user's browser**,
and the file's own comment concedes "in production, this should be done
server-side". It is allow-listed in the CSP as a named exception. It should be
disclosed in the participant consent text for KPI-6.

---

## A10 — Server-Side Request Forgery

**(a) Applies in principle; no user-controlled surface exists.** This is
answered, not waived.

**(b) + (c) Verification.**

| Question | Finding |
|---|---|
| Does the browser app make user-controlled outbound requests? | No. The hosts appearing in `src/**` are `*.supabase.co`, `api.ipify.org`, and documentation links (`developers.facebook.com`, `developers.google.com`, `open.shopee.com`, `ads.tiktok.com`) rendered as anchors, not fetched. |
| Does `mock-api` fetch a URL an attacker can steer? | No. `mock-api/meta/client.ts:108` builds every Graph call as `new URL("https://graph.facebook.com/" + config.version + path)` — the host is a literal. The only other outbound call is `${EXTERNAL_API_BASE_URL}/${platform}/${tenant}/…` (`mock-api/server.ts:1251-1256`), where the base is an operator-set env var and `platform`/`tenant` come from `keyInfo` — a **fixed dictionary lookup keyed by API key**, not free text. |
| Outbound hosts reachable from `mock-api` | exactly one literal: `graph.facebook.com` |

**Conclusion: A10 applies, and no SSRF surface was found.** The CSP
`connect-src` allow-list is a second, independent constraint on the browser
side. Note that FINDING A05-1 is adjacent to this category — a *default* pointing
at an unowned third-party host is the kind of thing that becomes an SSRF-shaped
problem once someone "fixes" the CSP by widening it.

---

## Findings register

| ID | Cat | Severity (ours) | Finding | Status |
|---|---|---|---|---|
| A06-0 | A06 | **Critical** | `jspdf@4.2.0` — 2 advisories. Ships to the browser. Vulnerable paths not reached by our call surface. | **FAILS criterion 3.** Fix exists (`4.2.1`), awaiting approval |
| A06-1 | A06 | Medium | `tailwindcss-animate` in `dependencies` pulls the Tailwind toolchain into the prod tree — 8 of 18 findings | open, fix is a one-line move |
| A06-2 | A06 | Low | `@react-three/drei` is a prod dependency nothing imports | open, remove |
| A05-1 | A05 | Medium | Hard-coded fallback to `https://mock-api-sable.vercel.app/`, a host we neither own nor allow in CSP | open, should fail closed |
| A09-1 | A09 | Low (design) | No alerting on `error_logs` / `audit_logs_enhanced` | accepted, disclosed |
| A09-2 | A09/A02 | Low (privacy) | Client IP fetched from `api.ipify.org` in the browser | disclose in KPI-6 consent |
| A03-1 | A03 | — (accuracy) | Spec overstates Zod as a system-wide control; it covers 3 files | corrected in this document |
| A08-1 | A08 | — (accuracy) | 27 migrations modified pre-2026-03-24 | disclosed as dated exception |

**No finding in this register was fixed by this assessment.** Each is reported
as found, per CLAUDE.md §9.
