# KPI-6 — SUS study protocol

**Binding spec:** `docs/KPI_SPEC.md` § "KPI-6 — System Usability Scale".
This file is the *operational* protocol; it may not change a threshold, a task,
an inclusion rule or a measure defined there. Where the two disagree, the spec
wins and this file is wrong.

Record the `spec_commit` (sha of `docs/KPI_SPEC.md` at session time) in every
participant file. That is what makes the pre-registration checkable.

---

## 0. Materials — what to print, and what never leaves the facilitator

| File | Print | Contents |
|---|---|---|
| `session-sheet.html` | **one copy per booked session** (A4, no scaling) | The record for one participant on one page: header, screening + consent ticks, the T1–T5 recording grid, and the 10 SUS items. **Carries no expected answer and no task wording**, because it is handed to the participant for the SUS block. |
| `facilitator-crib.html` | **once**, kept by the facilitator | The read-aloud consent text, the screening questions, the five task prompts verbatim, **the expected answers**, and the facilitator rules. An expected answer on a sheet a participant can see is a leak — that is the only reason these are two files. |
| `form-th.pdf` (from `form-th.html`) | optional, one per participant | The same 10 SUS items as `session-sheet.html` §4, alone on one A4 page at a readable size. **Use one form for every participant** — if you use this one, leave the sheet's §4 blank and staple this behind it. |
| `score.py` | — | `python3 evidence/kpi6-sus/score.py --write` reads every `P<nn>.json`, validates it, and writes `summary.md`. It **refuses to score** rather than produce a number over a blank item, a converted (0–4) value in a raw field, an unconsented session, or a participant marked eligible whose S2 says otherwise. Ineligible participants are never merged into the KPI-6 mean. |

Open either HTML in a browser and print (A4, margins from the page, background
graphics on). Both are one page.

---

## 1. Approval status

| Item | State |
|---|---|
| KPI-6 recruitment | **Advisor approved verbally, 2026-09-05** — recruit from the researcher's own contacts ("หาเพื่อนมาเทส"). See `evidence/approvals/2026-09-05-kpi6-recruitment.md`. **The verbatim wording is still owed** — get it in writing before the first session. |
| KPI-6 fallback (Nielsen / cognitive walkthrough) | **Not needed unless recruitment falls short.** Still pre-approve it in the same written message, because approval obtained after a shortfall is an excuse, not a method. |
| KPI-4 preset stance (desktop gates, mobile informational) | ⬜ **Still unasked.** Independent of KPI-6; do not let it ride along silently. |

---

## 2. Recruitment, and the one thing that decides whether a deviation exists

The spec's inclusion rule is **not** "a friend". It is:

> has personally run paid ads, **or** personally reads ad performance numbers, in
> the last 12 months.

Recruiting from acquaintances is a *sampling frame*, not a relaxation of that
rule. So:

- A contact who **passes S1** → fully inside the pre-registered protocol.
  **No deviation.** Being a friend is irrelevant to eligibility.
- A contact who **fails S1** → outside it. Including them anyway is a real
  deviation from the pre-registered inclusion criteria and must be
  **declared in §8 before the session, not after the score is known**, and
  reported in the methodology chapter as a convenience sample with the
  acquiescence-bias limitation named.

**Do not mix the two silently.** If both kinds are run, report the SUS mean for
the eligible subgroup as the KPI-6 result and the rest separately.

- **n ≥ 5 minimum, 8–12 target.** Below 5 → the spec's under-powered rule applies
  (report raw scores, "indicative only", and run Fallback A).
- Exclusion: anyone who worked on this project, or has seen the app before.
  With friends this is the exclusion that actually bites — ask it, do not assume.

### Screening — ask before booking, record the answers

| | Question (Thai) | Decides |
|---|---|---|
| **S1** | ในช่วง 12 เดือนที่ผ่านมา คุณเคยยิงโฆษณาแบบเสียเงินด้วยตัวเอง หรือเป็นคนที่ดูตัวเลขผลโฆษณาเองไหมครับ | inclusion |
| **S2** | คุณเคยเห็นหรือเคยใช้แอปตัวนี้มาก่อนไหม หรือเคยช่วยงานโปรเจกต์นี้ไหมครับ | exclusion (yes → not eligible) |
| **S3** | ระดับประสบการณ์: เคยยิงเอง / เคยดูตัวเลขแต่ไม่ได้ยิงเอง / ไม่เคยเลย | reported band |

Nothing beyond role and this experience band is retained.

---

## 3. Session shape — ~45 minutes

| Phase | Time | Notes |
|---|---|---|
| Brief + consent | 5 min | §4 |
| Tasks T1–T5 | 25 min | §5 |
| SUS form | 5 min | `session-sheet.html` §4 (wording: `form-th.md`), filled **before** the debrief |
| Debrief | 10 min | open questions, no scoring |

The SUS is administered **before** the debrief. Discussing the product first
moves the ratings.

---

## 4. Consent — read aloud, then have the participant confirm

> ขอบคุณที่สละเวลามาช่วยทดสอบนะครับ วันนี้เราทดสอบ *ตัวระบบ* ไม่ได้ทดสอบคุณ
> ถ้าตรงไหนใช้งานยากหรือหาไม่เจอ นั่นคือข้อมูลที่ผมต้องการพอดี ไม่ใช่ความผิดของคุณเลยครับ
>
> ผมจะให้คุณลองทำ 5 งานบนระบบ แล้วให้ตอบแบบสอบถามสั้น ๆ 10 ข้อ ใช้เวลารวมประมาณ 45 นาที
> ระหว่างทางคุณเลิกเมื่อไหร่ก็ได้ ไม่ต้องบอกเหตุผล
>
> ข้อมูลที่ผมเก็บมีแค่ คำตอบแบบสอบถาม ผลการทำงานแต่ละข้อ และเวลาที่ใช้ กับระดับประสบการณ์
> ด้านโฆษณาของคุณ **ไม่มีการเก็บชื่อ เบอร์ อีเมล หรือข้อมูลส่วนตัวอื่น** ในรายงานคุณจะถูกอ้างถึง
> เป็นรหัส เช่น P01 เท่านั้น
>
> การอัดหน้าจอ/เสียง **ไม่จำเป็น** ถ้าไม่สะดวกก็บอกได้ครับ ทดสอบต่อได้ตามปกติ
>
> ยินยอมเข้าร่วมไหมครับ  ☐ ยินยอม   ☐ ยินยอมและอนุญาตให้อัดหน้าจอ

Record consent (and whether recording was allowed) in the participant file.

---

## 5. Tasks — wording is pre-registered, read it as written

Sign in is done **by the facilitator** on the study account before the
participant sits down. The participant never sees a credential.

| # | Read this, verbatim | Success = | Also record |
|---|---|---|---|
| **T1** | ในช่วง 30 วันล่าสุด ร้านนี้ใช้เงินโฆษณาไปเท่าไร และวันไหนมีการแสดงผลสูงสุด | both values read correctly off the screen, unaided | time, mis-reads |
| **T2** | เปลี่ยนมุมมองให้เห็นเฉพาะข้อมูลจริง แล้วบอกว่าตัวเลขที่เห็นตอนนี้มาจากแหล่งใด | uses the source picker **and** names the source (from the picker or the provenance badge) | time, whether badge or picker carried it |
| **T3** | ตัวเลข ROAS บนหน้านี้เชื่อได้แค่ไหน เพราะอะไร | identifies the `≥` as a lower bound, **or** on a "—" source explains why no figure is given | time, whether the caption was read at all |
| **T4** | ไฟล์ที่เคยอัปโหลดเข้ามา มีแถวที่ระบบไม่รับกี่แถว และเพราะอะไร | finds the failed import on `/imports` and names **≥ 1 correct rejection reason** | time, whether they found the downloadable report |
| **T5** | ข้อมูลในระบบครอบคลุมช่วงเวลาไหน และถ้าอยากดูทั้งหมดต้องทำอย่างไร | states the covered range and reaches the full-range view | time, assists |

### Facilitator rules — declared in advance, 2026-09-05

1. **No leading.** Answer a question with a question: "คุณคิดว่าควรอยู่ตรงไหนครับ"
2. **Assist** = any time the facilitator names a screen, a control, or a value.
   Count it, and the task still counts as a success only if the participant
   completes it after the assist — record `success: true, assists: 1`.
3. **Stopping rule: 5 minutes per task, or when the participant asks to skip.**
   Recorded as `success: false`. Declared here in advance so it is a procedure,
   not a judgement made once a score was visible.
4. Time-on-task = first click after the prompt ends → the moment the success
   criterion is met. Stopwatch, not a guess.
5. Say nothing evaluative between tasks ("ดีมากครับ" moves SUS ratings).

---

## 6. Prerequisites — ⚠️ two are hard blockers today (checked 2026-09-05)

| # | Prerequisite | State on 2026-09-05 |
|---|---|---|
| 1 | Production Vercel URL (the spec forbids localhost) | ⬜ not deployed yet |
| 2 | Study account, read-only, over one seeded workspace | ⬜ not created |
| 3 | **T4 needs a failed import already in the workspace** | 🔴 **BLOCKED** — `import_jobs`, `import_row_errors`, `ingestion_dlq`, `ingestion_batches`, `ingestion_staging` all count **0** (verified with service_role, 2026-09-05; this is L-7 in `docs/HANDOFF_INGESTION_KPI.md`). **T4 is unanswerable until a failed import is seeded into the study workspace.** |
| 4 | **T1 needs data inside the last 30 days** | 🔴 **BLOCKED** — newest `ad_insights.date` is **2026-08-14**; only **41 rows** fall on/after 2026-08-06. A participant opening the 30-day view today sees a near-empty screen and T1 measures nothing. Sync or seed before sessions. |
| 5 | T2/T3 need ≥ 2 data sources with different provenance | ✅ `mock` 608 · `import` 273 · `meta_live` 33 (sample of 1000) |
| 6 | T5 needs a stated coverage range | ✅ 2025-07-10 → 2026-08-14 (moves once #4 is fixed — re-check the expected answer on the day) |

**Do not run a pilot, let alone a session, with #3 or #4 open.** A task whose
data is missing does not measure difficulty; it measures the seed.

### Re-checked 2026-09-09 — all six now met

The 2026-09-05 table above is kept as it was. This is the state on the evening
of 2026-09-09, verified **through the study account's own token**, i.e. through
RLS, not with `service_role`. Full record: `evidence/kpi6-sus/study-environment-2026-09-09.md`.

| # | Prerequisite | State on 2026-09-09 |
|---|---|---|
| 1 | Production URL | ✅ `https://buzzly-dev.vercel.app`, deploy carries HEAD |
| 2 | Study account | ✅ `sus-study@buzzly.test` — **already existed** (created 2026-09-05), `viewer` on the study workspace, active, sees exactly one workspace. Its password was not recorded anywhere, so a known one was set on 2026-09-09; see the caveat below |
| 3 | T4 failed import | ✅ **exactly one** failed import, **7 rows rejected, 7 distinct reasons**, with a downloadable bilingual report. Produced by the real pipeline on 2026-09-09, not seeded by hand |
| 4 | T1 data inside 30 days | ✅ **80 rows** in the window (was 20). Ingested through the real upload path from `study-fixture/sus-study-shopee-ads.csv` |
| 5 | T2/T3 ≥ 2 sources | ✅ `import` 333 · `mock` 82 · `meta_live` 33 |
| 6 | T5 coverage range | ✅ **2025-07-10 → 2026-09-09** (the end moved; it was 2026-08-14 on 09-05) |

**⚠️ T1's expected answer depends on the day the session runs and on the source
filter.** The app resolves its "30d" preset as `today − 30 … today`
(`src/hooks/useDashboardMetrics.tsx:262`), so the window moves. Pre-computed
totals for 09-10 / 09-11 / 09-12 are in
`study-fixture/answer-key.json → t1_expected.by_session_date`. On 2026-09-11 the
expected figure is **฿63,911.54 from `import` alone**; with the source picker on
*all*, the same screen shows **more**, because `mock` and `meta_live` rows also
fall in the window (฿66,929.02 against ฿65,575.26 on 09-09). **Score T1 against
the filter the participant actually had on**, and record which one it was.
The peak-impressions day is **2026-08-27** under every one of these windows, by
a margin of ~36,600 impressions over the next day, so that half of T1 has one
answer whatever happens.

**⚠️ Correction to prerequisite #2's wording: the study account is _not_
read-only, and the protocol should not have claimed it was.** Verified by trying
it: as `viewer` the account **cannot** rename the workspace and **cannot** delete
`ad_insights` (both refused by RLS), but it **can** insert an `import_jobs` row —
the policy is `is_team_member(...) AND uploaded_by = auth.uid()`
(`20260723120000_import_jobs_pipeline.sql:96`), which does not consult the role,
and `src/pages/Imports.tsx` carries no role check either. That is a deliberate
design ("team members can start an import", per the migration's own comment),
not a defect — but it means a participant *could* upload a file if they went
looking for it. **No task asks them to.** The accurate description is "a viewer
account, read-only for everything the tasks touch".

**Facilitator note.** The account's password was set on 2026-09-09 because none
was recorded in the repo or in any session note — the account had been created
and signed in once on 09-05 and then left. If a password was written down
elsewhere, it no longer works; use the one in the handover message and change it
if you prefer.

Run **one pilot session** (not counted, not stored as P01) to time the script
and catch a broken task before spending a real participant on it.

---

## 7. What gets recorded

One file per participant, `P01.json`, `P02.json`, … — shape in
`participant-template.json`. Never store a name, phone, email or workspace of
the participant's own.

Scoring: `form-th.md` §Scoring. Reporting: mean, SD, 95% CI, **every individual
score listed**, the Bangor adjective for the mean, the per-task success/time/
assist table, and `n` stated everywhere the mean appears → `summary.md`.

---

## 8. Deviation log — write the entry *before* the session it applies to

| Date | Participant(s) | Deviation | Reason |
|---|---|---|---|
| — | — | (none yet) | — |

A deviation recorded after the number is known is not a deviation record.
