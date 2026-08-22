# A01 — behavioural verification, completed 2026-08-22 14:03 ICT

Completes the row left **PARTIALLY VERIFIED** in
`evidence/kpi7-security/da02849…/matrix.md`. That file is not edited; this is
the outstanding evidence, produced once the Supabase project came back.

**Instrument:** `scripts/kpi7-anon-probe.mjs`
**Population:** 105 relations — 103 tables + 2 views, extracted from
`src/integrations/supabase/types.ts` (`a01-relations.txt`)
**Raw output:** `a01-anon-probe.json`

## Design — why every relation is read twice

Each relation is read as `anon` **and** as `service_role`. A relation both
roles find empty is reported `INCONCLUSIVE`, never as a pass. Per CLAUDE.md
§12, "anon saw no rows" is not evidence unless the same instrument is shown
returning rows when authorised.

**This was not a theoretical precaution — it caught a false pass on the first
attempt.** At 13:58 the host resolved but the database had not finished
restoring, and PostgREST answered `HTTP 521` for every request. A probe reading
only as `anon` would have recorded *"0 rows on 105/105 relations"* and been
written up as a clean RLS pass **against a server that was down**. The
service_role control forced all 105 to `INCONCLUSIVE` instead. The run was
discarded and re-run at 14:03 once the schema cache reported 105 definitions.

## Result

| Verdict | Count | Meaning |
|---|---|---|
| `anon blocked` | **52** | service_role saw rows, anon saw none — RLS demonstrably enforcing |
| `INCONCLUSIVE` | **40** | empty for both roles; proves nothing either way, and is not counted as a pass |
| **`ANON-READABLE`** | **13** | anon read rows |

## The 13, split

**Eleven are intentional public reference data** — lookup tables the signup,
pricing and onboarding screens must read before any session exists:

`platforms` (9) · `business_types` (8) · `industries` (8) ·
`point_earning_rules` (5) · `genders` (4) · `loyalty_tiers` (4) ·
`payment_methods` (3) · `role_employees` (3) · `subscription_plans` (3) ·
`currencies` (2) · `reward_items` (1)

These carry no tenant data. `role_employees` is the one worth a sentence in the
chapter — it discloses the role names `dev`/`support`/`owner` to an anonymous
caller. That is enumeration of a role vocabulary, not access, and is accepted.

**Two are findings, and both are views.**

### 🔴 FINDING A01-1 — `audit_logs_view` is readable by `anon`: 967 rows

`supabase/migrations/20260320000064_create_audit_logs_view.sql` ends with:

```sql
GRANT SELECT ON public.audit_logs_view TO anon;
```

The view has **no `security_invoker`**, so it runs with its definer's rights
and does not apply RLS on the tables beneath it — `audit_logs_enhanced`,
`employees`, `customer`. An unauthenticated caller can read, for every row:

| Column | Example returned to `anon` |
|---|---|
| `user_email` | `mike.chen@digitalwave.com` |
| `ip_address` | `10.237.170.247` |
| `user_id` | `c1000000-0000-0000-0000-000000000002` |
| `description` | `Viewed /dashboard` |
| `metadata` | `{browser, page_url, timestamp}` |
| `created_at` | `2026-03-17T12:44:37Z` |

**Severity: High.** It is the audit trail itself — identity, address and
behaviour — served without a session. The data presently in the table is
seeded, but the exposure is a property of the grant, not of the rows.

**The grant is also unnecessary.** The only consumer is
`src/hooks/useAuditLogs.tsx:31`, reached from `/dev/audit-logs` and the owner
pages — routes behind `EmployeeProtectedRoute`. Nothing anonymous needs it.

### 🔴 FINDING A01-2 — `debug_insights_linkage` is readable by `anon`: 50 rows

`supabase/migrations/20260218222000_debug_view.sql`, a debugging artifact from
2026-02-18 whose own comment reads *"Debug script to check data
relationships"*. It also grants `SELECT` to `anon` and exposes workspace names,
`workspaces.owner_id`, ad-account names and insight linkage across **all**
tenants.

**Severity: Medium.** No consumer exists in `src/` — it appears only as a
`referencedRelation` in generated types. It should be dropped, not merely
revoked.

### Root cause, common to both

`grep -rn "security_invoker" supabase/migrations/*.sql` returns **nothing**. No
view in the corpus sets it, so every view bypasses the RLS of its base tables;
two of them then hand that bypass to `anon` explicitly.

**This is exactly what the static evidence could not see.** The migration
corpus shows 136 `ENABLE ROW LEVEL SECURITY` and 557 policies — all true, and
all irrelevant to a view that never consults them. The behavioural probe is
what found it.

## Recommended remediation — NOT applied

A database change against the live cloud project, so it is reported and left
for approval (CLAUDE.md §8, §9):

```sql
-- A01-1
REVOKE SELECT ON public.audit_logs_view FROM anon;
ALTER VIEW public.audit_logs_view SET (security_invoker = on);

-- A01-2 — no consumer; drop rather than revoke
DROP VIEW IF EXISTS public.debug_insights_linkage;
```

⚠️ Two cautions before anyone runs this:
1. `security_invoker = on` makes the view honour the caller's RLS, which may
   change what `/dev/audit-logs` shows to an employee. Verify that page after
   the change — the employee path reads through `audit_logs_enhanced`'s
   policies, which must actually permit it.
2. A prior session recorded that `REVOKE EXECUTE … FROM anon` **segfaulted**
   supabase/postgres 17.6.1.106 (see the skills-audit note). That was `REVOKE
   EXECUTE` on functions, not `REVOKE SELECT` on a view, but the migration
   should be applied and verified carefully rather than assumed safe.

Any fix is a **separate dated run reported before/after**. This result is the
"before".

## Effect on the KPI-7 verdict

Criterion 1 (10/10 answered) is unchanged — A01 was always answered. What
changes is the *content* of the answer: **A01 is now fully verified, and the
verification found two real access-control defects.** The chapter should carry
this as the strongest evidence in the security section that the assessment was
performed rather than asserted.
