# A01 remediation — before/after, 2026-08-22

**Migration:** `supabase/migrations/20260822150000_close_anon_readable_views.sql`
**Applied to cloud** via `supabase db push --linked` — one migration; every
other file already carried a remote timestamp in `supabase migration list`.
**`spec_commit`:** `da02849…`, unchanged. No threshold moved.

The "before" — `a01-summary.md` and `a01-anon-probe.json` in this directory —
is not edited and continues to report both findings as found.

## Result

| | Before | After |
|---|---|---|
| Relations probed | 105 | 104 (one view dropped) |
| `anon blocked` | 52 | **53** |
| `INCONCLUSIVE` | 40 | 40 |
| **`ANON-READABLE`** | **13** | **11** |
| `audit_logs_view` to `anon` | **967 rows** | **`42501 permission denied`** |
| `debug_insights_linkage` to `anon` | 50 rows | **view no longer exists** |

The 11 remaining are the intentional public reference tables, unchanged:
`platforms` (9) · `business_types` (8) · `industries` (8) ·
`point_earning_rules` (5) · `genders` (4) · `loyalty_tiers` (4) ·
`payment_methods` (3) · `role_employees` (3) · `subscription_plans` (3) ·
`currencies` (2) · `reward_items` (1). None carries tenant data.

## The regression risk was measured before the change, not after

`security_invoker = on` makes the view honour the *caller's* RLS across all
five relations it touches. Had any of the four LEFT JOIN targets been
unreadable by an employee, the page would not have errored — it would have
quietly rendered blank `user_email` and `user_role`, which is worse than a
crash because nobody notices.

So it was measured first, through a real employee session (a throwaway `dev`
account from `scripts/dev-employee-fixture.mjs`, destroyed afterwards and
verified removed):

| Relation | Readable by the `dev` employee, before the change |
|---|---|
| `audit_logs_enhanced` | 967 |
| `action_type` | 6 |
| `employees` | 6 |
| `role_employees` | 3 |
| `customer` | 30 |

All five readable, so the change was predicted safe — then confirmed after
applying: the same employee still reads **967 rows through the view, with
`user_email` and `user_role` populated**.

## Verification commands, for anyone re-checking

```bash
# anon must be refused
curl -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  "$URL/rest/v1/audit_logs_view?select=user_email&limit=1"
# -> {"code":"42501","message":"permission denied for view audit_logs_view"}

# the debug view must be gone
curl -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  "$URL/rest/v1/debug_insights_linkage?select=*&limit=1"
# -> {"code":"PGRST205", ... "Could not find the table ..."}

# full re-probe
node scripts/kpi7-anon-probe.mjs <relations.txt> <out.json>
```

## What this does and does not change about KPI-7

It does **not** change any pre-registered verdict. Criterion 1 asked whether all
ten categories were *answered*, not whether they were clean, and A01 was
answered either way.

What it changes is the state of the system that will be assessed. KPI-7 is
defined in `docs/KPI_SPEC.md` as an assessment of *the system as submitted*, so
submitting a system still carrying a High finding that its own assessment had
identified would have contradicted that framing.

**Both runs are reported.** A defect found by a probe designed to be
falsifiable, then dated, fixed and re-measured, is stronger evidence that the
assessment was performed than a clean first result would have been — the same
argument already recorded for KPI-1's coverage gate and for the jspdf Critical.

## Still open for A01 — recorded, not silently closed

The root cause is corpus-wide: **no view anywhere in `supabase/migrations/`
sets `security_invoker`.** Only the two views that were *also* granted to
`anon` are fixed here. The remaining views are not `anon`-reachable, so they
are not an access-control finding today — but the same mistake recurs the
moment one is granted. This is a limitation of the fix, not a clean close.
