/**
 * Cross-tenant isolation probe — the behavioural evidence behind the RLS fix
 * in `20260828120000_drop_permissive_tenant_policies.sql`.
 *
 *   node scripts/tenant-isolation-probe.mjs before.json
 *   ...apply migration...
 *   node scripts/tenant-isolation-probe.mjs after.json
 *
 * DESIGN (CLAUDE.md §12): every "the tenant saw 0 rows" is paired with the same
 * read performed by `service_role`. A table that is empty for service_role too
 * is reported INCONCLUSIVE, never as a pass — a check that cannot fail is a
 * claim, not a check. Foreign ownership is resolved through service_role, i.e.
 * independently of the policies under test.
 *
 * Needs: .env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY),
 *        mock-api/.env (SUPABASE_SERVICE_ROLE_KEY),
 *        optional OWNER_E2E_EMAIL / OWNER_E2E_PASSWORD for the employee leg
 *        (mint with `node scripts/owner-employee-fixture.mjs create`).
 * Writes: only the two tagged log rows in section D, deleted before exit.
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";

const unq = (v) => v.trim().replace(/^["']|["']$/g, "");
const parseEnv = (p) =>
  Object.fromEntries(
    fs.readFileSync(p, "utf8").split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), unq(l.slice(i + 1))]; }),
  );

const fe = parseEnv(".env");
const be = parseEnv("mock-api/.env");
const URL_ = be.SUPABASE_URL.replace(/\/$/, "");
const ANON = fe.VITE_SUPABASE_ANON_KEY;
const SR = be.SUPABASE_SERVICE_ROLE_KEY;

const CUSTOMER = { email: "e2e@buzzly.test", password: "E2eWalk!2026" };
const MY_TEAM = "b022da17-32cb-4694-bd72-0087bf427d79";   // E2E Walk Workspace
const OTHER_TEAM = "7c3976f5-bbf4-42b8-bd41-69a9e7f74c92"; // "TEST" — a different owner
const OTHER_ACCT = "aead9620-97ae-4cbc-a234-ac33816e51d0"; // an ad account of OTHER_TEAM

async function signIn(email, password) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const b = await r.json();
  if (!b.access_token) throw new Error(`sign-in failed for ${email}: ${b.error_description || b.msg || r.status}`);
  return { hdr: { apikey: ANON, Authorization: `Bearer ${b.access_token}` }, uid: b.user.id };
}

const SR_HDR = { apikey: SR, Authorization: `Bearer ${SR}` };

async function rows(path, hdr) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: { ...hdr, Prefer: "count=exact" } });
  let b = null; try { b = await r.json(); } catch { /* non-JSON */ }
  const cr = r.headers.get("content-range") || "";
  const total = cr.includes("/") ? cr.split("/")[1] : null;
  return {
    status: r.status,
    total: total === "*" || total === null ? null : Number(total),
    data: Array.isArray(b) ? b : [],
    err: Array.isArray(b) ? null : b?.message || b?.code || null,
  };
}

const out = { probed_at: new Date().toISOString(), sections: {} };
const log = (v, label, detail) => console.log(`${v.padEnd(34)} ${label.padEnd(38)} ${detail}`);

const cust = await signIn(CUSTOMER.email, CUSTOMER.password);
console.log(`customer  : ${CUSTOMER.email} (${cust.uid}) team ${MY_TEAM}`);

let owner = null;
if (process.env.OWNER_E2E_EMAIL) {
  owner = await signIn(process.env.OWNER_E2E_EMAIL, process.env.OWNER_E2E_PASSWORD);
  console.log(`employee  : ${process.env.OWNER_E2E_EMAIL} (${owner.uid}) role=owner`);
} else {
  console.log("employee  : (skipped — OWNER_E2E_EMAIL not set)");
}

// ── A. the ads path: the isolation the product is designed around ───────────
console.log("\n### A. customer reading ANOTHER workspace's ad data (expect 0 while service_role sees rows)");
out.sections.A = [];
for (const [label, path] of [
  ["ad_insights (their account)", `ad_insights?select=id&ad_account_id=eq.${OTHER_ACCT}`],
  ["ads", `ads?select=id&team_id=eq.${OTHER_TEAM}`],
  ["campaigns", `campaigns?select=id&team_id=eq.${OTHER_TEAM}`],
  ["ad_accounts", `ad_accounts?select=id&team_id=eq.${OTHER_TEAM}`],
  ["workspaces", `workspaces?select=id&id=eq.${OTHER_TEAM}`],
  ["workspace_members", `workspace_members?select=user_id&team_id=eq.${OTHER_TEAM}`],
]) {
  const u = await rows(path, cust.hdr);
  const s = await rows(path, SR_HDR);
  const verdict = u.status >= 400 ? `blocked (${u.status})`
    : !s.total ? "INCONCLUSIVE (empty for service_role)"
      : u.total > 0 ? "LEAK" : "isolated";
  out.sections.A.push({ label, verdict, customer: u.total, service_role: s.total });
  log(verdict === "isolated" ? "OK isolated" : verdict === "LEAK" ? "!! LEAK" : verdict,
      label, `customer:${u.total} service_role:${s.total}`);
}

// ── B. the three tables the permissive policies covered ─────────────────────
// Ownership is resolved via service_role, so it does not depend on the policies
// being measured.
console.log("\n### B. rows visible to the customer that belong to somebody else");
out.sections.B = [];

const allPosts = (await rows("social_posts?select=id,team_id&limit=1000", SR_HDR)).data;
const postOwner = Object.fromEntries(allPosts.map((p) => [p.id, p.team_id]));
const seenPosts = await rows("social_posts?select=id,team_id&limit=1000", cust.hdr);
const foreignPosts = seenPosts.data.filter((p) => p.team_id !== MY_TEAM);
out.sections.B.push({
  table: "social_posts", visible: seenPosts.total, foreign: foreignPosts.length,
  total: allPosts.length, foreign_teams: [...new Set(foreignPosts.map((p) => p.team_id))].length,
});
log(foreignPosts.length ? "!! LEAK" : "OK own only", "social_posts",
    `visible:${seenPosts.total}/${allPosts.length} foreign:${foreignPosts.length}`);

// customer_activities has no team column; it hangs off profile_customers.
const myProfiles = (await rows(`profile_customers?select=id`, cust.hdr)).data.map((p) => p.id);
// PostgREST caps a payload at 1000 rows, so `data.length` understates what is
// readable. The count header is the true visible count; `data` is the sample the
// foreign-ownership check runs on.
const seenAct = await rows("customer_activities?select=id,profile_customer_id&limit=1000", cust.hdr);
const totalAct = (await rows("customer_activities?select=id&limit=1", SR_HDR)).total;
const foreignAct = seenAct.data.filter((a) => !myProfiles.includes(a.profile_customer_id));
out.sections.B.push({
  table: "customer_activities", visible: seenAct.total, sampled: seenAct.data.length,
  foreign_in_sample: foreignAct.length, total: totalAct,
});
log(foreignAct.length ? "!! LEAK" : "OK own only", "customer_activities",
    `visible:${seenAct.total}/${totalAct} foreign(in ${seenAct.data.length}-row sample):${foreignAct.length}`);

const seenFb = await rows("feedback?select=id,user_id&limit=500", cust.hdr);
const totalFb = (await rows("feedback?select=id&limit=1", SR_HDR)).total;
const foreignFb = seenFb.data.filter((f) => f.user_id !== cust.uid);
out.sections.B.push({
  table: "feedback", visible: seenFb.total, foreign: foreignFb.length, total: totalFb,
  foreign_users: [...new Set(foreignFb.map((f) => f.user_id))].length,
});
log(foreignFb.length ? "!! LEAK" : "OK own only", "feedback",
    `visible:${seenFb.total}/${totalFb} foreign:${foreignFb.length}`);

// ── C. the employee-owner leg must NOT lose access ──────────────────────────
console.log("\n### C. owner employee still reaches the tables /owner/user-feedback needs");
out.sections.C = [];
if (owner) {
  for (const [label, path] of [
    ["feedback (owner dashboard)", "feedback?select=id&limit=500"],
    ["feedback + embed (real query)", "feedback?select=id,customer_activities(profile_customers(first_name))&limit=5"],
    ["customer_activities", "customer_activities?select=id&limit=1"],
    ["audit_logs_enhanced", "audit_logs_enhanced?select=id&limit=1"],
  ]) {
    const o = await rows(path, owner.hdr);
    const s = await rows(path.split("&limit")[0] + "&limit=1", SR_HDR);
    const verdict = o.status >= 400 ? `BROKEN (${o.status} ${o.err})`
      : !s.total ? "INCONCLUSIVE (empty)"
        : o.total > 0 ? "OK still visible" : "BROKEN (0 rows)";
    out.sections.C.push({ label, verdict, owner: o.total, service_role: s.total, err: o.err });
    log(verdict, label, `owner:${o.total} service_role:${s.total}`);
  }
} else {
  console.log("  (skipped)");
}

// ── D. write side: can a tenant forge a log row for another user? ───────────
console.log("\n### D. forging a log row under somebody else's user_id");
out.sections.D = [];
const PROBE_ID = randomUUID();
const STRANGER = "47cf518f-096f-4aa3-babb-45254b05353e"; // owner of OTHER_TEAM

// `Prefer: return=minimal` is what a plain `supabase.from().insert()` sends, and
// it is the only setting that measures the *write* policy. `return=representation`
// appends RETURNING, which additionally needs a SELECT policy — so it reports a
// refusal for a table the caller may well be able to write, which is how an
// earlier run of this probe talked itself into a false pass.
// Acceptance is then confirmed by finding the row with service_role rather than
// by trusting the status code.
const ANON_HDR = { apikey: ANON, Authorization: `Bearer ${ANON}` };

async function tryInsert(table, body, hdr, marker) {
  const r = await fetch(`${URL_}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...hdr, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  let b = null; try { b = await r.json(); } catch { /* return=minimal sends none */ }
  const col = table === "audit_logs_enhanced" ? "description" : "message";
  const landed = (await rows(`${table}?select=id&${col}=eq.${marker}`, SR_HDR)).data.length;
  return {
    status: r.status,
    accepted: landed > 0,
    rows_written: landed,
    err: Array.isArray(b) ? null : b?.message || b?.code || null,
  };
}

const M = (what) => `isolation probe ${PROBE_ID} — ${what}`;

const forgedAudit = await tryInsert("audit_logs_enhanced", {
  user_id: STRANGER, category: "feature", description: M("forged actor"),
  status: "success", metadata: { probe_id: PROBE_ID },
}, cust.hdr, M("forged actor"));
out.sections.D.push({ check: "customer forges audit_logs_enhanced as another user", ...forgedAudit });
log(forgedAudit.accepted ? "!! ACCEPTED (forgeable)" : `OK refused (${forgedAudit.status})`,
    "audit_logs_enhanced forged actor", forgedAudit.err || `rows written: ${forgedAudit.rows_written}`);

const ownAudit = await tryInsert("audit_logs_enhanced", {
  user_id: cust.uid, category: "feature", description: M("own actor"),
  status: "success", metadata: { probe_id: PROBE_ID },
}, cust.hdr, M("own actor"));
out.sections.D.push({ check: "customer logs its OWN audit row (must keep working)", ...ownAudit });
log(ownAudit.accepted ? "OK own row still accepted" : `!! REGRESSION (${ownAudit.status})`,
    "audit_logs_enhanced own actor", ownAudit.err || "");

const forgedErr = await tryInsert("error_logs", {
  level: "error", message: M("forged actor"), user_id: STRANGER,
  metadata: { probe_id: PROBE_ID },
}, ANON_HDR, M("forged actor"));
out.sections.D.push({ check: "anon forges error_logs as a real user", ...forgedErr });
log(forgedErr.accepted ? "!! ACCEPTED (forgeable)" : `OK refused (${forgedErr.status})`,
    "error_logs forged actor (anon)", forgedErr.err || `rows written: ${forgedErr.rows_written}`);

const anonErr = await tryInsert("error_logs", {
  level: "error", message: M("anonymous"), user_id: null,
  metadata: { probe_id: PROBE_ID },
}, ANON_HDR, M("anonymous"));
out.sections.D.push({ check: "anon logs an anonymous error (must keep working)", ...anonErr });
log(anonErr.accepted ? "OK anonymous logging still works" : `!! REGRESSION (${anonErr.status})`,
    "error_logs anonymous", anonErr.err || "");

// ── E. positive control for section B ───────────────────────────────────────
// After the fix the customer reads 0 rows from feedback and customer_activities
// — but this account has never written either, so 0 is also what a policy that
// locked everybody out would produce. Section B cannot tell those apart on its
// own. So: write one row that genuinely belongs to this customer, and require
// the surviving policy to hand it back. Without this, B is a claim.
console.log("\n### E. positive control — the customer must still read a row that IS theirs");
out.sections.E = [];

const myProfileId = (await rows("profile_customers?select=id&limit=1", cust.hdr)).data[0]?.id ?? null;

async function control(table, body, filter, label) {
  const ins = await fetch(`${URL_}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...cust.hdr, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  let insErr = null;
  if (ins.status >= 400) { try { insErr = (await ins.json())?.message; } catch { /* no body */ } }
  const readBack = await rows(`${table}?select=id&${filter}`, cust.hdr);
  const reallyThere = await rows(`${table}?select=id&${filter}`, SR_HDR);
  const verdict = insErr ? `insert refused (${ins.status})`
    : reallyThere.data.length === 0 ? "INCONCLUSIVE (row never landed)"
      : readBack.data.length > 0 ? "OK own row readable" : "!! BROKEN (own row hidden)";
  out.sections.E.push({ label, verdict, written: reallyThere.data.length, read_back: readBack.data.length, err: insErr });
  log(verdict, label, insErr || `written:${reallyThere.data.length} read back:${readBack.data.length}`);
  // remove it again, and prove the removal matched
  if (reallyThere.data.length) {
    const del = await fetch(`${URL_}/rest/v1/${table}?${filter}`, {
      method: "DELETE", headers: { ...SR_HDR, Prefer: "return=representation" },
    });
    const gone = (await del.json()).length;
    if (gone !== reallyThere.data.length) throw new Error(`control cleanup mismatch on ${table}: ${reallyThere.data.length} written, ${gone} deleted`);
  }
}

await control("feedback",
  { user_id: cust.uid, comment: M("own feedback") },
  `comment=eq.${encodeURIComponent(M("own feedback"))}`,
  "feedback — own row");

if (myProfileId) {
  await control("customer_activities",
    { profile_customer_id: myProfileId, session_id: PROBE_ID, page_url: M("own activity") },
    `session_id=eq.${PROBE_ID}`,
    "customer_activities — own row");
} else {
  out.sections.E.push({ label: "customer_activities — own row", verdict: "INCONCLUSIVE (no profile_customers row)" });
  log("INCONCLUSIVE (no profile row)", "customer_activities — own row", "");
}

// social_posts needs no synthetic row: the customer already owns 13 of the 89.
out.sections.E.push({
  label: "social_posts — own rows", verdict: seenPosts.total > 0 ? "OK own rows readable" : "!! BROKEN (own rows hidden)",
  read_back: seenPosts.total,
});
log(seenPosts.total > 0 ? "OK own rows readable" : "!! BROKEN (own rows hidden)",
    "social_posts — own rows", `visible:${seenPosts.total}`);

// ── cleanup: remove exactly the rows this probe created ─────────────────────
let removed = 0;
for (const t of ["audit_logs_enhanced", "error_logs"]) {
  const before = await rows(`${t}?select=id&metadata->>probe_id=eq.${PROBE_ID}`, SR_HDR);
  if (!before.data.length) continue;
  const r = await fetch(`${URL_}/rest/v1/${t}?metadata->>probe_id=eq.${PROBE_ID}`, {
    method: "DELETE", headers: { ...SR_HDR, Prefer: "return=representation" },
  });
  const deleted = (await r.json()).length;
  if (deleted !== before.data.length) throw new Error(`cleanup mismatch on ${t}: matched ${before.data.length}, deleted ${deleted}`);
  removed += deleted;
}
out.probe_rows_removed = removed;
console.log(`\ncleanup: removed ${removed} probe row(s) tagged ${PROBE_ID}`);

const dest = process.argv[2];
if (dest) { fs.writeFileSync(dest, JSON.stringify(out, null, 2)); console.log(`written -> ${dest}`); }
