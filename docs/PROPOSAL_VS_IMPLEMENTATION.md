# Proposal vs. implementation — the deviation register

**Thai version: [`PROPOSAL_VS_IMPLEMENTATION.th.md`](./PROPOSAL_VS_IMPLEMENTATION.th.md).**
Same document, two languages. **English is canonical for anything a committee
reads; Thai is the founder's working copy. Edit one, edit the other in the same
commit.**

**Source of truth for "what the proposal says":** `docs/proposal/Prem_ProposVer.2.pdf`
(*Final Year Project Proposal — Buzzly: A Centralized Hub for Digital Marketing
Intelligence*, Pachara Danthanin, 66313319, Semester 2/2025, Naresuan
University). **Every row below cites a page and section**; page numbers are the
printed ones, which match the PDF's own page count.

**Source of truth for "what was built":** this repository at `29a88bb`. Every
row was **verified against the code, not from memory** — the commands are in the
appendix.

## Why this document exists

A proposal is a plan written before the work. Eight months of building always
departs from it. The departures are not failures — **an undocumented departure
is**, because a committee member who notices one the author did not disclose
must then wonder what else went unsaid. This register exists so that every
departure is on the record, with its reason, before anyone asks.

### How to use it when writing the thesis

1. Chapter 1 and Chapter 3 are largely *transcribed* from the proposal. **Do not
   transcribe a sentence that this register marks as changed** — rewrite it to
   what was built and add the dated note.
2. Chapter 5 (Discussion/Limitations) takes the rows marked **Scope narrowed**
   and **Deferred** more or less directly.
3. **Never write that the proposal said something it did not.** Where a
   threshold or claim originated with us rather than with §1.3, that is stated
   in `docs/KPI_SPEC.md` and must stay stated.

### Legend

| Type | Meaning |
|---|---|
| **Substituted** | the same job is done by a different tool or mechanism |
| **Scope narrowed** | something planned was not built, or was built smaller |
| **Scope expanded** | something was built that the proposal did not plan |
| **Contingency invoked** | the proposal's own declared fallback was triggered |
| **Proposal inconsistent** | the proposal contradicts itself; the implementation follows one side |
| **Unverified claim** | the proposal asserts a property nobody has checked against the build |
| **Honoured** | listed because a reader will look for it and should find it confirmed |
| **Build moved after measurement** | the KPI was measured as planned, but the UI it measured has since changed |

---

## §1 The register

| # | Area | The proposal says (page · §) | What was built | Type | Why |
|---|---|---|---|---|---|
| **D-1** | **Target user** | "Digital marketers, campaign managers, **and enterprise organizations**" (p.3 · §1.3) | Thai D2C solo/lean merchants, ฿3K–50K/month ad spend, selling on Shopee and advertising on Meta + TikTok. `BUZZLY-CONTEXT.md` states **"Do not design for enterprises"** | **Scope narrowed** | The product found its wedge — True Net Profit after Shopee's dynamic fees — which only exists for a seller who pays those fees. An enterprise marketer does not have this problem |
| **D-2** | **Metric scope** | Unified Data Dictionary "strictly bounded to five foundational KPIs: Impressions, Clicks, CTR, CPC, and Ad Spend" (p.3–4 · §1.3, MVP scope) | Those five **are implemented and are exactly what KPI-1 reconciles against Meta**. On top of them: order revenue, Shopee platform fees and per-SKU COGS, feeding True Net Profit | **Scope expanded** | The five were the MVP floor and were met. The wedge needs revenue and cost as well, or the platform reports spend without profit |
| **D-3** | **Ad platforms** | "Meta Graph API, Google Ads API" (p.13 · §3.4.1; also p.10 · §3.1) | **Meta**: real OAuth 2.0, live rows in `ad_insights` (`data_source='meta_live'`). **TikTok and Shopee**: through file ingestion, not API. **Google Ads: not implemented** | **Scope narrowed** + **expanded** | The persona's channel stack is Shopee + Meta + TikTok. Google Ads is not where this merchant spends. Shopee has no ads API available to the project |
| **D-4** | **Synchronisation model** | §1.3 lists "**Scheduled** data synchronization via third-party advertising APIs" (p.3); §3.4.2 says the platform is "event-driven, **restricting data synchronization to explicit client-side triggers**" (p.15), and §3.4.3 titles the architecture "On-Demand" (p.16) | **On-demand only.** A user presses sync; an Edge Function fetches and normalises. No scheduler runs an ad sync | **Proposal inconsistent** | The proposal contradicts itself between §1.3 and §3.4. The implementation follows §3.4, which is the section that actually specifies the mechanism. **Chapter 3 must say this out loud rather than silently pick a side** |
| **D-5** | **Ingestion pipeline** | Airflow DAGs, "Python-based tasks utilizing the **Pandas** library", insertion "via **Psycopg2**", client subscribes to DLQ telemetry over **Supabase Realtime WebSockets** (p.19 · §3.4.6) | Airflow **is built** (`airflow/`, DAG `buzzly_import_pipeline`, Docker-pinned) and is the measured research artifact. But: cleaning and validation are **hand-written stdlib Python, not Pandas**; the DAG writes through **PostgREST, not psycopg2**; the UI **polls** job status through React Query instead of subscribing over Realtime | **Substituted** (three mechanisms) | Pandas was dropped because the validator had to be unit-testable without Airflow or a network, and a silent `errors="coerce"` inside Pandas is exactly the class of bug the measurement exists to catch. psycopg2 was dropped because the direct Postgres connection is IPv6-only and unreachable from this machine. Polling was kept because a job's progress is written by a server-side task and read once per second at most — Realtime is used elsewhere in the app (loyalty, social inbox, notifications) |
| **D-6** | **Client-side pre-validation** | "a synchronous client-side pre-validation layer within the React.js frontend, executing **heuristic schema checks to enforce header integrity and primitive data type constraints**" (p.19 · §3.4.6) | The browser checks **extension, empty file and size only** (`validateImportFile`, `src/hooks/useImportJobs.tsx:158`). **All header, schema, type and row validation happens in Python**, server-side | **Substituted** | A locked decision of the DLQ sprint: the Python validator is the *measured* artifact behind KPI-2/KPI-3 (100% cell accuracy, stdlib-only, unit-tested). Duplicating it in the browser would create two validators that can disagree, and the browser's copy would be the one no KPI measures |
| **D-7** | **Contingency ingestion** | §3.5 declares a fallback: if Airflow/Pandas/Edge Functions hit "unresolvable integration delays", pivot to a **"Thin-Backend" model** — pre-validated payloads routed "directly from the React.js client to PostgreSQL via simplified Remote Procedure Calls (RPCs)" (p.20) | **Effectively what runs.** The atomic ingestion path KPI-2/KPI-3 measure is **PostgREST staging + one `promote_batch` RPC** with all-or-nothing semantics. The `airflow-trigger` Edge Function is **not deployed to production** (`postdeploy-verify` reports it as missing), so on the deployed site nothing picks a staged file up | **Contingency invoked** | ⭐ **The proposal predicted this exact fallback and this is the strongest thing in the register**: a risk was declared in advance, it materialised, and the declared mitigation was taken. Chapter 3 should present it as the risk plan working, not as a shortfall |
| **D-8** | **Backend architecture** | "Instead of developing a traditional server-side backend (e.g., Node.js with Express), this project adopts a Backend-as-a-Service architecture" (p.7 · §2.3) | Mostly true — the browser reads Supabase directly. **But a local Express service (`mock-api`, port 3001) exists** for `/api/connect`, `/api/meta/sync` and `/validate-key`, and is **deliberately never deployed** | **Scope expanded**, then **deliberately not deployed** | It holds `META_ACCESS_TOKEN`. Deploying it would put a live credential on a third-party host for no measurement gain. Consequence, already recorded in `KPI_SPEC.md`: the connect/sync write path is driven by the researcher, never by a study participant |
| **D-9** | **Development toolchain** | **Antigravity** as the AI IDE (p.11 · §3.2.2); **GitHub Actions** for CI/CD (p.11); **Lovable** for AI-assisted design (p.11, p.17 · §3.4.4) | **Claude Code** replaced Antigravity as the AI development environment. **No GitHub Actions exist** (`.github/workflows` is absent) — deployment is Vercel's Git integration, and tests/typecheck/build run locally before each push. **Lovable was used** for the initial UI and `lovable-tagger` is still a dependency | **Substituted** · **Scope narrowed** | Tool choice, not a design change. The CI/CD gap is real and belongs in Chapter 5 limitations: **"automated" is claimed on p.11 and the automation is a person running the commands** |
| **D-10** | **Infrastructure tier** | "strictly optimized to operate within cloud-native **Free/Hobby tiers** during the 8-month prototyping phase" (p.11–12 · §3.2.2) | **Honoured.** Supabase free tier, Vercel hobby | **Honoured** — with a consequence | ⭐ **This constraint is now the leading suspect behind the two failing KPIs.** See §2 |
| **D-11** | **Data model size** | ER model of ~10 entities across three DDD bounded contexts — Identity, API Integration, Unified Analytics (p.18 · §3.4.5) | **131 tables across 244 migrations.** Beyond the ER figure: loyalty tiers/points/rewards/redemptions, subscriptions and billing, a social planner and inbox, three employee portals (dev/support/owner), feedback, audit logging | **Scope expanded** | Partly anticipated — **the use-case diagram on p.14 already shows Support, Dev and Owner actors and "Redeem Rewards"**, so the actors were planned even though the ER figure did not model them. Chapter 3 should carry an updated ER figure and say the p.18 one is the initial design |
| **D-12** | **Normalisation claim** | "strictly normalized to the **Third Normal Form (3NF)**" (p.18 · §3.4.5) | **Not verified against the 131-table schema by anyone** | **Unverified claim** | Either verify it on the core analytics tables and say which ones were checked, or soften the sentence. **Do not transcribe "strictly 3NF" into the thesis on the strength of the proposal alone** |
| **D-13** | **PII handling** | "systematic **anonymization of Personally Identifiable Information (PII) prior to database insertion**"; Privacy by Design; GDPR/PDPA (p.9 · §2.5) | **Partially honoured, and one item was actively fixed:** audit logging used to write a client-reported IP address on every event; it now writes `null`, with the reasoning recorded at `src/lib/auditLogger.ts:78-101`. **Still true:** customer email and full name are stored unanonymised (authentication requires them), and **the app ships no privacy notice** | **Scope narrowed** — honest gap | Anonymising the identity a login is *for* is not possible. The gap to disclose in Chapter 5 is the missing privacy notice, not the stored email |
| **D-14** | **Evaluation framework** | Lighthouse, k6, Data Consistency Checks, SUS (p.2 · Abstract). Numeric targets: Lighthouse ≥ 80, 50 concurrent users, SUS ≥ 68 (p.4 · §1.3) | All four run, **plus an OWASP Top 10 assessment added by the advisor** (KPI-7). The three numbers above are used exactly as written | **Scope expanded** | ⚠️ **The proposal states no number for data consistency, for p95 latency, or for error rate.** KPI-1's MAPE ≤ 0.5%, KPI-5's p95 < 2 s and error < 1%, and KPI-2/3's 100% come from the DLQ sprint brief and from this project's own operationalisation. `docs/KPI_SPEC.md` already discloses this and **that disclosure must survive into the thesis** |
| **D-15** | **Schedule** | Table 3.1 (p.12): testing and benchmarking Aug–Sept, final report Oct | On schedule — KPI measurement ran 2026-08-13 → 2026-09-08. **But KPI-4 and KPI-5 fail**, and the spec requires remediation to be a separate dated activity, which pushes optimisation work into the reporting window | **Honoured**, with pressure | Worth a sentence in Chapter 5 on what the timeline did and did not allow |
| **D-16** | **KPI-6 measured build** *(added 2026-10-07)* | SUS evaluation of the platform, threshold ≥ 68 (p.2 · Abstract; p.4 · §1.3) | The 11 sessions (2026-09-11) ran on `app_commit` `4e039db`, whose `/dashboard` showed a source-coverage line under the header — row count, covered range, and a warning not to compare sources. It was the most direct on-screen answer to T5 ("ข้อมูลในระบบครอบคลุมช่วงเวลาไหน", `docs/KPI_SPEC.md:459`). **The line was removed after the study** (`f67bdc9`, `54d5108`, `c04bbb9`, 2026-09-27); the covered range is now only in the date picker | **Build moved after measurement** | A UI change after the study, not a protocol deviation. **Do not pair the KPI-6 result with a screenshot of a build after 2026-09-27**, and do not retake screenshots for the KPI-6 chapter |

---

## §2 The deviations that change a number a KPI reports

Everything above matters for honesty. **These three change a measurement**, so
they must appear beside the results, not only in a scope section.

### D-10 · The free-tier constraint is the leading suspect behind KPI-4 and KPI-5

`docs/KPI_FAILURE_ANALYSIS.md` establishes that on `/dashboard` every front-end
metric is at full marks (TBT 30/30, CLS 25/25, FCP 10/10) and the entire deficit
is "data reaches the screen late", and that under 50 concurrent users **every
database-backed step hits the 60 s timeout ceiling while the one step that
avoids the database never fails**.

**The proposal committed the project to free/hobby tiers on p.11–12.** That has
two consequences the thesis must state:

1. **The failure is partly a consequence of a declared design constraint**, not
   an accident. That is a much stronger sentence than "it was slow", and it is
   true and citable.
2. **Remedy A in the failure analysis — raising the database tier — would depart
   from that constraint.** If it is taken, it is a deviation and must be
   recorded here as one, with the before/after measured on both sides.

### D-7 · The measured ingestion path is the proposal's contingency, not its main path

KPI-2 (20/20) and KPI-3 (12/12) are measured against **PostgREST staging + the
`promote_batch` RPC**, which is the §3.5 "Thin-Backend" fallback. A reader who
assumes those results validate the Airflow architecture on p.19 would be
mistaken. **Airflow is built and is exercised by the local test suite; it is not
deployed, and it is not what the two passing ingestion KPIs measure.**

### D-14 · Three of the seven thresholds are ours, not the proposal's

Already disclosed in `docs/KPI_SPEC.md` and repeated here because it is the
easiest thing in the whole project to state carelessly in a defence answer:
**Lighthouse ≥ 80, 50 concurrent users and SUS ≥ 68 are the proposal's. The
0.5% MAPE, the 2 s p95, the 1% error rate and the 100% ingestion figures are
ours.**

---

## §3 What each chapter has to change

| Chapter | Rows that touch it | The edit |
|---|---|---|
| **1 · Introduction** | D-1, D-2, D-3 | Rewrite the scope paragraph to the D2C merchant persona and the Shopee/Meta/TikTok stack. Keep the five UDD metrics — they were met — and add revenue/fees/COGS as the layer the wedge needs |
| **2 · Literature** | D-13 | Fine as written. The §2.5 privacy paragraph now needs a sentence saying which parts were implemented |
| **3 · Methodology** | D-4, D-5, D-6, D-7, D-8, D-9, D-11, D-12 | The largest set of edits. New ER figure; state the §1.3-vs-§3.4 inconsistency and which side was implemented; say plainly that the §3.5 contingency was invoked and why; correct Pandas → stdlib Python, psycopg2 → PostgREST, Realtime → polling, Antigravity → Claude Code; drop or verify "strictly 3NF" |
| **4 · Results** | D-14, D-10, D-16 | Every threshold labelled with its origin. KPI-4/KPI-5 reported as failures with the free-tier constraint named as a bounding condition. KPI-6 reported against the build it measured (`4e039db`) |
| **5 · Discussion** | D-1, D-3, D-9, D-10, D-12, D-13, D-15 | Limitations: no Google Ads leg, no CI/CD automation, free-tier ceiling, unverified normalisation claim, no privacy notice, single-tenant load fixture |

---

## §4 Handoff — for the session that writes the book

- **This register is only valid at `29a88bb`.** Re-verify any row before quoting
  it if the code has moved; the appendix says how each was checked.
- **Add a row rather than editing a fact.** If a later decision changes one of
  these (for example, taking Remedy A and leaving the free tier), append it with
  its own date. The value of this file is that it shows what was true when.
- **Do not "fix" a deviation by editing the proposal.** The proposal is the
  historical record of the plan. The thesis is where the difference is explained.
- **Both language versions change together, in one commit.**
- Related: `docs/KPI_FAILURE_ANALYSIS.md` (why KPI-4/5 fail and what would fix
  them) · `docs/KPI_SPEC.md` (the pre-registered thresholds — **never edited**) ·
  `BUZZLY-CONTEXT.md` (the canonical product definition, which wins over
  `CLAUDE.md` on any product conflict).

---

## Appendix · How each row was verified

| Row | Check |
|---|---|
| D-1 | `BUZZLY-CONTEXT.md` §3 and §"non-negotiables" line 134 |
| D-2 | `IMPORT_PLATFORMS` in `src/hooks/useImportJobs.tsx` (shopee_income, cogs); KPI-1 metric list in `tests/reconcile_lib.py` |
| D-3 | `grep -rli "google.ads" src/ supabase/functions/` → only an API-key label and a test fixture; `supabase/functions/meta-oauth`, `meta-sync` exist |
| D-4 | `grep -rln "pg_cron\|cron.schedule" supabase/migrations/` → cron exists for campaigns/tiers/notifications, none for ad sync |
| D-5 | `airflow/dags/buzzly_common/supabase.py` (PostgREST client) · `airflow/Dockerfile` (openpyxl added; no Pandas import anywhere in `dags/`) · `refetchInterval` in `useImportJobs.tsx:227` |
| D-6 | `validateImportFile`, `src/hooks/useImportJobs.tsx:158-171` |
| D-7 | `supabase/migrations/20260805150000_ingestion_dlq_and_atomic_promote.sql` · `node scripts/postdeploy-verify.mjs` → `WARN edge function airflow-trigger NOT DEPLOYED` |
| D-8 | `mock-api/` exists; `docs/KPI_SPEC.md` § "Deployment prerequisites" records the decision |
| D-9 | `ls .github/workflows` → absent; `lovable-tagger` in `package.json` |
| D-10 | `evidence/kpi5-k6/4c13722/summary.md` names the free-tier database |
| D-11 | 131 distinct `CREATE TABLE` names across 244 files in `supabase/migrations/` |
| D-12 | No verification exists — that is the finding |
| D-13 | `src/lib/auditLogger.ts:78-101` |
| D-14 | `docs/KPI_SPEC.md` § "Threshold provenance"; proposal p.2 Abstract and p.4 §1.3 |
| D-15 | Dates in `evidence/*/meta.json` against Table 3.1 on p.12 |
| D-16 | `app_commit` in `evidence/kpi6-sus/summary.md` · `git show 4e039db:src/pages/Dashboard.tsx \| grep SourceCoverageNote` → present · same grep at `c04bbb9` → absent |
