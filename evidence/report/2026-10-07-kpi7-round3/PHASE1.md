# KPI-7 round 3 — Phase 1 (read-only analysis), 2026-10-07

Scope: the 21 tables in the round-2 README "Remaining A01 findings" (line 86),
plus `import_jobs` (already #2 there) and the `imports` storage bucket. Live
policies: `before/pg_policies-live.csv` and `before/policies-live.sql` (85
policies, read with `supabase db query --linked` before any change). Helper
definitions: `before/helper-functions-live.sql`. Migration:
`supabase/migrations/20261007183000_member_writes_follow_role_permissions.sql`
(**not pushed**). Rollback: `before/rollback.sql`, tested in `before/rollback-test.md`.

## How the UI decides who may write

- Role defaults: `src/hooks/useTeamManagement.tsx:88-141` (`defaultRolePermissions`).
  `has_permission()` hard-codes the same table and also honours `custom_permissions`,
  as `useTeamPermissions.tsx:50-52` does.

  | key | owner | admin | editor | viewer |
  |---|---|---|---|---|
  | edit_campaigns, edit_prospects | ✅ | ✅ | ✅ | — |
  | delete_campaigns, delete_prospects, export_data, manage_team | ✅ | ✅ | — | — |
  | manage_settings | ✅ | — | — | — |
  | view_* | ✅ | ✅ | ✅ | ✅ |

- Route guards (`TeamPermissionsGuard`, `src/App.tsx`): `/dashboard` view_dashboard :166 ·
  `/personas` view_prospects :167 · `/campaigns`, `/campaigns/:id` view_campaigns :169-170 ·
  `/social/*` view_dashboard :175 · `/analytics` :187, `/reports` :188 view_analytics ·
  `/api-keys` :184, `/imports` :185, `/settings` :189 manage_settings · `/team` manage_team :190.
- **Action-level gates exist in one file only:** `src/pages/Campaigns.tsx:564, :592`
  (`edit_campaigns`) and `:608` (`delete_campaigns`). Searched for `canAccess(`,
  `permissions.*`, role-string comparisons, `isViewer`/`readOnly`: no other page
  hides a write control by role. On every other page a viewer sees the create /
  edit / delete buttons of any page their route guard lets them open.
  **Consequence of the fix:** on those pages a viewer's click now gets an RLS
  error instead of succeeding. The UI still shows the button. No frontend change
  (scope guard).

## Per table

"Dropped" = membership-only write policies removed by the migration (live
expressions in `before/policies-live.sql`). Credentials: **JWT** = browser,
user's token, RLS applies; **SR** = service_role, bypasses RLS.

| # | Table | Dropped (live) | UI writers (file:line) → page → guard | Other writers | Proposed rule |
|---|---|---|---|---|---|
| 1 | `workspace_api_keys` | "Team members can insert / update / delete API keys" | `usePlatformConnections.tsx:369, :466, :549, :609` → APIKeys → manage_settings | `meta-oauth/index.ts:328` SR; `meta-sync/index.ts:106, :334` SR | I/U/D: `manage_settings` |
| 2 | `import_jobs` | `import_jobs_insert` (re-created) | `useImportJobs.tsx:256` (storage upload), `:262` (insert) → Imports → manage_settings | `airflow-trigger/index.ts:117, :158, :183` SR; AFTER INSERT trigger → pipeline SR | INSERT: `manage_settings` AND `uploaded_by = caller`. DELETE already `can_manage_team` |
| 2b | storage `imports` | `imports_insert_policy` (re-created) | same upload | — | INSERT: `manage_settings` on folder[1]. DELETE already `can_manage_team` (the client's orphan cleanup, `useImportJobs.tsx:278`) |
| 3 | `ads` | "Users can insert / update / delete ads if team member" | `useAds.tsx:121, :144, :259`; `useAdGroups.tsx:98, :229, :314, :331`; RPC `create_ad_with_mirror_post` `useAds.tsx:223` (SECURITY INVOKER) → CampaignDetail, SocialPlanner, AdAllocator | `create-platform-ad`, `campaign-auto-stop` SR; `auto_stop_completed_campaigns()` DEFINER | I/U: `edit_campaigns`; D: `delete_campaigns`. The `OR has_role(…,'admin'::app_role)` staff branch is copied verbatim |
| 4 | `ad_groups` | "Users can insert / update / delete ad_groups if team member" | `useAdGroups.tsx:162, :181, :201` → SocialPlanner, SocialAnalyticsView (/social) | mock-api SR | same as ads |
| 5 | `campaigns` | `team_campaigns_insert / update / delete` | `useCampaigns.tsx:251, :320, :370` → Campaigns (gated :564/:592/:608), CampaignDetail, Prospects, CreateBudgetDialog | `campaign-auto-stop` SR; `auto_stop_completed_campaigns()` DEFINER | I/U: `edit_campaigns`; D: `delete_campaigns`, on `team_id`. The existing `campaigns_*_policy` siblings match only via `ad_account_id`; the insert path does not require one (all 34 live campaigns have one) |
| 6 | `campaign_ads` | `campaign_ads_write` (ALL) | `useCampaigns.tsx:264, :335, :342` | mock-api SR; `promote_batch` | I/U/D: `edit_campaigns` via the campaign's team. Reads stay with `campaign_ads_select` (a superset of the dropped ALL policy's USING) |
| 7 | `campaign_tags` | "Users can manage campaign tags for their team" (ALL; also the only read path) | `useTags.tsx:103, :118` → CampaignDetail | — | **Split (founder decision):** SELECT with identical USING + I/U/D `edit_campaigns` via campaign → ad_account → team (the same path as the read) |
| 8 | `budgets` | "Users can insert / update / delete their team budgets" | `useBudgets.tsx:82, :113, :129, :144` → Settings → manage_settings | trigger `notify_on_budget_alert` (reads) | I/U/D: `manage_settings` |
| 9 | `customer_personas` | `personas_insert / update / delete_policy` | `useCustomerPersonas.tsx:121, :167, :212` → Prospects, CreatePersonaDialog | mock-api SR | Drop only. The role-aware siblings stay: "Team members can create / update personas" (`edit_prospects`), "Team admins can delete personas" (`delete_prospects`) |
| 10 | `ad_personas` | `ad_personas_write` (ALL) | `useAds.tsx:299, :307` | mock-api SR | I/U/D: `edit_campaigns` via the ad's team. Reads: `ad_personas_select` (identical USING) |
| 11 | `post_personas` | `post_personas_write` (ALL) | `usePostPersonaLinks.tsx:17, :25` → SocialPlanner | — | I/U/D: `edit_campaigns` via the post's team (**founder decision**). Reads: `post_personas_select` (identical USING) |
| 12 | `workspace_ad_persona` | "Workspace members can insert / update workspace_ad_persona" | `useWorkspaceAdPersona.tsx:77, :109` (upsert) → Prospects | — | I/U: `edit_prospects` |
| 13 | `social_posts` | "Team members can create / update social posts" | `useSocialPosts.tsx:132, :154, :174`; `useAds.tsx:158, :253`; `useAdGroups.tsx:65, :239, :378, :395`; RPC above → SocialPlanner etc. `useAdPosts.tsx` is used only by `Email.tsx`, which has no route | mock-api SR | I/U: `edit_campaigns` (**founder decision**; it must match ads because the RPC writes both). Kept: DELETE `can_manage_team`, "Owners can insert social posts", staff ALL |
| 14 | `social_comments` | `social_comments_insert / update / delete` | `useSocialComments.tsx:61, :83, :107, :128` → SocialInbox (/social) | mock-api SR | I/U/D: `edit_campaigns` (**founder decision**). A viewer can no longer mark comments read or reply |
| 15 | `reports` | "Team members can create / update reports" | `useReports.tsx:79, :130` → Reports (/reports, view_analytics); also employee page `owner/ExecutiveReport.tsx:148` | — | I/U: `export_data` (**founder decision**). DELETE stays `can_manage_team` |
| 16 | `scheduled_reports` | "Users can insert / update / delete their team scheduled reports" | `useScheduledReports.tsx:83, :115, :131, :146`, used **only** by employee page `owner/ExecutiveReport.tsx:218, :540, :546` | `process_scheduled_reports_with_preferences()` DEFINER | I/U/D: `export_data` (**founder decision**) |
| 17 | `email_campaigns` | "Users can insert / update / delete their team email campaigns" | **none** | — | I/U/D: `export_data` (follows reports, **founder decision**) |
| 18 | `tags` | "Users can insert / update / delete their team tags" | `useTags.tsx:62, :87` → CampaignDetail | — | I/U/D: `edit_campaigns` — see open item O-1 |
| 19 | `sync_history` | `sync_history_insert / update / delete` | **none** | `meta-sync/index.ts:119, :321` SR; `promote_batch` (Airflow, SR); mock-api SR | **Drop, no replacement** (founder decision). The table has **no user column**, so the "own rows" rule the brief suggested cannot be expressed |
| 20 | `conversion_events` | `team_member_insert` | **none** | `mock-api/scripts/seed-to-supabase.ts:624` (key from env, "service_role recommended") | **Drop, no replacement** (founder decision). Staff "Admins can manage conversion_events" unchanged |
| 21 | `team_activity_logs` | "System can insert activity logs" | `useTeamManagement.tsx:404, :445, :485, :528, :568, :608, :648` (manager actions on /team) and `:703` `invitation_accepted`, written by the **accepting member** (`NotificationCenterDialog.tsx:98`, `SidebarBottomSection.tsx:486`) after their active membership row is inserted (`:690-699`) | — | **Own rows:** `is_team_member` AND `user_id = caller`. Not removed, because every member legitimately writes one entry. See O-2 |

`has_role(uid, app_role)` reads `public.user_roles`. Live holders today: `owner` 2,
`dev` 4, `support` 2, `customer` 30, `admin` 0. These are staff paths. They are
left unchanged, and where they sit inside a dropped policy (ads, ad_groups) they
are carried over verbatim.

## Q5 — can a viewer write `workspace_api_keys` so that meta-sync fetches an ad account of their choice into `ad_insights`?

**No, from code and policies. Not probed.** `meta-sync` never *reads*
`workspace_api_keys`; it only writes status to it (`meta-sync/index.ts:106-113`,
`:334-337`). What it fetches is decided by:

1. `adAccountId` from the request body, looked up with SR in `ad_accounts`, which
   must have `team_id` = the workspace the caller is a member of (`:209-218`) and
   be a Meta account (`:229-238`);
2. the token from `platform_oauth_tokens` (`:248-253`), a table with **no
   policies**: no client role can read or write it (`src/lib/metaOAuth.ts:75`).
   Only `meta-oauth` writes it, with SR, after its own `can_manage_team` check;
3. the Graph account id = `ad_accounts.platform_account_id`, falling back to
   `platform_oauth_tokens.external_account_id` (`:273`). `ad_accounts` writes have
   required `can_manage_team` since round 2 (`20261007101000`).

So the account fetched is chosen only by data a viewer cannot write. A viewer
*can* trigger a re-fetch of the workspace's own connected account. That is the
known limitation already accepted as founder decision B in round 2.
`workspace_api_keys.access_token` is not used by any sync path. Until this
migration, though, a viewer could overwrite or delete the row, which turns the
integration card's status false. That is closed by row 1.

## Open items: rules I could not settle from the code

- **O-1 `tags` DELETE.** I used `edit_campaigns`, on the reading that removing a
  label is editing, not deleting a campaign. `delete_campaigns` (owner/admin)
  would also be defensible. The UI gives no signal, because CampaignDetail has no
  gate. Please confirm.
- **O-2 `team_activity_logs`.** With the own-rows rule, a viewer can still insert
  entries in their own name with any `action` text, for example a fake
  "member_removed". Closing that needs either `can_manage_team` for every action
  except `invitation_accepted`, or moving the log write into the database (out of
  scope: frontend). The current rule stops forging *other people's* entries, which
  is what the brief asked for.
- **O-3 `reports` is NULL-able on `team_id`** and the hook reads
  `team_id.is.null` rows (`useReports.tsx:65`). Neither the old nor the new
  INSERT can create one (`is_team_member` / `has_permission` with NULL is false).
  No change, noted only.

## Found outside the round-2 list (reported, NOT in this migration)

- **N-1 `process_scheduled_reports_with_preferences()`.** SECURITY DEFINER,
  EXECUTE granted to `anon` and `authenticated`, no caller check. It iterates
  **every workspace's** due `scheduled_reports`, returns
  `report_id, recipient_user_id, recipient_email, report_name` for recipients with
  email reports enabled, and advances `next_run_at` on each. Anyone holding the
  public anon key could, by reading the code, (a) read recipient emails and user ids
  across tenants and (b) push every due schedule forward so the real cron sends
  nothing. **Static only; not exercised.**
- **N-2 `auto_stop_completed_campaigns()`.** SECURITY DEFINER, EXECUTE to `anon`
  and `authenticated`. It sets `campaigns.status='completed'` and pauses `ads` for
  every campaign that already meets its own 100% criterion, across all tenants. A
  caller can only make it happen earlier than the cron would, but it is still an
  anon-triggered cross-tenant write.
- **N-3 `promote_batch(...)`.** SECURITY INVOKER, EXECUTE to `anon` and
  `authenticated`. It runs under the caller's RLS, so it cannot write anything the
  caller couldn't. Noted for completeness.

Fixing N-1 and N-2 means `REVOKE EXECUTE … FROM anon, authenticated`. Note the
.106 segfault caveat in round 2 §4: the cloud image .084 is unaffected.
**Your call** whether that belongs in round 3 or later.

## Before you push

`supabase db push --linked --dry-run` (`before/db-push-dry-run.txt`) would push
exactly one file: `20261007183000_member_writes_follow_role_permissions.sql`.

## Resolution of the open items (founder, 2026-10-07)

O-1 `tags` DELETE: `edit_campaigns` confirmed. O-2 `team_activity_logs`: own
rows accepted; the forged-action-text residual is recorded under **A09** in
`README.md`. N-1/N-2: fixed in round 3 after a sweep of every function; see
`FUNCTIONS.md` and `20261007190000_revoke_unscoped_definer_functions.sql`.
