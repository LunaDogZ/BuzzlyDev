#!/usr/bin/env node
/**
 * Generates the study fixture for the KPI-6 SUS sessions.
 *
 * WHY THIS EXISTS, and why it is not in `fixtures/imports/`:
 * `fixtures/imports/` is the frozen KPI-2/KPI-3 corpus. Nothing may be added to
 * it, because its expectations are hand-declared and its regeneration must stay
 * byte-identical. This file serves a different purpose entirely — it produces
 * the data a *participant* reads on screen during a usability session, so it
 * lives with the rest of the KPI-6 material and is never read by the KPI suite.
 *
 * WHAT IT SOLVES: `evidence/kpi6-sus/protocol.md` §6 prerequisite #4. T1 asks
 * the participant for spend in the last 30 days and the day with the highest
 * impressions. On 2026-09-09 the study workspace held ~20 rows inside that
 * window, so a participant would have read a near-empty screen and T1 would
 * have measured the seed rather than the interface.
 *
 * HOW IT REACHES THE DATABASE: this file is uploaded through the application,
 * by a signed-in user, and ingested by the real Airflow pipeline. It is not
 * inserted directly. That keeps every row's provenance honest (`data_source =
 * import`) and means the study screen shows data that arrived the way a
 * merchant's data arrives.
 *
 * DETERMINISTIC: fixed seed, anchored window, no clock reads. Regenerating
 * produces a byte-identical file.
 *
 *   node evidence/kpi6-sus/study-fixture/generate.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

// Anchored to the session date, never to the clock: the window must not drift
// if this is regenerated later.
const END_DATE = new Date("2026-09-09T00:00:00Z");
const DAYS = 30;                       // 2026-08-11 .. 2026-09-09 inclusive
const SEED = 20260909;

/** mulberry32 — same small deterministic PRNG the KPI corpus uses. */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(SEED);
const randInt = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
const money = (n) => n.toFixed(2);
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => d.toISOString().slice(0, 10);

/** Thai Buddhist-era date, the form Shopee exports: 24/06/2569 */
const thaiSlash = (d) =>
  `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear() + 543}`;

function dateRange(days, end) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d);
  }
  return out;
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCsv = (headers, rows) =>
  [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

// --------------------------------------------------------------- the data

const DATES = dateRange(DAYS, END_DATE);

// Two ad types per day. Two rows per day is enough for the source picker and
// the daily chart to have something to show, without giving a participant a
// wall of rows to scan in a five-minute task.
// Two placements per day. IMPORTANT — this is why each row also carries a
// distinct ad name: the pipeline identifies a row by
// (date, campaign_name, ad_group_name, ad_name) — `IDENTITY_FIELDS` in
// airflow/dags/buzzly_common/validate.py:80 — and `ประเภทโฆษณา` maps to
// `ad_type`, which is NOT in that tuple. Two rows for one day that differ only
// by placement are therefore the same row as far as the validator is
// concerned, and the first version of this fixture was refused whole: 30 of 60
// rows `duplicate_row`. That refusal is correct behaviour, not a defect — the
// target's ad id is derived from campaign + group + ad name
// (targets.py:370), so accepting both would have let one silently overwrite
// the other. The fixture is what had to change.
const AD_TYPES = ["โฆษณาค้นหาสินค้า", "โฆษณาค้นหาร้านค้า"];
const AD_NAMES = ["AD - ค้นหาสินค้า", "AD - ค้นหาร้านค้า"];
const CAMPAIGN = "Shopee Ads - แคมเปญประจำเดือน";

// T1 must have ONE unambiguous answer for "which day had the most impressions".
// The peak is placed on a fixed date and given a margin no random day can
// reach: baseline impressions stay under 20,000 per row (40,000 per day) and
// the peak day is built to clear 70,000. A tie would make the task unscorable.
const PEAK_DATE = "2026-08-27";
const PEAK_IMPRESSIONS = [38000, 34000];

const rows = [];
let totalSpend = 0;
let totalImpressions = 0;
const perDayImpressions = new Map();
const perDaySpend = new Map();

for (const d of DATES) {
  const day = iso(d);
  const isPeak = day === PEAK_DATE;
  let dayImpressions = 0;
  let daySpend = 0;

  AD_TYPES.forEach((adType, i) => {
    const impressions = isPeak ? PEAK_IMPRESSIONS[i] : randInt(8000, 19000);
    const ctr = 2.1 + rng() * 1.4;                       // 2.1% – 3.5%
    const clicks = Math.max(1, Math.round((impressions * ctr) / 100));
    const cpc = 2.0 + rng() * 1.6;                       // ฿2.00 – ฿3.60
    const spend = clicks * cpc;
    const orders = Math.max(1, Math.round(clicks * (0.04 + rng() * 0.05)));
    const aov = 380 + rng() * 260;
    const revenue = orders * aov;

    rows.push([
      thaiSlash(d),
      CAMPAIGN,
      AD_NAMES[i],
      adType,
      impressions,
      clicks,
      ((clicks / impressions) * 100).toFixed(2),
      money(spend),
      orders,
      money(revenue),
      (revenue / spend).toFixed(2),
    ]);

    // Accumulate the ROUNDED value, i.e. what the CSV actually says. Summing
    // the unrounded float here and rounding once at the end put the answer key
    // one satang above what the database holds (65,575.27 vs 65,575.26) —
    // small, but a facilitator comparing the screen to this key would have to
    // decide whether a one-satang gap meant something. It does not, and now it
    // does not appear.
    const spendAsWritten = Number(money(spend));
    totalSpend += spendAsWritten;
    totalImpressions += impressions;
    dayImpressions += impressions;
    daySpend += spendAsWritten;
  });

  perDayImpressions.set(day, dayImpressions);
  perDaySpend.set(day, daySpend);
}

const HEADERS = [
  "วันที่", "ชื่อแคมเปญ", "ชื่อโฆษณา", "ประเภทโฆษณา", "การแสดงผล", "คลิก",
  "CTR (%)", "ค่าใช้จ่าย (บาท)", "จำนวนคำสั่งซื้อ", "ยอดขายจากโฆษณา (บาท)", "ROAS",
];

// ------------------------------------------------------------- answer key
//
// Declared from the numbers this generator emitted, BEFORE any parser sees the
// file. Nothing here is read back out of the database or computed by the code
// under test — if the screen disagrees with this file, the screen is wrong.

const sortedDays = [...perDayImpressions.entries()].sort((a, b) => b[1] - a[1]);
const [topDay, topDayImpressions] = sortedDays[0];
const runnerUp = sortedDays[1][1];

// The application resolves its "30d" preset as `today - 30 .. today`
// (`src/hooks/useDashboardMetrics.tsx:262`), so the window a participant sees
// depends on the day the session runs — it is NOT this file's window. Scoring
// T1 against a single total would mark a correct answer wrong. The per-day
// figures below let the facilitator compute the expected total for whatever
// date the session actually happens on, and the ready-made totals cover the
// dates the sessions are planned for.
const perDay = [...perDayImpressions.keys()].map((day) => ({
  date: day,
  spend_thb: Number(perDaySpend.get(day).toFixed(2)),
  impressions: perDayImpressions.get(day),
}));

function totalForSessionDate(sessionISO) {
  const end = new Date(`${sessionISO}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  const inWindow = perDay.filter((r) => r.date >= iso(start) && r.date <= iso(end));
  return {
    session_date: sessionISO,
    app_window: { from: iso(start), to: iso(end) },
    days_with_data_in_window: inWindow.length,
    expected_spend_thb: Number(inWindow.reduce((s, r) => s + r.spend_thb, 0).toFixed(2)),
    expected_peak_day: inWindow.length
      ? inWindow.reduce((a, b) => (b.impressions > a.impressions ? b : a)).date
      : null,
  };
}

const answerKey = {
  generated_by: "evidence/kpi6-sus/study-fixture/generate.mjs",
  seed: SEED,
  window: { from: iso(DATES[0]), to: iso(DATES.at(-1)), days: DAYS },
  rows: rows.length,
  note: "Dates in the CSV are Buddhist era (2569); they must land as 2026 in ad_insights.",
  identity_note:
    "Each row carries a distinct ad name because the validator identifies rows by " +
    "(date, campaign_name, ad_group_name, ad_name) and ad_type is not in that key. " +
    "Without it, the two placements of one day are duplicates and the file is refused whole.",
  t1_expected: {
    question: "ในช่วง 30 วันล่าสุด ร้านนี้ใช้เงินโฆษณาไปเท่าไร และวันไหนมีการแสดงผลสูงสุด",
    total_spend_thb_this_file: Number(totalSpend.toFixed(2)),
    total_impressions_this_file: totalImpressions,
    highest_impressions_day: topDay,
    highest_impressions_value: topDayImpressions,
    margin_over_runner_up: topDayImpressions - runnerUp,
    unambiguous: topDayImpressions > runnerUp,
    read_this_before_scoring:
      "Use `by_session_date` for the day the session runs, not `total_spend_thb_this_file`. " +
      "Other data sources in the workspace may also fall inside the window — if the source " +
      "picker is left on 'all', the screen total will exceed these figures. Set the picker, " +
      "or re-read the expected total from the app with the same filter the participant used.",
    by_session_date: ["2026-09-10", "2026-09-11", "2026-09-12"].map(totalForSessionDate),
    per_day: perDay,
  },
  t5_expected: {
    question: "ข้อมูลในระบบครอบคลุมช่วงเวลาไหน",
    note: "This file extends the workspace's coverage to its end date. Re-read the full range from the app on the day of the session — other sources also contribute.",
    this_file_covers: { from: iso(DATES[0]), to: iso(DATES.at(-1)) },
  },
};

if (!answerKey.t1_expected.unambiguous) {
  console.error("ABORT: the peak day is not unique — T1 would be unscorable.");
  process.exit(1);
}

// ------------------------------------------------------------------ write

function write(name, content) {
  const full = join(ROOT, name);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
  console.log(`  ✓ ${name}`);
}

write("sus-study-shopee-ads.csv", toCsv(HEADERS, rows));
write("answer-key.json", JSON.stringify(answerKey, null, 2) + "\n");

console.log(`\nWindow ${answerKey.window.from} → ${answerKey.window.to}, seed ${SEED}, ${rows.length} rows.`);
console.log(`This file  : ฿${answerKey.t1_expected.total_spend_thb_this_file.toLocaleString()} over ${DAYS} days`);
console.log(`T1 peak    : ${topDay} at ${topDayImpressions.toLocaleString()} impressions ` +
            `(+${answerKey.t1_expected.margin_over_runner_up.toLocaleString()} over the next day)`);
console.log("\nExpected T1 spend, by the day the session runs:");
for (const r of answerKey.t1_expected.by_session_date) {
  console.log(`  ${r.session_date}  app shows ${r.app_window.from} → ${r.app_window.to}  ` +
              `= ฿${r.expected_spend_thb.toLocaleString()} (${r.days_with_data_in_window} days with data, peak ${r.expected_peak_day})`);
}
