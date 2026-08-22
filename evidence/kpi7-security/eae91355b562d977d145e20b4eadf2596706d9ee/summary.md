# KPI-7 — remediation run (the "after"), 2026-08-22

**Commit:** `eae91355b562d977d145e20b4eadf2596706d9ee`
**`spec_commit`:** `da02849…` — unchanged. **No threshold moved.**
**The "before":** `evidence/kpi7-security/da02849…/`, which is **not edited by
this run** and continues to report its FAIL.

This is the dated remediation that `docs/KPI_SPEC.md` pre-registers for a
Critical finding: *"report, upgrade if a fixed version exists, re-run"*, with
both runs reported side by side.

## Criterion 3 — before vs after

| | Before (`da02849`) | After (`eae9135`) |
|---|---|---|
| **Critical** | **1** | **0** |
| High | 13 | 7 |
| Moderate | 4 | 1 |
| Total findings | 18 | 8 |
| Production tree | 365 packages | **188 packages** |
| Lockfile `sha256` | `b923ea58…` | `a2679b7f…` |
| **Verdict on criterion 3** | ❌ **FAIL** | ✅ **PASS** |

## Criterion 4 — repetition

Two runs on this commit and lockfile agree on **totals, package set and
per-package severity**. (The ZAP half of criterion 4 is still not run.)

## What each change accounted for

Measured stepwise rather than as one lump, so each effect is attributable:

| Step | Change | Findings after | Prod tree |
|---|---|---|---|
| — | before | 18 | 365 |
| A | `jspdf` 4.2.0 → **4.2.1** | 17 (**critical 1 → 0**) | 365 |
| B | `tailwindcss-animate` → `devDependencies` | 10 | 260 |
| C | remove `@react-three/drei`, `@react-three/fiber`, `three` | **8** | **188** |

Step B alone cleared seven findings — `postcss`, `nanoid`, `glob`, `minimatch`,
`picomatch`, `brace-expansion`, `yaml` — none of which ever reached a browser.
They were in the audited production tree only because a build-time Tailwind
plugin sat in `dependencies`. `tailwind.config.ts:114` is its sole consumer.

Step C removed three packages that **nothing imports**: zero grep hits across
`src/`, `mock-api/`, `e2e/`, `scripts/` and the Vite/Tailwind configs, and
absent from every chunk in the sourcemap survey.

## The eight that remain, and why they are accepted for now

Bundle reachability re-verified at this commit (`a06-bundle-reachability.json`,
1,427 modules): `@react-three/drei` and `three` are now gone from the tree
entirely, and `ws` remains **out** of the browser bundle.

| Package | Severity | In bundle | Treatment |
|---|---|---|---|
| `xlsx` | high | **yes** | **`fixAvailable: false`** — no fixed version exists on npm. Used by `src/lib/reportExcel.ts` for merchant report export. Exposure: prototype pollution and ReDoS, reached only by parsing a file. Compensating control: the app **writes** xlsx, it does not parse untrusted workbooks in the browser; merchant uploads are parsed by the Python ingestion pipeline, not by this library. **Documented exposure, no fix available.** |
| `react-router` · `react-router-dom` · `@remix-run/router` | high | yes | Open-redirect class. Fix requires a **major** upgrade (v6 → v7) touching every route in `App.tsx`. Deferred deliberately: a router migration days before a measurement window is a larger risk than the finding. |
| `lodash` · `d3-color` | high | yes | Transitive via `recharts` / `react-simple-maps`; ReDoS and prototype-pollution classes, reached only through attacker-controlled input to charting internals, which this app does not expose. |
| `dompurify` | moderate | yes | Transitive via `jspdf`. Our PDF path rasterises our own DOM (`html2canvas`) and never sanitises untrusted HTML. |
| `ws` | high | **no** | Not in the browser bundle — `@supabase/realtime-js` uses the native WebSocket. Present in the tree only as a Node-side dependency. |

**Criterion 3 gates on Critical only.** Per the spec, High and Moderate are
"recorded, analysed, and each given either a remediation plan or a written
justification for acceptance" — which is what the table above is.

## Still outstanding for KPI-7

| # | Criterion | State |
|---|---|---|
| 1 | Matrix 10/10 | ✅ met at `da02849…/matrix.md`; A01 still only partially verified |
| 2 | ZAP 0 High/Critical | ⬜ blocked — no production deployment |
| 3 | 0 Critical | ✅ **now PASS** |
| 4 | Both scans twice, agreeing | ⚪ npm-audit half met twice over; ZAP half outstanding |

**A01's behavioural probe is still unrun** — the Supabase project host was still
NXDOMAIN when this run was made. `scripts/kpi7-anon-probe.mjs` is ready.

## Note for the chapter

Report **both** runs. A Critical found, dated, fixed and re-measured is stronger
evidence that the assessment was real than a clean first scan would have been —
the same argument already made for KPI-1's coverage-gate refinement. The "before"
run is never deleted.
