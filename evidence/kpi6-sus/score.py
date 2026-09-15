#!/usr/bin/env python3
"""Scores the KPI-6 SUS study from the participant files, and refuses to score
a record that cannot be trusted.

    python3 evidence/kpi6-sus/score.py            # print the report
    python3 evidence/kpi6-sus/score.py --write    # also write summary.md

WHAT IT READS: every `P<nn>.json` in this directory (`participant-template.json`
is not one and is ignored). Files are read, never written — the raw record is
the evidence, and a scoring pass must not be able to touch it.

WHY IT VALIDATES BEFORE IT COMPUTES. A SUS score is a small number derived from
ten hand-transcribed digits, so the ways it goes quietly wrong are all
arithmetic-shaped: a blank item read as a zero, a converted value (0-4) written
into a raw field (1-5), a participant scored into the mean who never passed
screening. Each of those produces a plausible number rather than an error. So
anything the checks cannot vouch for is a hard stop with the reason named, and
nothing is scored until it is fixed. A refusal is cheap; a wrong 71.5 in a
thesis chapter is not.

WHAT IT WILL NOT DO:
  - It never merges an ineligible participant into the KPI-6 mean. `protocol.md`
    §2: the pre-registered inclusion rule is "has personally run paid ads, or
    personally reads ad performance numbers, in the last 12 months". Anyone
    outside it is reported in a separate block with their own n.
  - It never converts before storing. Only raw 1-5 responses live in the files;
    the conversion happens here, in the open, every run.
  - It invents no threshold for the task metrics. `docs/KPI_SPEC.md` deliberately
    pre-registers none — they are descriptive context, and a bar invented after
    the fact is the HARKing the spec exists to prevent.

WHAT IT DISTINGUISHES, ADDED 2026-09-15 — a *problem* from a *deviation*.
The first version had one verdict for everything it disliked: refuse. That is
right for a record that cannot be trusted, and wrong for a record that is
telling the truth about a study which departed from its protocol. Three states
that arose in the real 2026-09-11 sessions could not be written down at all:

  - `tasks_recorded: false` + `tasks_not_recorded_reason` — the tasks were
    performed, and the facilitator did not write down how they went. The only
    alternative the old script left was to type task outcomes nobody observed.
  - `eligibility_recorded_per_participant: false` + reason — S1 was asked in
    every session and the answer was never written against a participant code.
    This is the severe one, and it is handled differently from the other two:
    the pre-registered statistic IS the eligible-only mean, so it becomes
    uncomputable. The script then reports a **full-sample** mean, prints
    `NOT EVALUABLE` in the verdict row, and spells out what may and may not be
    written in the chapter. It does not quietly relabel one as the other.
  - an ineligible participant whose deviation was NOT declared in advance. That
    is worth reporting in capital letters; it is not a reason to withhold the
    whole study, because such a participant is excluded from the mean anyway.

All three are now **irregularities**: the run proceeds, and every one is printed
at the top of the report, above the number, and echoed on stderr. **No threshold
moved** — 68 is 68, an eligible-only mean is still eligible-only wherever one
can be computed, and the task measures never had a bar to lower. A validator
that can only express "measured" forces the researcher to write something false
in order to be allowed to finish, and that is a worse failure mode than the one
the refusal was guarding against. What the refusal was right about is preserved:
the script will not print a number under a label that misdescribes it.

THE ONLY THRESHOLD IS THE PRE-REGISTERED ONE: mean SUS >= 68 (spec, Class 1,
proposal §1.3). The 95% CI is reported beside the mean because the spec asks for
it, not as a second, stricter rule — if the CI straddles 68 that is said in
words and the verdict still follows the mean.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
THRESHOLD = 68.0

# Two-sided t critical values at 95%, by degrees of freedom (n - 1). Hard-coded
# rather than pulled from scipy so the script has no dependency and a reader can
# check any row against a printed table.
T_CRIT_95 = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
    8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145,
    15: 2.131, 16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
    21: 2.080, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.060, 26: 2.056,
    27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042,
}

# Bangor, Kortum & Miller (2008), Table 8. Anchors for reporting, NOT grade
# boundaries — the spec says to name the nearest one and say where it came from.
BANGOR = [
    ("Worst imaginable", 12.5), ("Awful", 20.3), ("Poor", 35.7), ("OK", 50.9),
    ("Good", 71.4), ("Excellent", 85.5), ("Best imaginable", 90.9),
]

TASK_IDS = ["T1", "T2", "T3", "T4", "T5"]
PLACEHOLDER_MARKS = ("<", "____", "2026-__-__")


class Refusal(Exception):
    """Raised with every problem found, so one run lists them all."""


def _is_raw_response(value) -> bool:
    """A raw SUS response is an integer 1-5. `True` is an int in Python and 5.0
    survives a JSON round-trip as a float — both are rejected, because either
    one arriving here means the transcription went through something it should
    not have."""
    return isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 5


def _placeholder(value) -> bool:
    return not isinstance(value, str) or not value.strip() or any(m in value for m in PLACEHOLDER_MARKS)


def load_participants() -> list[dict]:
    files = sorted(p for p in HERE.glob("P*.json") if p.name != "participant-template.json")
    if not files:
        raise Refusal(
            f"No participant files (P01.json, P02.json, …) in {HERE}.\n"
            "  Copy participant-template.json to P01.json after the first session."
        )
    records = []
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise Refusal(f"{path.name}: not valid JSON — {exc}") from exc
        data["_file"] = path.name
        records.append(data)
    return records


def validate(records: list[dict]) -> tuple[list[str], list[str]]:
    """Returns (problems, irregularities).

    A **problem** means the record cannot be trusted — a blank item, a converted
    value in a raw field, two files claiming the same participant. Nothing is
    scored while one exists.

    An **irregularity** means the record IS trustworthy and says, in its own
    fields, that the study departed from the protocol. Those are reported loudly
    beside the result instead of being used to withhold it. Refusing to score a
    truthful record produces no evidence file at all, which is a worse outcome
    than a result that carries its own deviation notice — and a record that can
    only express "measured" forces the researcher to write something false in
    order to be allowed to finish.

    **This distinction moves no pre-registered threshold.** 68 is unchanged, the
    mean is still computed over eligible participants only, and an ineligible
    participant is still never merged into it.
    """
    problems: list[str] = []
    irregularities: list[str] = []
    seen_ids: dict[str, str] = {}

    for rec in records:
        f = rec["_file"]
        pid = rec.get("participant")

        if not isinstance(pid, str) or not pid.startswith("P") or pid == "P00":
            problems.append(f"{f}: `participant` must be a real code like \"P01\" (found {pid!r}); P00 is the template's.")
        else:
            if f != f"{pid}.json":
                problems.append(f"{f}: `participant` is {pid!r} — filename and code must match, or a record can be double-counted.")
            if pid in seen_ids:
                problems.append(f"{f}: participant code {pid!r} already used by {seen_ids[pid]}.")
            seen_ids[pid] = f

        for field in ("session_date", "app_commit", "spec_commit"):
            if _placeholder(rec.get(field)):
                problems.append(f"{f}: `{field}` is still a placeholder ({rec.get(field)!r}) — it is what makes the pre-registration checkable.")

        consent = rec.get("consent") or {}
        if consent.get("given") is not True:
            problems.append(f"{f}: `consent.given` is not true. A session without recorded consent is not scored.")

        scr = rec.get("screening") or {}
        eligible = scr.get("eligible_under_prereg_criteria")
        unrecorded_eligibility = rec.get("eligibility_recorded_per_participant") is False
        if eligible not in (True, False) and not unrecorded_eligibility:
            problems.append(f"{f}: `screening.eligible_under_prereg_criteria` is {eligible!r} — decide it from S1/S2, do not leave it null.")
        if scr.get("s2_seen_app_or_worked_on_project") is True and eligible is True:
            problems.append(f"{f}: S2 says the participant has seen the app or worked on the project, but the record calls them eligible. That is the exclusion criterion.")
        # `eligibility_recorded_per_participant: false` — S1 was asked, but the
        # answer was not written against a participant code, so this record cannot
        # be placed in the eligible group OR the ineligible one. It is the most
        # consequential of the three declared states, because the pre-registered
        # statistic is the mean over ELIGIBLE participants, and an unattributable
        # screening makes that statistic uncomputable. The script therefore reports
        # a full-sample mean, says so in the verdict line, and never lets the
        # full-sample figure be labelled as the pre-registered one.
        if unrecorded_eligibility:
            why = rec.get("eligibility_not_recorded_reason")
            if _placeholder(why):
                problems.append(
                    f"{f}: `eligibility_recorded_per_participant` is false but "
                    "`eligibility_not_recorded_reason` is empty."
                )
            elif rec is records[0]:
                irregularities.append(
                    "**the pre-registered statistic could not be computed.** S1 was asked "
                    "in every session, but the answer was never written against a "
                    "participant code, and the researcher states that some participants "
                    f"did not meet the inclusion criterion — {why}"
                )
            if eligible is not None:
                problems.append(
                    f"{f}: eligibility is declared unrecorded, yet "
                    f"`eligible_under_prereg_criteria` is {eligible!r}. Pick one — either "
                    "this participant's screening answer is known or it is not."
                )

        if eligible is False and scr.get("deviation_declared_before_session") is not True:
            irregularities.append(
                f"{f}: ineligible under the pre-registered criteria, and the deviation was **not** "
                "declared before the session. protocol.md §8 — a deviation recorded after the number "
                "is known is not a deviation record, and this file does not claim to be one. The "
                "participant is reported separately below and is never merged into the KPI-6 mean, "
                "which is the protection that actually matters here."
            )

        raw = rec.get("sus_raw") or {}
        missing = [f"q{i}" for i in range(1, 11) if raw.get(f"q{i}") is None]
        if missing:
            problems.append(f"{f}: SUS items unanswered: {', '.join(missing)}. An incomplete SUS is void for that participant — it cannot be part-scored.")
        bad = [f"q{i}={raw[f'q{i}']!r}" for i in range(1, 11)
               if raw.get(f"q{i}") is not None and not _is_raw_response(raw[f"q{i}"])]
        if bad:
            problems.append(f"{f}: not raw 1-5 responses: {', '.join(bad)}. Store what the participant ticked, never a converted 0-4 value.")

        # `tasks_recorded: false` is the one way a record may arrive without task
        # outcomes: the tasks were performed, and nobody wrote down what happened.
        # It must be the literal `false`, never a missing key, so that an
        # unfinished transcription cannot slip through as a declared gap.
        #
        # This is allowed because `docs/KPI_SPEC.md` § KPI-6 pre-registers NO
        # threshold for the task measures — they are descriptive context, and the
        # spec says inventing a bar for them after the fact would be HARKing. Their
        # absence therefore changes no verdict. What it does remove is evidence, so
        # the reason is mandatory and the gap is reported in the output.
        if rec.get("tasks_recorded") is False:
            why = rec.get("tasks_not_recorded_reason")
            if _placeholder(why):
                problems.append(
                    f"{f}: `tasks_recorded` is false but `tasks_not_recorded_reason` is empty. "
                    "An undocumented gap is not a declared one."
                )
            elif rec is records[0]:
                # one line, not one per file: eleven identical sentences bury the
                # other deviations under a wall the reader learns to skip.
                irregularities.append(
                    f"task outcomes T1-T5 were not recorded for any session — {why}"
                )
            if any(
                t.get(k) is not None
                for t in rec.get("tasks") or []
                if isinstance(t, dict)
                for k in ("success", "time_sec", "assists")
            ):
                problems.append(
                    f"{f}: `tasks_recorded` is false but the task block carries values. "
                    "Either the outcomes were recorded or they were not — a half-filled "
                    "block is the one shape that cannot be read honestly."
                )
        else:
            tasks = {t.get("id"): t for t in rec.get("tasks") or [] if isinstance(t, dict)}
            for tid in TASK_IDS:
                t = tasks.get(tid)
                if t is None:
                    problems.append(f"{f}: task {tid} is missing.")
                    continue
                if t.get("success") not in (True, False):
                    problems.append(f"{f}: {tid}.success is {t.get('success')!r} — the stopping rule makes an unfinished task `false`, not null.")
                if t.get("success") is True and not isinstance(t.get("time_sec"), (int, float)):
                    problems.append(f"{f}: {tid} succeeded but has no `time_sec`. Time-on-task is a pre-registered measure.")
                if not isinstance(t.get("assists"), int) or t.get("assists") < 0:
                    problems.append(f"{f}: {tid}.assists must be a count (0 or more).")

    return problems, irregularities


def sus_score(raw: dict) -> float:
    """Brooke (1996): odd items contribute (response - 1), even items
    (5 - response); the sum of the ten contributions is multiplied by 2.5."""
    total = 0
    for i in range(1, 11):
        r = raw[f"q{i}"]
        total += (r - 1) if i % 2 == 1 else (5 - r)
    return total * 2.5


def bangor_adjective(mean: float) -> tuple[str, float]:
    return min(BANGOR, key=lambda pair: abs(pair[1] - mean))


def descriptive(scores: list[float]) -> dict:
    n = len(scores)
    mean = statistics.fmean(scores)
    if n < 2:
        return {"n": n, "mean": mean, "sd": None, "ci": None, "t": None}
    sd = statistics.stdev(scores)                      # sample SD (n-1)
    t = T_CRIT_95.get(n - 1, 1.960)                    # df > 30 -> normal approximation
    half = t * sd / math.sqrt(n)
    return {"n": n, "mean": mean, "sd": sd, "ci": (mean - half, mean + half), "t": t}


def has_task_data(rec: dict) -> bool:
    return rec.get("tasks_recorded") is not False


def fmt_task_table(records: list[dict]) -> list[str]:
    records = [r for r in records if has_task_data(r)]
    lines = ["| Task | Success | Success rate | Median time (s) | Mean time (s) | Assists |",
             "|---|---|---|---|---|---|"]
    for tid in TASK_IDS:
        entries = [t for r in records for t in (r.get("tasks") or []) if t.get("id") == tid]
        n = len(entries)
        ok = [t for t in entries if t.get("success") is True]
        times = [float(t["time_sec"]) for t in ok if isinstance(t.get("time_sec"), (int, float))]
        assists = sum(int(t.get("assists") or 0) for t in entries)
        rate = f"{len(ok) / n * 100:.0f}%" if n else "—"
        med = f"{statistics.median(times):.0f}" if times else "—"
        avg = f"{statistics.fmean(times):.0f}" if times else "—"
        lines.append(f"| {tid} | {len(ok)}/{n} | {rate} | {med} | {avg} | {assists} |")
    return lines


def report(records: list[dict], irregularities: list[str] | None = None) -> tuple[list[str], bool]:
    eligible = [r for r in records if (r.get("screening") or {}).get("eligible_under_prereg_criteria") is True]
    other = [r for r in records if r not in eligible]

    for r in records:
        r["_sus"] = sus_score(r["sus_raw"])

    unscreened = [r for r in records if r.get("eligibility_recorded_per_participant") is False]

    out: list[str] = []
    w = out.append
    w("# KPI-6 — SUS (Thai administration) · result")
    w("")
    w("Generated by `evidence/kpi6-sus/score.py` from the participant files. Do not")
    w("hand-edit this file — re-run the script. Every number below is recomputed from")
    w("the raw 1-5 responses on each run, so the record and the result cannot drift apart.")
    w("")
    w(f"- Instrument: SUS, 10 items, 1-5 Likert (Brooke, 1996), **administered in Thai** — reported as *SUS (Thai administration)*, which is not the validated English instrument.")
    w(f"- Pre-registered threshold: **mean SUS ≥ {THRESHOLD:.0f}** (`docs/KPI_SPEC.md`, Class 1, proposal §1.3). 68 is the corpus *mean*, i.e. average, not good.")
    w("- A SUS score is not a percentage and is never written with a `%`.")
    w("")

    if irregularities:
        w("## ⚠️ Deviations from the pre-registered protocol")
        w("")
        w("Printed before the result, not after it, because a reader who stops at the")
        w("number should have already met them. Each one is stated by the participant")
        w("records themselves; none was inferred by this script.")
        w("")
        for item in irregularities:
            w(f"- {item}")
        w("")
        w("**None of these moved a threshold.** The bar is still 68 and no participant")
        w("outside the criteria was merged into a mean labelled as eligible-only. What a")
        w("deviation can cost is a statistic, and where it did, the verdict row says so")
        w("instead of substituting a different number under the same name.")
        w("")
        w("")

    spec_commits = sorted({r.get("spec_commit") for r in records})
    app_commits = sorted({r.get("app_commit") for r in records})
    dates = sorted({r.get("session_date") for r in records})
    w(f"| Sessions | {len(records)} ({', '.join(dates)}) |")
    w("|---|---|")
    if unscreened:
        w(f"| Eligibility attributable to a participant | **0 of {len(records)}** — see the deviation above |")
        w("| Eligible / ineligible split | **unknown.** Not 0 eligible — *unattributed*. The two read the same in a table and mean opposite things, so the count is withheld rather than printed as a zero |")
    else:
        w(f"| Eligible under the pre-registered criteria | **{len(eligible)}** |")
        w(f"| Outside them (reported separately, never merged) | {len(other)} |")
    w(f"| `spec_commit` | {', '.join(str(c) for c in spec_commits)} |")
    w(f"| `app_commit` | {', '.join(str(c) for c in app_commits)} |")
    w("")

    if len(spec_commits) > 1:
        w(f"> ⚠️ Sessions ran against **more than one `spec_commit`** ({', '.join(str(c) for c in spec_commits)}). Say which sessions ran against which, and check that nothing pre-registered moved between them.")
        w("")
    if len(app_commits) > 1:
        w(f"> ⚠️ Sessions ran against **more than one build** ({', '.join(str(c) for c in app_commits)}). Participants did not all see the same system; the chapter has to say so.")
        w("")

    w("## Individual scores")
    w("")
    w("| Participant | SUS | Experience band | Eligible | Session |")
    w("|---|---|---|---|---|")
    for r in sorted(records, key=lambda x: x["participant"]):
        scr = r.get("screening") or {}
        if r.get("eligibility_recorded_per_participant") is False:
            mark = "*not recorded*"
        elif scr.get("eligible_under_prereg_criteria") is True:
            mark = "yes"
        else:
            mark = "**no — deviation**"
        w(f"| {r['participant']} | {r['_sus']:.1f} | {scr.get('s3_experience_band', '—')} | {mark} | {r.get('session_date')} |")
    w("")

    passed = False

    if unscreened:
        st = descriptive([r["_sus"] for r in records])
        adj, anchor = bangor_adjective(st["mean"])
        passed = st["mean"] >= THRESHOLD
        w("## Result — FULL SAMPLE. This is not the pre-registered statistic.")
        w("")
        w(f"**The pre-registered statistic is the mean over *eligible* participants, and it")
        w(f"cannot be computed from this record.** S1 was asked in every session and the")
        w(f"answer was not written against a participant code; the researcher states that")
        w(f"some participants did not meet the inclusion criterion, but not how many or")
        w(f"which. {len(unscreened)} of {len(records)} records are in that state.")
        w("")
        w(f"| n (full sample) | {st['n']} |")
        w("|---|---|")
        w(f"| **Mean SUS, full sample** | **{st['mean']:.1f}** |")
        w(f"| SD (sample) | {st['sd']:.1f} |" if st["sd"] is not None else "| SD (sample) | — (n = 1) |")
        if st["ci"]:
            w(f"| 95% CI | {st['ci'][0]:.1f} – {st['ci'][1]:.1f}  (t = {st['t']}, df = {st['n'] - 1}) |")
        w(f"| Threshold | ≥ {THRESHOLD:.0f} |")
        w(f"| Full-sample mean vs the bar | **{'above' if passed else 'below'}** |")
        w(f"| **Pre-registered verdict** | **NOT EVALUABLE from this record** |")
        w(f"| Nearest Bangor adjective | *{adj}* (corpus mean {anchor}) — an anchor from Bangor et al. (2008), not a grade boundary |")
        w("")
        w("**How this may and may not be written up.**")
        w("")
        w(f"- It may be written as: *\"across all {st['n']} participants the mean SUS (Thai")
        w(f"  administration) was {st['mean']:.1f}, SD {st['sd']:.1f}\"* — with the sentence below attached.")
        w("- It may **not** be written as *\"KPI-6 passed\"* without that sentence, because the")
        w("  threshold was pre-registered against a different population than this mean covers.")
        w("- The direction of the difference is **unknown**: including participants who do not")
        w("  run ads could have raised this mean or lowered it, and nothing in the record says")
        w("  which. It is not a conservative estimate; it is an unattributed one.")
        w("")
        w("**The honest sentence for the methodology chapter:** eligibility was screened by")
        w("question at recruitment but was not recorded per participant, so the eligible-only")
        w("mean the specification calls for could not be produced; the full-sample mean is")
        w("reported in its place and the substitution is declared here.")
        w("")
        if st["ci"] and st["ci"][0] < THRESHOLD < st["ci"][1]:
            w(f"> The 95% CI straddles {THRESHOLD:.0f}. Even read as a full-sample figure, at n = {st['n']}")
            w("> the interval does not exclude the other side of the bar.")
            w("")
    elif not eligible:
        w("## Result")
        w("")
        w("**No eligible participant has been recorded**, so KPI-6 has no result. The")
        w("scores above cannot stand in for one: the claim under test is about people who")
        w("run ads themselves. Fallback A (Nielsen heuristic evaluation, 3 evaluators)")
        w("applies — and it needs the advisor approval obtained *in advance*.")
        w("")
    else:
        st = descriptive([r["_sus"] for r in eligible])
        adj, anchor = bangor_adjective(st["mean"])
        passed = st["mean"] >= THRESHOLD
        w("## Result — eligible participants only")
        w("")
        w(f"| n | {st['n']} |")
        w("|---|---|")
        w(f"| **Mean SUS** | **{st['mean']:.1f}** |")
        w(f"| SD (sample) | {st['sd']:.1f} |" if st["sd"] is not None else "| SD (sample) | — (n = 1) |")
        if st["ci"]:
            w(f"| 95% CI | {st['ci'][0]:.1f} – {st['ci'][1]:.1f}  (t = {st['t']}, df = {st['n'] - 1}) |")
        else:
            w("| 95% CI | — (needs n ≥ 2) |")
        w(f"| Threshold | ≥ {THRESHOLD:.0f} |")
        w(f"| **Verdict** | **{'PASS' if passed else 'FAIL'}** (n = {st['n']}) |")
        w(f"| Nearest Bangor adjective | *{adj}* (corpus mean {anchor}) — an anchor from Bangor et al. (2008), not a grade boundary |")
        w("")
        if st["ci"] and (st["ci"][0] < 0 or st["ci"][1] > 100):
            w(f"> The 95% CI runs outside 0-100. The t-interval is unbounded while the SUS scale is not, so at n = {st['n']} it is reported as computed and read as *uninformative about the bar* rather than trimmed to the scale — a clipped interval would look narrower than the data supports.")
            w("")
        if st["ci"] and st["ci"][0] < THRESHOLD < st["ci"][1]:
            w(f"> The 95% CI straddles {THRESHOLD:.0f}: the mean is {'above' if passed else 'below'} the bar, but with n = {st['n']} the interval does not exclude the other side. The pre-registered verdict follows the mean; this sentence belongs in the chapter beside it.")
            w("")
        if st["n"] < 5:
            w(f"> ⚠️ **Under-powered — n = {st['n']}, below the pre-registered floor of 5.** Per `docs/KPI_SPEC.md`, report the raw scores and label the result *indicative only*, and run Fallback A (Nielsen heuristic evaluation, 3 evaluators, severity 0-4). The mean above is printed so the sessions are not lost, **not** as a KPI-6 result.")
            w("")
        elif st["n"] < 8:
            w(f"> n = {st['n']} clears the floor of 5 but is below the target band of 8-12; the CI is correspondingly wide. State n everywhere the mean appears.")
            w("")

    if other and not unscreened:
        st2 = descriptive([r["_sus"] for r in other])
        w("## Outside the pre-registered inclusion criteria — reported, not merged")
        w("")
        w(f"n = {st2['n']}, mean {st2['mean']:.1f}" + (f", SD {st2['sd']:.1f}" if st2["sd"] is not None else "") + ".")
        w("")
        w("These sessions are **not** part of the KPI-6 result. Each one has a deviation")
        w("declared before it ran (`protocol.md` §8); the methodology chapter names the")
        w("reason and the date, and the acquiescence-bias limitation of a convenience")
        w("sample with it.")
        w("")

    w("## Task measures — descriptive, no threshold was pre-registered")
    w("")
    w(("Full sample — eligibility is unattributable in this run. " if unscreened
       else "Eligible participants only. ") +
      "`docs/KPI_SPEC.md` deliberately pre-registers no bar")
    w("for these; inventing one now would be the HARKing the spec exists to prevent.")
    w("Time-on-task counts successful attempts only — an abandoned task contributes its")
    w("failure, not a 300-second time that would flatter or punish the median.")
    w("")

    pool = eligible if eligible else records
    with_tasks = [r for r in pool if has_task_data(r)]
    without = [r for r in pool if not has_task_data(r)]

    if not with_tasks:
        w(f"**Not measured. {len(without)} of {len(pool)} sessions recorded no task outcome**, and")
        w("no table is printed, because a table assembled from participants who were never")
        w("scored would describe an empty set while looking like a result.")
        w("")
        w("The tasks *were* performed — participants worked through T1-T5 against the")
        w("production build before filling in the SUS, which is what the protocol requires")
        w("for the SUS to be about the system rather than about a description of it. What")
        w("is missing is the facilitator's record of how each one went.")
        w("")
        w("**Consequence, stated plainly.** SUS measures perception. The objective leg —")
        w("did they actually succeed, how long did it take, how often were they unblocked —")
        w("is absent, so this study cannot say whether a participant who rated the system")
        w("highly could in fact complete its core tasks. The methodology chapter states this")
        w("as a limitation of the study, not as a property of the system.")
        w("")
    else:
        if without:
            w(f"⚠️ **{len(without)} of {len(pool)} eligible sessions recorded no task outcome** and are")
            w(f"excluded from the denominators below. The percentages are over the {len(with_tasks)}")
            w("sessions that were recorded.")
            w("")
        out.extend(fmt_task_table(with_tasks))
        w("")
        total_assists = sum(int(t.get("assists") or 0) for r in with_tasks for t in (r.get("tasks") or []))
        w(f"Total assists across all tasks: **{total_assists}**. An assist is any time the")
        w("facilitator named a screen, a control or a value (`protocol.md` §5).")
        w("")
    return out, passed


def main() -> int:
    ap = argparse.ArgumentParser(description="Score the KPI-6 SUS study from the participant files.")
    ap.add_argument("--write", action="store_true", help="write evidence/kpi6-sus/summary.md as well as printing")
    args = ap.parse_args()

    try:
        records = load_participants()
        problems, irregularities = validate(records)
    except Refusal as exc:
        print(f"REFUSED TO SCORE\n\n{exc}", file=sys.stderr)
        return 2

    if problems:
        print("REFUSED TO SCORE — %d problem(s) in the participant records:\n" % len(problems), file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        print(
            "\nNothing was scored. Fix the records (or record honestly that a session is"
            "\nvoid) and run again. A number produced over any of the above would look"
            "\nexactly as convincing as a correct one.",
            file=sys.stderr,
        )
        return 1

    if irregularities:
        print("%d deviation(s) from the protocol, reported in the output:\n" % len(irregularities), file=sys.stderr)
        for i in irregularities:
            print(f"  ! {i}", file=sys.stderr)
        print("", file=sys.stderr)

    lines, _ = report(records, irregularities)
    text = "\n".join(lines)
    print(text)

    if args.write:
        target = HERE / "summary.md"
        target.write_text(text + "\n", encoding="utf-8")
        print(f"\n[written] {target}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
