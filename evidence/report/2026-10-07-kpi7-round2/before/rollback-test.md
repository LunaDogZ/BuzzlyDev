# rollback.sql — tested on a local replica, 2026-10-07

Replica: `public.ecr.aws/supabase/postgres:17.6.1.084` (the cloud project's
image per `supabase projects list -o json`), loaded from the same 13:43 dump.
Restore produced 2 errors, both `function auth.jwt() does not exist` on two
`employees` policies — a stock-image gap, unrelated to ad_insights/ad_accounts.

Snapshot query: `rollback-test-snapshot.sql` (every policy on both tables with
its expressions, plus the function's ACL and md5 of its definition).

| Path | Result |
|---|---|
| dump → 20261007101000 → 20261007120000 → rollback.sql | policies + function **identical** to the dump state (`diff` empty) |
| dump → 20261007101000 only (= cloud now) → rollback.sql | policies identical; function ACL has the same 5 grantees (PUBLIC, postgres, anon, authenticated, service_role) in a different order — same privileges |
| after 20261007101000, replica ACL | `{postgres=X/postgres,service_role=X/postgres}` — matches the cloud's live ACL read the same day |

Function definition md5 is unchanged across all states
(`912a1f1578ea5ea2583988df94c3fcea`).
