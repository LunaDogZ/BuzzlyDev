# `docs/` — what is in here

## Thesis and measurement

| File | What it is |
|---|---|
| [`KPI_SPEC.md`](./KPI_SPEC.md) | **The pre-registered specification for KPI-1…KPI-7** (committed as `da02849`, 2026-08-22). Thresholds, procedures, evidence layout, and the provenance of every number. **Read-only. A threshold in here never moves.** |
| [`KPI_FAILURE_ANALYSIS.md`](./KPI_FAILURE_ANALYSIS.md) · [`.th.md`](./KPI_FAILURE_ANALYSIS.th.md) | Why **KPI-4 and KPI-5 fail**: the theory each was designed on, both measurement rounds, the cause analysis, six candidate remedies, and the experiment that would decide between them |
| [`PROPOSAL_VS_IMPLEMENTATION.md`](./PROPOSAL_VS_IMPLEMENTATION.md) · [`.th.md`](./PROPOSAL_VS_IMPLEMENTATION.th.md) | **Fifteen dated deviations** between the approved proposal and what was built, each citing a page of the proposal on one side and a verified file on the other. **Read this before transcribing any proposal sentence into the thesis** |
| [`HANDOFF_INGESTION_KPI.md`](./HANDOFF_INGESTION_KPI.md) | State, decisions and known limitations of the ingestion KPI work (KPI-2 / KPI-3) |
| [`KPI1_EXPORT_INSTRUCTIONS.md`](./KPI1_EXPORT_INSTRUCTIONS.md) | How to produce the Meta Ads Manager export KPI-1 reconciles against |
| [`proposal/`](./proposal/) | The approved proposal PDF — the historical record of the plan. **Never edited to match the build**; the difference is explained in the deviation register |

**Results and raw evidence do not live here.** They live in `evidence/<kpi>/<commit-sha>/`
and, for the ingestion KPIs, in `tests/RESULTS.md` and `tests/evidence/`.

## Internal system documentation

[`system/`](./system/) — feature and schema write-ups produced during development:
customer and dev system overviews (TH), the feature↔database map, the database
glossary, monitor / audit-log / employee-management deep dives, and the
onboarding-flow prompts. **Descriptive, not authoritative** — where one of these
disagrees with the code, the code wins, and where one disagrees with
`BUZZLY-CONTEXT.md` on product direction, that file wins.

## Archive

[`archive/`](./archive/) — artifacts kept for provenance and referenced by
nothing: `tier-management.json`, a data export from the tier work.

---

**Product and engineering context lives at the repository root:**
`BUZZLY-CONTEXT.md` (canonical product definition — wins on any product
conflict) and `CLAUDE.md` (stack, routes, patterns, and the data-safety rules).
