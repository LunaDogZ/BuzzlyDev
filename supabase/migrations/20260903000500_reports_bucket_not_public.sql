-- Close the reports bucket. It was world-readable, and this is what that meant.
--
-- `20260224153000_create_reports_bucket.sql` created the bucket with
-- `public = true` and this policy:
--
--     create policy "Reports are publicly accessible"
--       on storage.objects for select
--       using ( bucket_id = 'reports' );
--
-- No role predicate, so `anon` satisfies it. Measured against the live project
-- on 2026-09-03, before any change:
--
--   GET /storage/v1/object/public/reports/<name>   (no credentials at all)
--     -> 200 application/pdf, 1,027,850 bytes
--   POST /storage/v1/object/list/reports           (anon key)
--     -> 200, every filename in the bucket
--
-- The anon key ships inside the client bundle, so "needs the anon key" is not a
-- control: anyone who loads the site has it. Enumerate, then download. The one
-- object present was an owner-level executive report; it was backed up off the
-- project and deleted, and the bucket was switched to private the same day.
--
-- Note what the private flip alone did NOT fix: with the policy still in place,
-- `GET /storage/v1/object/reports/<name>` with the anon key kept returning 200.
-- `public = false` only retires the unauthenticated `/object/public/` route —
-- the policy is what decides the authenticated one. Both halves are needed, so
-- both are here.
--
-- Table RLS was checked at the same time and is sound: with the anon key,
-- `reports`, `profile_customers`, `employees`, `audit_logs_enhanced`,
-- `ad_insights`, `import_jobs`, `ingestion_dlq`, `error_logs`, `workspaces` and
-- `scheduled_reports` all return 0 rows. `storage.objects` is a separate policy
-- surface, which is how this one outlived the RLS passes of 08-11, 08-22 and
-- 08-28.

-- ---------------------------------------------------------------------------
-- 1. The bucket itself
-- ---------------------------------------------------------------------------

UPDATE storage.buckets SET public = false WHERE id = 'reports';

-- ---------------------------------------------------------------------------
-- 2. The policy that actually granted the read
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Reports are publicly accessible" ON storage.objects;

-- Read is now the uploader's alone. `owner` is the only identity storage keeps
-- on an object — there is no team column — so a team-scoped rule would need the
-- uploads to write under a `<team_id>/` prefix first. Until that exists, owner
-- scoping is the choice that cannot leak across tenants; "any authenticated
-- user" would have let one merchant read another's report, which is worse than
-- what is being fixed.
--
-- `(select auth.uid())` rather than a bare call, matching 20260811100100: the
-- wrapped form is evaluated once per statement instead of once per row.
CREATE POLICY "Users can read own reports"
  ON storage.objects FOR SELECT
  TO authenticated
  USING ( bucket_id = 'reports' AND owner = (select auth.uid()) );

-- ---------------------------------------------------------------------------
-- 3. The links this migration invalidates
-- ---------------------------------------------------------------------------

-- `reports.file_url` holds `getPublicUrl(...)` output, which now 404s for
-- everyone including the owner. Leaving it set makes the UI render a Download
-- button that cannot work; nulling it makes the same UI show its "not generated
-- yet" branch, and the report can still be regenerated from the history row.
-- Scoped to the public reports path so no other file_url is touched.
UPDATE public.reports
   SET file_url = NULL
 WHERE file_url LIKE '%/storage/v1/object/public/reports/%';

-- ⚠️ FOLLOW-UP, not done here: `src/lib/reportPdf.ts` and
-- `src/pages/owner/ExecutiveReport.tsx` still call `getPublicUrl` on upload, so
-- new reports keep storing a URL that will not resolve. The fix is to store the
-- object path and mint a short-lived `createSignedUrl` at click time in the two
-- download sites (`src/pages/Reports.tsx`, `src/pages/owner/ExecutiveReport.tsx`).
-- That is a code change, deliberately left out of a security migration.
-- Generating a report still downloads the PDF to the browser directly
-- (`downloadPdfBlob`), so no one loses a report they just made.
