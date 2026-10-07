"""Build 20261007193000 and its rollback from the LIVE definitions.

Input: before/functions-replaced-live.json (pg_get_functiondef read 2026-10-07,
before any change). Each function body is copied verbatim; only the guard is
replaced, by an exact-string substitution that must match exactly once.
"""
import json, sys
SRC = 'evidence/report/2026-10-07-kpi7-round3/before/functions-replaced-live.json'
MIG = 'supabase/migrations/20261007193000_tier_and_discount_functions_check_caller.sql'
RB = 'evidence/report/2026-10-07-kpi7-round3/before/rollback-function-bodies.sql'
EMP = "IF auth.uid() IS NULL OR NOT public.is_employee(auth.uid()) THEN"
FIX = {
  'evaluate_inactivity_tier_downgrades()': [(
    "IF auth.uid() IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.employees WHERE user_id = auth.uid()) THEN", EMP)],
  'sync_tier_from_lifetime_points()': [(
    "IF auth.uid() IS NOT NULL AND NOT public.is_employee(auth.uid()) THEN", EMP)],
  'update_tier_retention_period(uuid,integer)': [(
    "IF NOT EXISTS (SELECT 1 FROM public.employees WHERE user_id = auth.uid()) THEN", EMP)],
  'get_available_discounts(uuid)': [(
    "BEGIN\n    RETURN QUERY",
    "BEGIN\n    -- Only the caller's own coupon state (KPI-7 round 3).\n"
    "    IF p_customer_id IS DISTINCT FROM auth.uid() THEN\n        RETURN;\n    END IF;\n\n    RETURN QUERY")],
}
rows = {r['sig']: r for r in json.load(open(SRC))}
assert set(rows) == set(FIX), (set(rows), set(FIX))
out = []
for sig, subs in FIX.items():
    d = rows[sig]['def']
    for old, new in subs:
        n = d.count(old)
        if n != 1: sys.exit(f'{sig}: guard text found {n} times, expected 1')
        d = d.replace(old, new)
    out.append(d.rstrip() + ';\n')
hdr = open('evidence/report/2026-10-07-kpi7-round3/before/function-fixes-header.sql').read()
open(MIG, 'w').write(hdr + '\n' + '\n'.join(out))
open(RB, 'w').write(
  '-- ROLLBACK for 20261007193000_tier_and_discount_functions_check_caller.sql\n--\n'
  '-- NOT a migration. The four function definitions exactly as read live\n'
  '-- (pg_get_functiondef) on 2026-10-07 before the push. CREATE OR REPLACE keeps\n'
  '-- owner and ACL. Running it reopens the anon / inactive-employee / any-customer holes.\n\nBEGIN;\n\n'
  + '\n'.join(rows[s]['def'].rstrip() + ';\n' for s in FIX) + '\nCOMMIT;\n')
print('wrote', MIG, 'and', RB)
