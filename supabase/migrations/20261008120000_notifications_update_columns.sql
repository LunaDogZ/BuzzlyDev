-- Notifications: clients may change read/archive state, never content or link.
--
-- Live state before this migration (read from pg_policies and
-- information_schema.column_privileges on 2026-10-08, not from migration files):
--
--   * notifications — UPDATE policy "Employees can mark notifications as read"
--     is TO public, USING (target_role = 'all' OR <active employee of that
--     role>), WITH CHECK (true). anon and authenticated both hold UPDATE on
--     every column. So any caller — the bare anon key included — could rewrite
--     `link` on a target_role = 'all' notification shown to every employee.
--   * workspace_notifications — "Users can update own workspace notifications
--     (mark read)" lets a user update every column of their own rows, `link`
--     included.
--
-- `link` is passed to react-router's navigate() in three components, so a
-- writable link is an open-redirect sink (GHSA-wrjc on react-router 6).
--
-- RLS policies cannot restrict columns; column privileges can. The granted
-- columns are exactly the ones the app updates (useNotifications.tsx:
-- is_read, is_archived, deleted_at; useWorkspaceNotifications.ts: is_read).
-- Inserts and server-side writes (service_role, SECURITY DEFINER functions)
-- are unaffected. The policies themselves are left as they are: with UPDATE
-- revoked from anon, their TO public no longer reaches it.

REVOKE UPDATE ON public.notifications FROM anon, authenticated;
GRANT UPDATE (is_read, is_archived, deleted_at) ON public.notifications TO authenticated;

REVOKE UPDATE ON public.workspace_notifications FROM anon, authenticated;
GRANT UPDATE (is_read) ON public.workspace_notifications TO authenticated;
