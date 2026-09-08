# KPI-7 — Layer 2 measured — **criteria 2, 3 and 4 MET; criterion 1 carried forward, partially re-verified**

**Measured:** 2026-09-08 ICT · **commit under test:** `29a88bb`
**Spec:** `docs/KPI_SPEC.md` § KPI-7, pre-registered as `da02849`
**Site:** https://buzzly-dev.vercel.app · bundle `/assets/index-CfQNKCC9.js`
**ZAP:** `ghcr.io/zaproxy/zaproxy@sha256:781a2bd…5081ef` (pinned by digest), baseline
+ AJAX spider, **passive only** · **npm audit:** `--omit=dev`, lockfile
`sha256 a2679b7f…` · both scans **run twice**

This closes the half of KPI-7 that was blocked on a deployment. The interim
verdict at `da02849` recorded criterion 2 as **NOT RUN — blocked, not skipped**.
It has now been run.

## Against the four pre-registered criteria

| # | Criterion | Verdict | Basis |
|---|---|---|---|
| 1 | Applicability matrix answers **10/10** | 🟡 **carried forward** | Met at `da02849` (`matrix.md`). Two rows were re-verified today (A05, A06); the other eight are **not re-verified at this commit** and are cited as of the earlier assessment. See "What criterion 1 does and does not claim" below |
| 2 | ZAP baseline: **0 High, 0 Critical** | ✅ **MET** | **0 High, 0 Critical in both runs.** 3 Medium, 2 Low, 4 Informational — each analysed below |
| 3 | `npm audit --omit=dev`: **0 Critical** | ✅ **MET** | **0 Critical.** 7 High, 2 Moderate over 188 production packages — each analysed below |
| 4 | Both scans run twice, results agree | ✅ **MET** | ZAP: the alert set is **identical** across runs — same 9 alerts, same plugin ids, same risk levels, same 3/2/4 split. npm audit: byte-identical totals on the same lockfile. Instance counts differ and that is explained below rather than hidden |

## Criterion 4 — where the two runs differ, and why that is not a disagreement

The two ZAP runs raise exactly the same alerts. What differs is **how many URLs
each alert was seen on**:

| Alert | run 1 | run 2 |
|---|---|---|
| Cross-Domain Misconfiguration | ×5 | ×4 |
| Strict-Transport-Security Header Not Set | ×5 | ×3 |
| Re-examine Cache-control Directives | ×4 | ×2 |

The AJAX spider drives a real browser against a client-routed SPA, so each crawl
reaches a slightly different set of URLs and a different mix of cached versus
network responses. **The finding set — which is what the criterion is about — is
stable.** Reporting the instance counts as identical would have required not
looking.

## The ZAP findings, one at a time

**Nothing here is High or Critical.** The spec requires each Medium/Low/Info to
get either a remediation plan or a written justification for acceptance.

### Medium

**1 · `CSP: Wildcard Directive` [10055] ×3 — accepted, with the reason**

The policy contains `img-src 'self' data: blob: https:`. The `https:` wildcard is
deliberate: the social features render images served from platform CDNs whose
hostnames are not known ahead of time. **Accepted.** Tightening it would require
enumerating every platform CDN and would break silently whenever a platform
changes host. The narrower directives — `script-src 'self'`, `object-src 'none'`,
`base-uri 'self'`, `frame-ancestors 'none'` — carry the actual protection.

**2 · `CSP: style-src unsafe-inline` [10055] ×3 — accepted, and pre-declared**

`style-src 'unsafe-inline'` is required because Radix UI and Recharts write
inline `style` attributes at runtime. **This exception was declared in
`docs/KPI_SPEC.md` § KPI-7 A05 before the measurement**, not discovered by it.

**3 · `Cross-Domain Misconfiguration` [10098] ×5 — accepted, with the reason**

Vercel serves `Access-Control-Allow-Origin: *` on public static responses. Every
response it appears on is public: the SPA shell, the CSS bundle, `robots.txt`,
`sitemap.xml`. **No user data is served from this origin at all** — application
data comes from Supabase, under its own CORS rules and RLS. A wildcard on public
static files exposes nothing that is not already public. **Accepted**; the
control is *inherited* from Vercel's static serving, not ours.

### Low

**4 · `Strict-Transport-Security Header Not Set` [10035] — false positive, and proven so**

ZAP raises it on five `/assets/*` responses. **The header is present.** Verified
directly at measurement time:

```
$ curl -sS -D- -o /dev/null https://buzzly-dev.vercel.app/assets/index-CfQNKCC9.js
strict-transport-security: max-age=31536000; includeSubDomains
content-security-policy: default-src 'self'; script-src 'self'; …
x-frame-options: DENY
```

ZAP flags the same URLs under `Retrieved from Cache` [10050], and the instance
count for both alerts moves between runs. The passive scanner is evaluating
browser-cached responses, which do not carry the origin's headers.
**Classified as a false positive with the verification recorded. It stays in the
raw report**; the raw report is the evidence, this file is the analysis.
*Listed here because ZAP scores it Low — but it is the alert most likely to be
misread by a reader skimming the raw report, so it gets the longest treatment.*

**5 · `Cross-Origin-Embedder-Policy Header Missing` [90004] ×4 — accepted**

COOP is set (`same-origin`); COEP is not. COEP exists to enable cross-origin
isolation for `SharedArrayBuffer`, which this application does not use, and
`require-corp` would break the cross-origin images that `img-src https:` exists
to allow. **Accepted, with the trade-off stated.**

### Informational

`Modern Web Application` [10109] (notes the target is an SPA), `Re-examine
Cache-control Directives` [10015], `Retrieved from Cache` [10050] and `Storable
but Non-Cacheable Content` [10049]. **Recorded, no action.** The cache alerts
concern public static assets; nothing user-specific is served from this origin.

## The `npm audit` findings

**0 Critical — criterion 3 is met.** 7 High and 2 Moderate remain over 188
production packages.

| Severity | Package | Fix available | Treatment |
|---|---|---|---|
| High | `xlsx` (SheetJS) — prototype pollution, ReDoS | **no** | The only finding with no upstream fix. It parses **files the merchant uploads themselves**, in their own browser, and the parse result is written only to their own tenant. Compensating controls: server-side Python re-validates every row before anything is stored, and RLS bounds the blast radius to the uploader's own workspace. **Documented exposure, no fix exists** — the treatment the spec pre-registers for exactly this case |
| High | `react-router`, `react-router-dom`, `@remix-run/router` — open redirect / XSS via untrusted paths | yes | Upgrade candidate. **Not taken in this session**: a router major-version bump touches every route in the app and is a code change requiring approval, not something a measurement performs on its own |
| High | `lodash` — code injection via `_.template` | yes | The app does not call `_.template`; reachability not yet proven at bundle level. Upgrade is low-risk and is the recommended next step |
| High | `ws` — memory-exhaustion DoS, uninitialised memory | yes | Transitive, via the Supabase realtime client. Fixed by a dependency bump |
| High | `d3-color` — ReDoS | yes | Transitive via Recharts |
| Moderate | `dompurify`, `fflate` | yes | Transitive; bump with the others |

**A methodological note worth keeping.** The **same lockfile** (`a2679b7f…`)
reported 8 findings on 2026-08-22 and reports **9 today**, because an advisory
was published in between. **`npm audit` is not a pure function of the lockfile;
it is a function of the lockfile and the date.** Any re-run of this KPI must
record both, which is why `meta.json` carries the lockfile hash and the
timestamp.

## What criterion 1 does and does not claim

The applicability matrix was completed and met 10/10 at `da02849`
(`evidence/kpi7-security/da02849…/matrix.md`). **It is not re-verified row by
row at this commit, and this file does not claim it is.**

| Row | Status at `29a88bb` |
|---|---|
| A05 Security Misconfiguration | ✅ **re-verified today** — all seven headers confirmed live by `curl` on both an HTML route and a hashed asset; ZAP found no High/Critical. ⚠️ **The matrix's declared CSP exception for `api.ipify.org` is now stale**: the audit-log IP fetch was removed (`src/lib/auditLogger.ts:78-101`) and the host is no longer in the policy. The matrix should be updated to record the exception as withdrawn |
| A06 Vulnerable Components | ✅ **re-verified today** — 188 prod packages, 0 Critical, table above |
| A01, A02, A03, A04, A07, A08, A09, A10 | 🟡 **carried forward from `da02849`, not re-checked at this commit.** A01 additionally has its own later evidence directory (`fc86210…`) covering the anon-oracle remediation |

Stating this is the difference between "the matrix was completed" — true — and
"the matrix was re-verified against the delivered build" — which would not be.

## The mandatory smoke check, and its one unresolved item

The spec makes a post-deploy smoke check mandatory **before any scan counts**,
because a CSP strict enough to break the application would otherwise be measured
as a clean scan of a broken page. `scripts/kpi7-smoke.mjs`, evidence in
`smoke/smoke.json`: **10 of 11 checks pass.**

Passing: landing renders · webfonts (Inter, IBM Plex Sans Thai) load · login
succeeds · `/dashboard` renders its Recharts surface · `/imports` renders ·
`/reports` renders · `blob:` URLs, canvas readback and blob workers all work
(the jspdf / html2canvas / xlsx export paths) · **zero CSP violations, in every
run**.

**Unresolved — `realtime wss:// connects`.** A websocket to the Supabase host was
observed in **2 of 5 runs** against this same build. **It is not CSP**: the
policy allows `wss://aokzvknggtccgwbavszj.supabase.co`, zero CSP violations were
recorded in any run, and when the socket does open it is not blocked. The cause
is not established. One candidate, untested: the realtime subscription is
created only after a `profile_customers` read returns, and that read is on the
same saturated data path KPI-4 and KPI-5 measure. **Recorded as an open item,
not explained away.**

Two earlier versions of the smoke script produced wrong answers and are recorded
because each would have been believable:

1. `2b dashboard renders charts` reported **0 charts** — the account's uploaded
   data sits outside the default 30-day window, so the page renders its honest
   "no data in the selected range" state. The check now widens the range and
   waits 8 s (3 s reported "no chart" for a chart that draws).
2. `2c` originally opened a raw WebSocket from the page to test the policy
   directly. It failed with "error event" on a page whose own socket was open —
   **Supabase rejects a realtime socket carrying no apikey**, which has nothing
   to do with CSP. A check that fails for a reason it does not name is worse than
   no check.

## Verdict

**KPI-7 is not yet complete, and what remains is criterion 1's re-verification,
not a scan.** Criteria 2, 3 and 4 are met at this commit. The honest summary
line for the chapter:

> Zero High and zero Critical from a passive scan of the production deployment,
> zero Critical production dependencies, both scans reproduced; the applicability
> matrix stands from the earlier assessment with two of ten rows re-verified
> against the delivered build.

## Files

```
evidence/kpi7-security/29a88bb…/
  meta.json                  environment pin, ZAP digest, lockfile hash, exact commands
  smoke/smoke.json           the mandatory pre-scan checklist, 10/11
  zap/run-1.{json,html,md}   raw, both runs kept
  zap/run-2.{json,html,md}
  npm-audit/run-1.json       raw, both runs kept
  npm-audit/run-2.json
  summary.md                 this file
```
