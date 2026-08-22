# KPI-7 — interim verdict, 2026-08-22

**Commit / `spec_commit`:** `da02849c41acd8c8e8832725481eab6c7067294b`
**This is a partial measurement.** Layer 1 is complete; Layer 2 is half done.
Nothing here is a final KPI-7 verdict, and the incomplete halves are named.

## Against the four pre-registered criteria

| # | Criterion | Verdict | Basis |
|---|---|---|---|
| 1 | Applicability matrix answers **10/10** | ✅ **MET** | `matrix.md` — all ten answered, no `N/A` claimed, every control labelled `ours` or `inherited`. One category (A01) is answered *and* flagged partially verified. |
| 2 | ZAP baseline: 0 High, 0 Critical | ⬜ **NOT RUN** | No production deployment exists. Blocked, not skipped. |
| 3 | `npm audit --omit=dev`: **0 Critical** | ❌ **FAIL** | **1 Critical — `jspdf@4.2.0`.** Plus 13 High, 4 Moderate over a 365-package prod tree. |
| 4 | Both scans run twice, results agree | ⚪ **half met** | npm audit run twice on the same lockfile (`sha256 b923ea58…`): totals, package set and per-package severity **identical**. ZAP half not run. |

## The failure, stated plainly

**KPI-7 criterion 3 fails as pre-registered.** `jspdf@4.2.0` carries two
Critical advisories and it does ship to the browser (chunk
`jspdf.es.min-CvfpKX18.js`, confirmed by sourcemap).

The exposure is narrow — our entire call surface is `new jsPDF()`,
`addImage()`, `output("blob")`, so neither the FreeText-annotation sink nor the
new-window HTML-injection sink is reached. **That narrows the risk and changes
nothing about the verdict**, because the criterion was pre-registered as "0
Critical in production dependencies", not "0 reachable Critical". The failing
run is preserved as the "before".

## What was measured, and how it can be re-run

| Evidence | File | Reproduce with |
|---|---|---|
| Applicability matrix | `matrix.md` | — |
| npm audit, two runs | `npm-audit/run-1.json`, `run-2.json` | `npm audit --omit=dev --json` |
| Bundle reachability | `a06-bundle-reachability.json` | `vite build --sourcemap`, search each `.map`'s `sources` for `node_modules/<pkg>/` |
| Environment pin | `meta.json` | — |

## Blocked, with the reason

1. **ZAP baseline (criterion 2, and half of 4)** — needs the Vercel deployment.
   The security headers in `vercel.json` have **never been served by anything**;
   `vite preview` does not apply them. The post-deploy smoke checklist in
   `docs/KPI_SPEC.md` is mandatory before a scan counts.

2. **A01 behavioural anon probe** — `aokzvknggtccgwbavszj.supabase.co` returned
   **NXDOMAIN** from Cloudflare's public resolver on 2026-08-22 while
   `supabase.co` resolved normally. The Supabase project appears **paused**
   (free tier pauses after ~7 days idle; last recorded activity 2026-08-14).
   The probe script is written and is designed to be non-vacuous — it reads
   every relation as `anon` **and** as `service_role`, reporting `INCONCLUSIVE`
   for any relation both roles find empty (CLAUDE.md §12).

   **This blocks more than A01.** KPI-5 load-tests Supabase, and KPI-4/KPI-6
   read data from it. Restoring the project is a prerequisite for Groups B and C
   as well.

## Recommended next actions, in order

1. **Restore the Supabase project** (founder, dashboard action). Then run the
   A01 anon probe and append its result here.
2. **Decide on the three dependency findings** — they are code changes and were
   deliberately not applied:
   - `npm update jspdf` → 4.2.1, then re-run `npm audit` twice and report
     **before/after as two dated runs**;
   - move `tailwindcss-animate` to `devDependencies` (clears 8 of 18 findings);
   - remove `@react-three/drei` and `three` (imported by nothing).
3. **Fix A05-1** — make the missing `VITE_BACKEND_API_URL` fail closed instead
   of defaulting to `mock-api-sable.vercel.app`.
4. Deploy, run the smoke checklist, then ZAP ×2 and close criteria 2 and 4.
