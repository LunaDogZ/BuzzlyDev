-- KPI-7 round 3 — before-state. Read live from pg_policies on the cloud project
-- (aokzvknggtccgwbavszj) on 2026-10-07 via `supabase db query --linked`, before
-- any round-3 migration. Every policy (all commands, SELECT included) on the 21
-- tables named in round 2 "Remaining A01 findings" + storage.objects imports_*.
-- Generated from pg_policies columns by before/snapshot.sql; not hand-edited.

-- public.ad_groups DELETE
CREATE POLICY "Users can delete ad_groups if team member" ON public.ad_groups AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_team_member(( SELECT auth.uid() AS uid), team_id) OR has_role(( SELECT auth.uid() AS uid), 'admin'::app_role)));

-- public.ad_groups INSERT
CREATE POLICY "Users can insert ad_groups if team member" ON public.ad_groups AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_team_member(( SELECT auth.uid() AS uid), team_id) OR has_role(( SELECT auth.uid() AS uid), 'admin'::app_role)));

-- public.ad_groups SELECT
CREATE POLICY "Users can view ad_groups if team member" ON public.ad_groups AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_team_member(( SELECT auth.uid() AS uid), team_id) OR has_role(( SELECT auth.uid() AS uid), 'admin'::app_role)));

-- public.ad_groups UPDATE
CREATE POLICY "Users can update ad_groups if team member" ON public.ad_groups AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_team_member(( SELECT auth.uid() AS uid), team_id) OR has_role(( SELECT auth.uid() AS uid), 'admin'::app_role)))
  WITH CHECK ((is_team_member(( SELECT auth.uid() AS uid), team_id) OR has_role(( SELECT auth.uid() AS uid), 'admin'::app_role)));

-- public.ad_personas ALL
CREATE POLICY ad_personas_write ON public.ad_personas AS PERMISSIVE FOR ALL TO authenticated
  USING ((ad_id IN ( SELECT ads.id
   FROM ads
  WHERE (ads.team_id IN ( SELECT workspace_members.team_id
           FROM workspace_members
          WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid))
        UNION
         SELECT workspaces.id
           FROM workspaces
          WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid)))))));

-- public.ad_personas SELECT
CREATE POLICY ad_personas_select ON public.ad_personas AS PERMISSIVE FOR SELECT TO authenticated
  USING ((ad_id IN ( SELECT ads.id
   FROM ads
  WHERE (ads.team_id IN ( SELECT workspace_members.team_id
           FROM workspace_members
          WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid))
        UNION
         SELECT workspaces.id
           FROM workspaces
          WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid)))))));

-- public.ads DELETE
CREATE POLICY "Users can delete ads if team member" ON public.ads AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_team_member(( SELECT auth.uid() AS uid), team_id) OR has_role(( SELECT auth.uid() AS uid), 'admin'::app_role)));

-- public.ads INSERT
CREATE POLICY "Users can insert ads if team member" ON public.ads AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_team_member(( SELECT auth.uid() AS uid), team_id) OR has_role(( SELECT auth.uid() AS uid), 'admin'::app_role)));

-- public.ads SELECT
CREATE POLICY "Users can view ads if team member" ON public.ads AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_team_member(( SELECT auth.uid() AS uid), team_id) OR has_role(( SELECT auth.uid() AS uid), 'admin'::app_role)));

-- public.ads UPDATE
CREATE POLICY "Users can update ads if team member" ON public.ads AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_team_member(( SELECT auth.uid() AS uid), team_id) OR has_role(( SELECT auth.uid() AS uid), 'admin'::app_role)))
  WITH CHECK ((is_team_member(( SELECT auth.uid() AS uid), team_id) OR has_role(( SELECT auth.uid() AS uid), 'admin'::app_role)));

-- public.budgets DELETE
CREATE POLICY "Users can delete their team budgets" ON public.budgets AS PERMISSIVE FOR DELETE TO public
  USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid)))));

-- public.budgets INSERT
CREATE POLICY "Users can insert their team budgets" ON public.budgets AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid)))));

-- public.budgets SELECT
CREATE POLICY "Users can view their team budgets" ON public.budgets AS PERMISSIVE FOR SELECT TO public
  USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid)))));

-- public.budgets UPDATE
CREATE POLICY "Users can update their team budgets" ON public.budgets AS PERMISSIVE FOR UPDATE TO public
  USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid)))));

-- public.campaign_ads ALL
CREATE POLICY campaign_ads_write ON public.campaign_ads AS PERMISSIVE FOR ALL TO public
  USING ((campaign_id IN ( SELECT campaigns.id
   FROM campaigns
  WHERE (campaigns.team_id IN ( SELECT workspace_members.team_id
           FROM workspace_members
          WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid)))))))
  WITH CHECK ((campaign_id IN ( SELECT campaigns.id
   FROM campaigns
  WHERE (campaigns.team_id IN ( SELECT workspace_members.team_id
           FROM workspace_members
          WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid)))))));

-- public.campaign_ads SELECT
CREATE POLICY campaign_ads_select ON public.campaign_ads AS PERMISSIVE FOR SELECT TO public
  USING ((campaign_id IN ( SELECT campaigns.id
   FROM campaigns
  WHERE ((campaigns.team_id IN ( SELECT workspace_members.team_id
           FROM workspace_members
          WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid)))) OR (campaigns.team_id IS NULL)))));

-- public.campaign_tags ALL
CREATE POLICY "Users can manage campaign tags for their team" ON public.campaign_tags AS PERMISSIVE FOR ALL TO public
  USING ((campaign_id IN ( SELECT c.id
   FROM (campaigns c
     JOIN ad_accounts aa ON ((c.ad_account_id = aa.id)))
  WHERE (aa.team_id IN ( SELECT workspaces.id
           FROM workspaces
          WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid))
        UNION
         SELECT workspace_members.team_id
           FROM workspace_members
          WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid)))))));

-- public.campaigns DELETE
CREATE POLICY campaigns_delete_policy ON public.campaigns AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM ad_accounts aa
  WHERE ((aa.id = campaigns.ad_account_id) AND has_permission(( SELECT auth.uid() AS uid), aa.team_id, 'delete_campaigns'::text)))));

-- public.campaigns DELETE
CREATE POLICY team_campaigns_delete ON public.campaigns AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.campaigns INSERT
CREATE POLICY campaigns_insert_policy ON public.campaigns AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM ad_accounts aa
  WHERE ((aa.id = campaigns.ad_account_id) AND has_permission(( SELECT auth.uid() AS uid), aa.team_id, 'edit_campaigns'::text)))));

-- public.campaigns INSERT
CREATE POLICY team_campaigns_insert ON public.campaigns AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.campaigns SELECT
CREATE POLICY campaigns_select_policy ON public.campaigns AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (ad_accounts aa
     JOIN workspaces w ON ((w.id = aa.team_id)))
  WHERE ((aa.id = campaigns.ad_account_id) AND ((w.owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM workspace_members wm
          WHERE ((wm.team_id = w.id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))))))));

-- public.campaigns SELECT
CREATE POLICY team_campaigns_select ON public.campaigns AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.campaigns UPDATE
CREATE POLICY campaigns_update_policy ON public.campaigns AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM ad_accounts aa
  WHERE ((aa.id = campaigns.ad_account_id) AND has_permission(( SELECT auth.uid() AS uid), aa.team_id, 'edit_campaigns'::text)))));

-- public.campaigns UPDATE
CREATE POLICY team_campaigns_update ON public.campaigns AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.conversion_events ALL
CREATE POLICY "Admins can manage conversion_events" ON public.conversion_events AS PERMISSIVE FOR ALL TO authenticated
  USING ((has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'owner'::app_role)));

-- public.conversion_events INSERT
CREATE POLICY team_member_insert ON public.conversion_events AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM ad_accounts aa
  WHERE ((aa.id = conversion_events.ad_account_id) AND is_team_member(( SELECT auth.uid() AS uid), aa.team_id)))));

-- public.conversion_events SELECT
CREATE POLICY "Team members can view conversion_events" ON public.conversion_events AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM ad_accounts
  WHERE ((ad_accounts.id = conversion_events.ad_account_id) AND is_team_member(( SELECT auth.uid() AS uid), ad_accounts.team_id)))));

-- public.conversion_events SELECT
CREATE POLICY team_member_select ON public.conversion_events AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM ad_accounts aa
  WHERE ((aa.id = conversion_events.ad_account_id) AND is_team_member(( SELECT auth.uid() AS uid), aa.team_id)))));

-- public.customer_personas DELETE
CREATE POLICY "Team admins can delete personas" ON public.customer_personas AS PERMISSIVE FOR DELETE TO authenticated
  USING (has_permission(( SELECT auth.uid() AS uid), team_id, 'delete_prospects'::text));

-- public.customer_personas DELETE
CREATE POLICY personas_delete_policy ON public.customer_personas AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = customer_personas.team_id) AND ((w.owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM workspace_members wm
          WHERE ((wm.team_id = w.id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))))))));

-- public.customer_personas INSERT
CREATE POLICY "Team members can create personas" ON public.customer_personas AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (has_permission(( SELECT auth.uid() AS uid), team_id, 'edit_prospects'::text));

-- public.customer_personas INSERT
CREATE POLICY personas_insert_policy ON public.customer_personas AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = customer_personas.team_id) AND ((w.owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM workspace_members wm
          WHERE ((wm.team_id = w.id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))))))));

-- public.customer_personas SELECT
CREATE POLICY personas_select_policy ON public.customer_personas AS PERMISSIVE FOR SELECT TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = customer_personas.team_id) AND ((w.owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM workspace_members wm
          WHERE ((wm.team_id = w.id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))))))) OR (is_template = true)));

-- public.customer_personas UPDATE
CREATE POLICY "Team members can update personas" ON public.customer_personas AS PERMISSIVE FOR UPDATE TO authenticated
  USING (has_permission(( SELECT auth.uid() AS uid), team_id, 'edit_prospects'::text));

-- public.customer_personas UPDATE
CREATE POLICY personas_update_policy ON public.customer_personas AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = customer_personas.team_id) AND ((w.owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM workspace_members wm
          WHERE ((wm.team_id = w.id) AND (wm.user_id = ( SELECT auth.uid() AS uid))))))))));

-- public.email_campaigns DELETE
CREATE POLICY "Users can delete their team email campaigns" ON public.email_campaigns AS PERMISSIVE FOR DELETE TO public
  USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid)))));

-- public.email_campaigns INSERT
CREATE POLICY "Users can insert their team email campaigns" ON public.email_campaigns AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid)))));

-- public.email_campaigns SELECT
CREATE POLICY "Users can view their team email campaigns" ON public.email_campaigns AS PERMISSIVE FOR SELECT TO public
  USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid)))));

-- public.email_campaigns UPDATE
CREATE POLICY "Users can update their team email campaigns" ON public.email_campaigns AS PERMISSIVE FOR UPDATE TO public
  USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid)))));

-- public.import_jobs DELETE
CREATE POLICY import_jobs_delete ON public.import_jobs AS PERMISSIVE FOR DELETE TO authenticated
  USING (can_manage_team(( SELECT auth.uid() AS uid), team_id));

-- public.import_jobs INSERT
CREATE POLICY import_jobs_insert ON public.import_jobs AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_team_member(( SELECT auth.uid() AS uid), team_id) AND (uploaded_by = ( SELECT auth.uid() AS uid))));

-- public.import_jobs SELECT
CREATE POLICY "Dev or Owner can view all import jobs" ON public.import_jobs AS PERMISSIVE FOR SELECT TO authenticated
  USING ((has_employee_role(( SELECT auth.uid() AS uid), 'dev'::character varying) OR has_employee_role(( SELECT auth.uid() AS uid), 'owner'::character varying)));

-- public.import_jobs SELECT
CREATE POLICY import_jobs_select ON public.import_jobs AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.post_personas ALL
CREATE POLICY post_personas_write ON public.post_personas AS PERMISSIVE FOR ALL TO authenticated
  USING ((post_id IN ( SELECT social_posts.id
   FROM social_posts
  WHERE (social_posts.team_id IN ( SELECT workspace_members.team_id
           FROM workspace_members
          WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid))
        UNION
         SELECT workspaces.id
           FROM workspaces
          WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid)))))));

-- public.post_personas SELECT
CREATE POLICY post_personas_select ON public.post_personas AS PERMISSIVE FOR SELECT TO authenticated
  USING ((post_id IN ( SELECT social_posts.id
   FROM social_posts
  WHERE (social_posts.team_id IN ( SELECT workspace_members.team_id
           FROM workspace_members
          WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid))
        UNION
         SELECT workspaces.id
           FROM workspaces
          WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid)))))));

-- public.reports DELETE
CREATE POLICY "Team admins can delete reports" ON public.reports AS PERMISSIVE FOR DELETE TO public
  USING (can_manage_team(( SELECT auth.uid() AS uid), team_id));

-- public.reports INSERT
CREATE POLICY "Team members can create reports" ON public.reports AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.reports SELECT
CREATE POLICY "Team members can view reports" ON public.reports AS PERMISSIVE FOR SELECT TO public
  USING (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.reports UPDATE
CREATE POLICY "Team members can update reports" ON public.reports AS PERMISSIVE FOR UPDATE TO public
  USING (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.scheduled_reports DELETE
CREATE POLICY "Users can delete their team scheduled reports" ON public.scheduled_reports AS PERMISSIVE FOR DELETE TO public
  USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid)))));

-- public.scheduled_reports INSERT
CREATE POLICY "Users can insert their team scheduled reports" ON public.scheduled_reports AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid)))));

-- public.scheduled_reports SELECT
CREATE POLICY "Users can view their team scheduled reports" ON public.scheduled_reports AS PERMISSIVE FOR SELECT TO public
  USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid)))));

-- public.scheduled_reports UPDATE
CREATE POLICY "Users can update their team scheduled reports" ON public.scheduled_reports AS PERMISSIVE FOR UPDATE TO public
  USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid)))));

-- public.social_comments DELETE
CREATE POLICY social_comments_delete ON public.social_comments AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.social_comments INSERT
CREATE POLICY social_comments_insert ON public.social_comments AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.social_comments SELECT
CREATE POLICY social_comments_select ON public.social_comments AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.social_comments UPDATE
CREATE POLICY social_comments_update ON public.social_comments AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_team_member(( SELECT auth.uid() AS uid), team_id))
  WITH CHECK (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.social_posts ALL
CREATE POLICY "Admins can manage social_posts" ON public.social_posts AS PERMISSIVE FOR ALL TO authenticated
  USING ((has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'owner'::app_role)));

-- public.social_posts DELETE
CREATE POLICY "Team admins can delete social posts" ON public.social_posts AS PERMISSIVE FOR DELETE TO public
  USING (can_manage_team(( SELECT auth.uid() AS uid), team_id));

-- public.social_posts INSERT
CREATE POLICY "Owners can insert social posts" ON public.social_posts AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = social_posts.team_id) AND (w.owner_id = ( SELECT auth.uid() AS uid))))));

-- public.social_posts INSERT
CREATE POLICY "Team members can create social posts" ON public.social_posts AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.social_posts SELECT
CREATE POLICY "Owners can view social posts" ON public.social_posts AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = social_posts.team_id) AND (w.owner_id = ( SELECT auth.uid() AS uid))))));

-- public.social_posts SELECT
CREATE POLICY "Team members can view social posts" ON public.social_posts AS PERMISSIVE FOR SELECT TO public
  USING (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.social_posts UPDATE
CREATE POLICY "Team members can update social posts" ON public.social_posts AS PERMISSIVE FOR UPDATE TO public
  USING (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.sync_history DELETE
CREATE POLICY sync_history_delete ON public.sync_history AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.sync_history INSERT
CREATE POLICY sync_history_insert ON public.sync_history AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.sync_history SELECT
CREATE POLICY sync_history_select ON public.sync_history AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.sync_history UPDATE
CREATE POLICY sync_history_update ON public.sync_history AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_team_member(( SELECT auth.uid() AS uid), team_id))
  WITH CHECK (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.tags DELETE
CREATE POLICY "Users can delete their team tags" ON public.tags AS PERMISSIVE FOR DELETE TO public
  USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid)))));

-- public.tags INSERT
CREATE POLICY "Users can insert their team tags" ON public.tags AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid)))));

-- public.tags SELECT
CREATE POLICY "Users can view their team tags" ON public.tags AS PERMISSIVE FOR SELECT TO public
  USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid)))));

-- public.tags UPDATE
CREATE POLICY "Users can update their team tags" ON public.tags AS PERMISSIVE FOR UPDATE TO public
  USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() AS uid))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() AS uid)))));

-- public.team_activity_logs INSERT
CREATE POLICY "System can insert activity logs" ON public.team_activity_logs AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.team_activity_logs SELECT
CREATE POLICY "Team members can view activity logs" ON public.team_activity_logs AS PERMISSIVE FOR SELECT TO public
  USING (is_team_member(( SELECT auth.uid() AS uid), team_id));

-- public.workspace_ad_persona INSERT
CREATE POLICY "Workspace members can insert workspace_ad_persona" ON public.workspace_ad_persona AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_team_member(( SELECT auth.uid() AS uid), workspace_id));

-- public.workspace_ad_persona SELECT
CREATE POLICY "Workspace members can view workspace_ad_persona" ON public.workspace_ad_persona AS PERMISSIVE FOR SELECT TO public
  USING (is_team_member(( SELECT auth.uid() AS uid), workspace_id));

-- public.workspace_ad_persona UPDATE
CREATE POLICY "Workspace members can update workspace_ad_persona" ON public.workspace_ad_persona AS PERMISSIVE FOR UPDATE TO public
  USING (is_team_member(( SELECT auth.uid() AS uid), workspace_id));

-- public.workspace_api_keys DELETE
CREATE POLICY "Team members can delete API keys" ON public.workspace_api_keys AS PERMISSIVE FOR DELETE TO public
  USING (((EXISTS ( SELECT 1
   FROM workspace_members
  WHERE ((workspace_members.team_id = workspace_api_keys.team_id) AND (workspace_members.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM workspaces
  WHERE ((workspaces.id = workspace_api_keys.team_id) AND (workspaces.owner_id = ( SELECT auth.uid() AS uid)))))));

-- public.workspace_api_keys INSERT
CREATE POLICY "Team members can insert API keys" ON public.workspace_api_keys AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((EXISTS ( SELECT 1
   FROM workspace_members
  WHERE ((workspace_members.team_id = workspace_api_keys.team_id) AND (workspace_members.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM workspaces
  WHERE ((workspaces.id = workspace_api_keys.team_id) AND (workspaces.owner_id = ( SELECT auth.uid() AS uid)))))));

-- public.workspace_api_keys SELECT
CREATE POLICY "Team members can view API keys" ON public.workspace_api_keys AS PERMISSIVE FOR SELECT TO public
  USING (((EXISTS ( SELECT 1
   FROM workspace_members
  WHERE ((workspace_members.team_id = workspace_api_keys.team_id) AND (workspace_members.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM workspaces
  WHERE ((workspaces.id = workspace_api_keys.team_id) AND (workspaces.owner_id = ( SELECT auth.uid() AS uid)))))));

-- public.workspace_api_keys UPDATE
CREATE POLICY "Team members can update API keys" ON public.workspace_api_keys AS PERMISSIVE FOR UPDATE TO public
  USING (((EXISTS ( SELECT 1
   FROM workspace_members
  WHERE ((workspace_members.team_id = workspace_api_keys.team_id) AND (workspace_members.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM workspaces
  WHERE ((workspaces.id = workspace_api_keys.team_id) AND (workspaces.owner_id = ( SELECT auth.uid() AS uid)))))));

-- storage.objects DELETE
CREATE POLICY imports_delete_policy ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = 'imports'::text) AND can_manage_team(auth.uid(), try_cast_uuid((storage.foldername(name))[1]))));

-- storage.objects INSERT
CREATE POLICY imports_insert_policy ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'imports'::text) AND is_team_member(auth.uid(), try_cast_uuid((storage.foldername(name))[1]))));

-- storage.objects SELECT
CREATE POLICY imports_select_policy ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'imports'::text) AND is_team_member(auth.uid(), try_cast_uuid((storage.foldername(name))[1]))));

