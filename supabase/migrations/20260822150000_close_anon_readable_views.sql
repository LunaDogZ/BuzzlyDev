-- Close findings A01-1 and A01-2, found by the KPI-7 behavioural probe on
-- 2026-08-22 (evidence/kpi7-security/fc86210…/a01-summary.md).
--
-- Both are views that grant SELECT to `anon` and set no `security_invoker`.
-- A view without `security_invoker` runs with its *definer's* rights, so it
-- never consults the RLS of the tables beneath it. 136 ENABLE ROW LEVEL
-- SECURITY statements and 557 policies were all in force and all irrelevant:
-- an anonymous caller read straight through them.
--
-- Measured before this migration was written, as the employee `dev` role, so
-- the change is not made on the assumption that it is harmless:
--   audit_logs_enhanced 967 · action_type 6 · employees 6 · role_employees 3
--   · customer 30 — every table the view LEFT JOINs to is readable by the
-- caller under its own policies. Turning security_invoker on therefore does
-- not empty the employee audit page.

-- ── A01-1: audit_logs_view ───────────────────────────────────────────────────
-- Served 967 audit rows to `anon`, including user_email, ip_address, user_id
-- and per-page behaviour. The grant was never needed: the only consumer is
-- src/hooks/useAuditLogs.tsx, reached from /dev/audit-logs and the owner pages,
-- both behind EmployeeProtectedRoute.

REVOKE SELECT ON public.audit_logs_view FROM anon;

-- Make the view honour the caller's RLS rather than its definer's rights.
-- Requires PG 15+; this project runs 17.
ALTER VIEW public.audit_logs_view SET (security_invoker = on);

-- ── A01-2: debug_insights_linkage ────────────────────────────────────────────
-- A debugging artifact from 2026-02-18 whose own header calls itself a "debug
-- script". It granted `anon` a cross-tenant view of workspace names,
-- workspaces.owner_id, ad-account names and insight linkage. Nothing in src/
-- reads it — it appears only as generated `referencedRelation` metadata in
-- types.ts — so it is dropped rather than merely revoked. Leaving a revoked
-- debug view in place would preserve the same mistake for the next person who
-- re-grants it.

DROP VIEW IF EXISTS public.debug_insights_linkage;
