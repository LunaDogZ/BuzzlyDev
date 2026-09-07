/**
 * Turns the raw KPI-4 JSON into the Lighthouse HTML reports a human reads.
 *
 *   LIGHTHOUSE_DIR=<dir> node scripts/kpi4-report.mjs evidence/kpi4-lighthouse/<sha>
 *
 * The JSON in `run-*.json` is the evidence; this only renders it. One HTML per
 * route/preset is produced, for the run whose Performance score IS the median
 * of the five scored runs — the run the verdict is computed from, not the best
 * one. Picking the best-looking run would be reporting a different number from
 * the one the KPI is decided on.
 */
import fs from "node:fs";
import path from "node:path";

const LH_DIR = process.env.LIGHTHOUSE_DIR;
const root = process.argv[2];
if (!LH_DIR || !root) {
  console.error("usage: LIGHTHOUSE_DIR=<dir> node scripts/kpi4-report.mjs <evidence dir>");
  process.exit(2);
}
const { ReportGenerator } = await import(
  path.join(LH_DIR, "node_modules/lighthouse/report/generator/report-generator.js"));

let made = 0;
for (const preset of fs.readdirSync(root).filter((d) => ["desktop", "mobile"].includes(d))) {
  for (const slug of fs.readdirSync(path.join(root, preset))) {
    const dir = path.join(root, preset, slug);
    const runsFile = path.join(dir, "runs.json");
    if (!fs.existsSync(runsFile)) continue;
    const summary = JSON.parse(fs.readFileSync(runsFile, "utf8"));

    // the median run, by the same score the verdict uses
    const target = summary.runs.find((r) => r.performance === summary.medianPerformance)
      ?? summary.runs[0];
    const lhr = JSON.parse(fs.readFileSync(path.join(dir, `run-${target.run}.json`), "utf8"));
    const out = path.join(dir, `median-run-${target.run}.html`);
    fs.writeFileSync(out, ReportGenerator.generateReport(lhr, "html"));
    console.log(`${preset.padEnd(8)} ${slug.padEnd(14)} median ${String(summary.medianPerformance).padStart(3)} → ${out}`);
    made++;
  }
}
console.log(`\n${made} report(s). Open one in a browser.`);
