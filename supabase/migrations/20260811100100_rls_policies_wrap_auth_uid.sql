-- Wrap auth.uid() / auth.jwt() in a scalar subquery in every RLS policy.
--
-- Unwrapped, `auth.uid()` is evaluated once per row the policy filters; wrapped
-- as `(SELECT auth.uid())` the planner hoists it into an InitPlan and evaluates
-- it once per query.  Supabase rates this HIGH impact ("100x+ on large tables").
--
-- Live cloud catalog on 2026-08-11, before this migration:
--   402 policies in `public` · 321 call auth.uid() · 2 call auth.jwt()
--   · 0 wrapped either.  322 policies are touched here (one uses only jwt()).
--
-- Generated from pg_policy rather than written by hand, so what goes back is the
-- expression Postgres itself deparsed with only the auth.* token substituted.
-- ALTER POLICY (not DROP + CREATE) is used deliberately: roles, command, and
-- permissive-vs-restrictive are never named here, so they cannot be changed by
-- accident.
--
-- Behaviour is unchanged: a scalar subquery over a STABLE function returns what
-- the bare call returns.  Verified by restoring this project's cloud schema into
-- a throwaway Postgres, applying this file, and re-running the catalog check.
--
-- Note for whoever regenerates this: two policies on `public.employees` call
-- auth.jwt(), which the stock supabase/postgres image does not define, so they
-- silently fail to restore and a replica built without a stub is missing them.
-- That is how a first pass at this file came out at 320 instead of 322.

ALTER POLICY "Admins can view all prospects" ON public._deprecated_prospects USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Users can delete their own prospects" ON public._deprecated_prospects USING ((( SELECT auth.uid() ) = user_id));
ALTER POLICY "Users can insert their own prospects" ON public._deprecated_prospects WITH CHECK ((( SELECT auth.uid() ) = user_id));
ALTER POLICY "Users can update their own prospects" ON public._deprecated_prospects USING ((( SELECT auth.uid() ) = user_id));
ALTER POLICY "Users can view their own prospects" ON public._deprecated_prospects USING ((( SELECT auth.uid() ) = user_id));
ALTER POLICY "Admins can manage aarrr_categories" ON public.aarrr_categories USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.aarrr_categories USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can manage action_type" ON public.action_type USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.action_type USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can view all ad accounts" ON public.ad_accounts USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Employees can view all ad accounts" ON public.ad_accounts USING ((has_employee_role(( SELECT auth.uid() ), 'support'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'owner'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'dev'::character varying)));
ALTER POLICY "RLS_AdAccounts_V3" ON public.ad_accounts USING ((EXISTS ( SELECT 1
   FROM workspace_members
  WHERE ((workspace_members.team_id = ad_accounts.team_id) AND (workspace_members.user_id = ( SELECT auth.uid() )) AND (workspace_members.status = 'active'::member_status)))));
ALTER POLICY "Support employees can update ad accounts" ON public.ad_accounts USING ((has_employee_role(( SELECT auth.uid() ), 'support'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'owner'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'dev'::character varying)));
ALTER POLICY "Team admins can delete ad_accounts" ON public.ad_accounts USING (can_manage_team(( SELECT auth.uid() ), team_id));
ALTER POLICY "Team members can insert ad accounts" ON public.ad_accounts WITH CHECK (((EXISTS ( SELECT 1
   FROM workspace_members
  WHERE ((workspace_members.team_id = ad_accounts.team_id) AND (workspace_members.user_id = ( SELECT auth.uid() ))))) OR (EXISTS ( SELECT 1
   FROM workspaces
  WHERE ((workspaces.id = ad_accounts.team_id) AND (workspaces.owner_id = ( SELECT auth.uid() )))))));
ALTER POLICY "Team members can insert ad_accounts" ON public.ad_accounts WITH CHECK (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY "Team members can update ad_accounts" ON public.ad_accounts USING (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY "Team members can view ad accounts" ON public.ad_accounts USING (((EXISTS ( SELECT 1
   FROM workspace_members
  WHERE ((workspace_members.team_id = ad_accounts.team_id) AND (workspace_members.user_id = ( SELECT auth.uid() ))))) OR (EXISTS ( SELECT 1
   FROM workspaces
  WHERE ((workspaces.id = ad_accounts.team_id) AND (workspaces.owner_id = ( SELECT auth.uid() )))))));
ALTER POLICY team_admin_delete ON public.ad_accounts USING (can_manage_team(( SELECT auth.uid() ), team_id));
ALTER POLICY team_member_insert ON public.ad_accounts WITH CHECK (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY team_member_select ON public.ad_accounts USING (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY team_member_update ON public.ad_accounts USING (is_team_member(( SELECT auth.uid() ), team_id)) WITH CHECK (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY "Admins can manage ad_buying_types" ON public.ad_buying_types USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.ad_buying_types USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Users can delete ad_groups if team member" ON public.ad_groups USING ((is_team_member(( SELECT auth.uid() ), team_id) OR has_role(( SELECT auth.uid() ), 'admin'::app_role)));
ALTER POLICY "Users can insert ad_groups if team member" ON public.ad_groups WITH CHECK ((is_team_member(( SELECT auth.uid() ), team_id) OR has_role(( SELECT auth.uid() ), 'admin'::app_role)));
ALTER POLICY "Users can update ad_groups if team member" ON public.ad_groups USING ((is_team_member(( SELECT auth.uid() ), team_id) OR has_role(( SELECT auth.uid() ), 'admin'::app_role))) WITH CHECK ((is_team_member(( SELECT auth.uid() ), team_id) OR has_role(( SELECT auth.uid() ), 'admin'::app_role)));
ALTER POLICY "Users can view ad_groups if team member" ON public.ad_groups USING ((is_team_member(( SELECT auth.uid() ), team_id) OR has_role(( SELECT auth.uid() ), 'admin'::app_role)));
ALTER POLICY "Admins can manage ad_insights" ON public.ad_insights USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "RLS_Insights_V3" ON public.ad_insights USING ((EXISTS ( SELECT 1
   FROM (ad_accounts aa
     JOIN workspace_members tm ON ((aa.team_id = tm.team_id)))
  WHERE ((aa.id = ad_insights.ad_account_id) AND (tm.user_id = ( SELECT auth.uid() )) AND (tm.status = 'active'::member_status)))));
ALTER POLICY "Team members can insert ad insights" ON public.ad_insights WITH CHECK (((EXISTS ( SELECT 1
   FROM (ad_accounts aa
     JOIN workspace_members wm ON ((wm.team_id = aa.team_id)))
  WHERE ((aa.id = ad_insights.ad_account_id) AND (wm.user_id = ( SELECT auth.uid() ))))) OR (EXISTS ( SELECT 1
   FROM (ad_accounts aa
     JOIN workspaces w ON ((w.id = aa.team_id)))
  WHERE ((aa.id = ad_insights.ad_account_id) AND (w.owner_id = ( SELECT auth.uid() )))))));
ALTER POLICY "Team members can view ad insights" ON public.ad_insights USING (((EXISTS ( SELECT 1
   FROM (ad_accounts aa
     JOIN workspace_members wm ON ((wm.team_id = aa.team_id)))
  WHERE ((aa.id = ad_insights.ad_account_id) AND (wm.user_id = ( SELECT auth.uid() ))))) OR (EXISTS ( SELECT 1
   FROM (ad_accounts aa
     JOIN workspaces w ON ((w.id = aa.team_id)))
  WHERE ((aa.id = ad_insights.ad_account_id) AND (w.owner_id = ( SELECT auth.uid() )))))));
ALTER POLICY team_admin_delete ON public.ad_insights USING ((EXISTS ( SELECT 1
   FROM ad_accounts aa
  WHERE ((aa.id = ad_insights.ad_account_id) AND can_manage_team(( SELECT auth.uid() ), aa.team_id)))));
ALTER POLICY team_member_insert ON public.ad_insights WITH CHECK ((EXISTS ( SELECT 1
   FROM ad_accounts aa
  WHERE ((aa.id = ad_insights.ad_account_id) AND is_team_member(( SELECT auth.uid() ), aa.team_id)))));
ALTER POLICY team_member_select ON public.ad_insights USING ((EXISTS ( SELECT 1
   FROM ad_accounts aa
  WHERE ((aa.id = ad_insights.ad_account_id) AND is_team_member(( SELECT auth.uid() ), aa.team_id)))));
ALTER POLICY team_member_update ON public.ad_insights USING ((EXISTS ( SELECT 1
   FROM ad_accounts aa
  WHERE ((aa.id = ad_insights.ad_account_id) AND is_team_member(( SELECT auth.uid() ), aa.team_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ad_accounts aa
  WHERE ((aa.id = ad_insights.ad_account_id) AND is_team_member(( SELECT auth.uid() ), aa.team_id)))));
ALTER POLICY ad_personas_select ON public.ad_personas USING ((ad_id IN ( SELECT ads.id
   FROM ads
  WHERE (ads.team_id IN ( SELECT workspace_members.team_id
           FROM workspace_members
          WHERE (workspace_members.user_id = ( SELECT auth.uid() ))
        UNION
         SELECT workspaces.id
           FROM workspaces
          WHERE (workspaces.owner_id = ( SELECT auth.uid() )))))));
ALTER POLICY ad_personas_write ON public.ad_personas USING ((ad_id IN ( SELECT ads.id
   FROM ads
  WHERE (ads.team_id IN ( SELECT workspace_members.team_id
           FROM workspace_members
          WHERE (workspace_members.user_id = ( SELECT auth.uid() ))
        UNION
         SELECT workspaces.id
           FROM workspaces
          WHERE (workspaces.owner_id = ( SELECT auth.uid() )))))));
ALTER POLICY "Users can delete ads if team member" ON public.ads USING ((is_team_member(( SELECT auth.uid() ), team_id) OR has_role(( SELECT auth.uid() ), 'admin'::app_role)));
ALTER POLICY "Users can insert ads if team member" ON public.ads WITH CHECK ((is_team_member(( SELECT auth.uid() ), team_id) OR has_role(( SELECT auth.uid() ), 'admin'::app_role)));
ALTER POLICY "Users can update ads if team member" ON public.ads USING ((is_team_member(( SELECT auth.uid() ), team_id) OR has_role(( SELECT auth.uid() ), 'admin'::app_role))) WITH CHECK ((is_team_member(( SELECT auth.uid() ), team_id) OR has_role(( SELECT auth.uid() ), 'admin'::app_role)));
ALTER POLICY "Users can view ads if team member" ON public.ads USING ((is_team_member(( SELECT auth.uid() ), team_id) OR has_role(( SELECT auth.uid() ), 'admin'::app_role)));
ALTER POLICY "Admins can manage attribution_types" ON public.attribution_types USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.attribution_types USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Approved admins can view audit logs" ON public.audit_logs_enhanced USING ((EXISTS ( SELECT 1
   FROM (employees e
     JOIN role_employees r ON ((e.role_employees_id = r.id)))
  WHERE ((e.user_id = ( SELECT auth.uid() )) AND ((e.status)::text = 'active'::text) AND ((e.approval_status)::text = 'approved'::text) AND ((r.role_name)::text = ANY (ARRAY[('admin'::character varying)::text, ('owner'::character varying)::text, ('Admin'::character varying)::text, ('Owner'::character varying)::text]))))));
ALTER POLICY "Dev or Owner can view audit logs" ON public.audit_logs_enhanced USING ((has_employee_role(( SELECT auth.uid() ), 'dev'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'owner'::character varying)));
ALTER POLICY "Users can delete their team budgets" ON public.budgets USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() ))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() )))));
ALTER POLICY "Users can insert their team budgets" ON public.budgets WITH CHECK ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() ))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() )))));
ALTER POLICY "Users can update their team budgets" ON public.budgets USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() ))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() )))));
ALTER POLICY "Users can view their team budgets" ON public.budgets USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() ))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() )))));
ALTER POLICY "Admins can manage business types" ON public.business_types USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.business_types USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY campaign_ads_select ON public.campaign_ads USING ((campaign_id IN ( SELECT campaigns.id
   FROM campaigns
  WHERE ((campaigns.team_id IN ( SELECT workspace_members.team_id
           FROM workspace_members
          WHERE (workspace_members.user_id = ( SELECT auth.uid() )))) OR (campaigns.team_id IS NULL)))));
ALTER POLICY campaign_ads_write ON public.campaign_ads USING ((campaign_id IN ( SELECT campaigns.id
   FROM campaigns
  WHERE (campaigns.team_id IN ( SELECT workspace_members.team_id
           FROM workspace_members
          WHERE (workspace_members.user_id = ( SELECT auth.uid() ))))))) WITH CHECK ((campaign_id IN ( SELECT campaigns.id
   FROM campaigns
  WHERE (campaigns.team_id IN ( SELECT workspace_members.team_id
           FROM workspace_members
          WHERE (workspace_members.user_id = ( SELECT auth.uid() )))))));
ALTER POLICY "Users can manage campaign tags for their team" ON public.campaign_tags USING ((campaign_id IN ( SELECT c.id
   FROM (campaigns c
     JOIN ad_accounts aa ON ((c.ad_account_id = aa.id)))
  WHERE (aa.team_id IN ( SELECT workspaces.id
           FROM workspaces
          WHERE (workspaces.owner_id = ( SELECT auth.uid() ))
        UNION
         SELECT workspace_members.team_id
           FROM workspace_members
          WHERE (workspace_members.user_id = ( SELECT auth.uid() )))))));
ALTER POLICY campaigns_delete_policy ON public.campaigns USING ((EXISTS ( SELECT 1
   FROM ad_accounts aa
  WHERE ((aa.id = campaigns.ad_account_id) AND has_permission(( SELECT auth.uid() ), aa.team_id, 'delete_campaigns'::text)))));
ALTER POLICY campaigns_insert_policy ON public.campaigns WITH CHECK ((EXISTS ( SELECT 1
   FROM ad_accounts aa
  WHERE ((aa.id = campaigns.ad_account_id) AND has_permission(( SELECT auth.uid() ), aa.team_id, 'edit_campaigns'::text)))));
ALTER POLICY campaigns_select_policy ON public.campaigns USING ((EXISTS ( SELECT 1
   FROM (ad_accounts aa
     JOIN workspaces w ON ((w.id = aa.team_id)))
  WHERE ((aa.id = campaigns.ad_account_id) AND ((w.owner_id = ( SELECT auth.uid() )) OR (EXISTS ( SELECT 1
           FROM workspace_members wm
          WHERE ((wm.team_id = w.id) AND (wm.user_id = ( SELECT auth.uid() ))))))))));
ALTER POLICY campaigns_update_policy ON public.campaigns USING ((EXISTS ( SELECT 1
   FROM ad_accounts aa
  WHERE ((aa.id = campaigns.ad_account_id) AND has_permission(( SELECT auth.uid() ), aa.team_id, 'edit_campaigns'::text)))));
ALTER POLICY team_campaigns_delete ON public.campaigns USING (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY team_campaigns_insert ON public.campaigns WITH CHECK (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY team_campaigns_select ON public.campaigns USING (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY team_campaigns_update ON public.campaigns USING (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY "Team admins can manage cohort analysis" ON public.cohort_analysis USING (can_manage_team(( SELECT auth.uid() ), team_id));
ALTER POLICY "Team members can view cohort analysis" ON public.cohort_analysis USING (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY admin_owner_manage ON public.cohort_analysis USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY team_member_select ON public.cohort_analysis USING (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY "Admins can manage conversion_events" ON public.conversion_events USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Team members can view conversion_events" ON public.conversion_events USING ((EXISTS ( SELECT 1
   FROM ad_accounts
  WHERE ((ad_accounts.id = conversion_events.ad_account_id) AND is_team_member(( SELECT auth.uid() ), ad_accounts.team_id)))));
ALTER POLICY team_member_insert ON public.conversion_events WITH CHECK ((EXISTS ( SELECT 1
   FROM ad_accounts aa
  WHERE ((aa.id = conversion_events.ad_account_id) AND is_team_member(( SELECT auth.uid() ), aa.team_id)))));
ALTER POLICY team_member_select ON public.conversion_events USING ((EXISTS ( SELECT 1
   FROM ad_accounts aa
  WHERE ((aa.id = conversion_events.ad_account_id) AND is_team_member(( SELECT auth.uid() ), aa.team_id)))));
ALTER POLICY "Admins can manage countries" ON public.countries USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.countries USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.currencies USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can update customers" ON public.customer USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can view all customers" ON public.customer USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Employees can update customer tier" ON public.customer USING (is_employee(( SELECT auth.uid() )));
ALTER POLICY "Employees can view all customers" ON public.customer USING (is_employee(( SELECT auth.uid() )));
ALTER POLICY "Users can update own customer" ON public.customer USING ((( SELECT auth.uid() ) = id));
ALTER POLICY "Users can update their own customer profile" ON public.customer USING ((( SELECT auth.uid() ) = id)) WITH CHECK ((( SELECT auth.uid() ) = id));
ALTER POLICY "Users can view own customer" ON public.customer USING ((( SELECT auth.uid() ) = id));
ALTER POLICY "Admins can manage customer_activities" ON public.customer_activities USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_select ON public.customer_activities USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY owner_insert ON public.customer_activities WITH CHECK ((EXISTS ( SELECT 1
   FROM profile_customers pc
  WHERE ((pc.id = customer_activities.profile_customer_id) AND (pc.user_id = ( SELECT auth.uid() ))))));
ALTER POLICY owner_select ON public.customer_activities USING ((EXISTS ( SELECT 1
   FROM profile_customers pc
  WHERE ((pc.id = customer_activities.profile_customer_id) AND (pc.user_id = ( SELECT auth.uid() ))))));
ALTER POLICY "Users can collect coupons themselves" ON public.customer_coupons WITH CHECK ((( SELECT auth.uid() ) = customer_id));
ALTER POLICY "Users can view their collected coupons" ON public.customer_coupons USING ((( SELECT auth.uid() ) = customer_id));
ALTER POLICY "Users can update their own notifications" ON public.customer_notifications USING ((( SELECT auth.uid() ) = customer_id));
ALTER POLICY "Users can view their own notifications" ON public.customer_notifications USING ((( SELECT auth.uid() ) = customer_id));
ALTER POLICY "Team admins can delete personas" ON public.customer_personas USING (has_permission(( SELECT auth.uid() ), team_id, 'delete_prospects'::text));
ALTER POLICY "Team members can create personas" ON public.customer_personas WITH CHECK (has_permission(( SELECT auth.uid() ), team_id, 'edit_prospects'::text));
ALTER POLICY "Team members can update personas" ON public.customer_personas USING (has_permission(( SELECT auth.uid() ), team_id, 'edit_prospects'::text));
ALTER POLICY personas_delete_policy ON public.customer_personas USING ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = customer_personas.team_id) AND ((w.owner_id = ( SELECT auth.uid() )) OR (EXISTS ( SELECT 1
           FROM workspace_members wm
          WHERE ((wm.team_id = w.id) AND (wm.user_id = ( SELECT auth.uid() ))))))))));
ALTER POLICY personas_insert_policy ON public.customer_personas WITH CHECK ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = customer_personas.team_id) AND ((w.owner_id = ( SELECT auth.uid() )) OR (EXISTS ( SELECT 1
           FROM workspace_members wm
          WHERE ((wm.team_id = w.id) AND (wm.user_id = ( SELECT auth.uid() ))))))))));
ALTER POLICY personas_select_policy ON public.customer_personas USING (((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = customer_personas.team_id) AND ((w.owner_id = ( SELECT auth.uid() )) OR (EXISTS ( SELECT 1
           FROM workspace_members wm
          WHERE ((wm.team_id = w.id) AND (wm.user_id = ( SELECT auth.uid() ))))))))) OR (is_template = true)));
ALTER POLICY personas_update_policy ON public.customer_personas USING ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = customer_personas.team_id) AND ((w.owner_id = ( SELECT auth.uid() )) OR (EXISTS ( SELECT 1
           FROM workspace_members wm
          WHERE ((wm.team_id = w.id) AND (wm.user_id = ( SELECT auth.uid() ))))))))));
ALTER POLICY "Admins can manage data_pipeline" ON public.data_pipeline USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can view data_pipeline" ON public.data_pipeline USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_only ON public.data_pipeline USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can manage deployment_pipeline" ON public.deployment_pipeline USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can view deployment_pipeline" ON public.deployment_pipeline USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_only ON public.deployment_pipeline USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Employees can create discounts" ON public.discounts WITH CHECK ((has_employee_role(( SELECT auth.uid() ), 'support'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'owner'::character varying)));
ALTER POLICY "Employees can delete discounts" ON public.discounts USING ((has_employee_role(( SELECT auth.uid() ), 'support'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'owner'::character varying)));
ALTER POLICY "Employees can update discounts" ON public.discounts USING ((has_employee_role(( SELECT auth.uid() ), 'support'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'owner'::character varying))) WITH CHECK ((has_employee_role(( SELECT auth.uid() ), 'support'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'owner'::character varying)));
ALTER POLICY "Employees can view all discounts" ON public.discounts USING ((has_employee_role(( SELECT auth.uid() ), 'support'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'owner'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'dev'::character varying)));
ALTER POLICY "Users can delete their team email campaigns" ON public.email_campaigns USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() ))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() )))));
ALTER POLICY "Users can insert their team email campaigns" ON public.email_campaigns WITH CHECK ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() ))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() )))));
ALTER POLICY "Users can update their team email campaigns" ON public.email_campaigns USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() ))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() )))));
ALTER POLICY "Users can view their team email campaigns" ON public.email_campaigns USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() ))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() )))));
ALTER POLICY "Admins can delete employees" ON public.employees USING ((has_role(( SELECT auth.uid() ), 'admin'::text) OR has_role(( SELECT auth.uid() ), 'owner'::text)));
ALTER POLICY "Admins can update employees" ON public.employees USING ((has_role(( SELECT auth.uid() ), 'admin'::text) OR has_role(( SELECT auth.uid() ), 'owner'::text) OR (( SELECT auth.uid() ) = user_id)));
ALTER POLICY "Admins can view all employees" ON public.employees USING ((has_role(( SELECT auth.uid() ), 'admin'::text) OR has_role(( SELECT auth.uid() ), 'owner'::text) OR (( SELECT auth.uid() ) = user_id)));
ALTER POLICY "Allow employee self-registration" ON public.employees WITH CHECK ((( SELECT auth.uid() ) = user_id));
ALTER POLICY "Allow users to link themselves to employee record" ON public.employees USING (((user_id IS NULL) AND ((email)::text = (( SELECT auth.jwt() ) ->> 'email'::text)))) WITH CHECK ((user_id = ( SELECT auth.uid() )));
ALTER POLICY "Allow users to see their unlinked employee record" ON public.employees USING (((user_id IS NULL) AND ((email)::text = (( SELECT auth.jwt() ) ->> 'email'::text))));
ALTER POLICY "Dev or Owner can manage employees" ON public.employees USING ((has_employee_role(( SELECT auth.uid() ), 'dev'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'owner'::character varying)));
ALTER POLICY "Users can update own employee" ON public.employees USING ((( SELECT auth.uid() ) = user_id));
ALTER POLICY emp_delete_admin ON public.employees USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY emp_insert_admin ON public.employees WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY emp_select_admin ON public.employees USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY emp_select_self ON public.employees USING ((( SELECT auth.uid() ) = user_id));
ALTER POLICY emp_update_admin ON public.employees USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can delete employee profiles" ON public.employees_profile USING ((has_role(( SELECT auth.uid() ), 'admin'::text) OR has_role(( SELECT auth.uid() ), 'owner'::text)));
ALTER POLICY "Admins can update employee profiles" ON public.employees_profile USING ((has_role(( SELECT auth.uid() ), 'admin'::text) OR has_role(( SELECT auth.uid() ), 'owner'::text) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employees_profile.employees_id) AND (e.user_id = ( SELECT auth.uid() )))))));
ALTER POLICY "Admins can view all employee profiles" ON public.employees_profile USING ((has_role(( SELECT auth.uid() ), 'admin'::text) OR has_role(( SELECT auth.uid() ), 'owner'::text) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employees_profile.employees_id) AND (e.user_id = ( SELECT auth.uid() )))))));
ALTER POLICY "Allow employee profile creation" ON public.employees_profile WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employees_profile.employees_id) AND (e.user_id = ( SELECT auth.uid() ))))));
ALTER POLICY "Dev or Owner can manage employees_profile" ON public.employees_profile USING ((has_employee_role(( SELECT auth.uid() ), 'dev'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'owner'::character varying))) WITH CHECK ((has_employee_role(( SELECT auth.uid() ), 'dev'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'owner'::character varying)));
ALTER POLICY "Employees can view all employee profiles" ON public.employees_profile USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE (e.user_id = ( SELECT auth.uid() )))));
ALTER POLICY "Users can update own employee profile" ON public.employees_profile USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employees_profile.employees_id) AND (e.user_id = ( SELECT auth.uid() ))))));
ALTER POLICY admin_owner_manage ON public.employees_profile USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY employee_self_select ON public.employees_profile USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employees_profile.employees_id) AND (e.user_id = ( SELECT auth.uid() ))))));
ALTER POLICY employee_self_update ON public.employees_profile USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employees_profile.employees_id) AND (e.user_id = ( SELECT auth.uid() )))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employees_profile.employees_id) AND (e.user_id = ( SELECT auth.uid() ))))));
ALTER POLICY "Dev or Owner can view all error logs" ON public.error_logs USING ((has_employee_role(( SELECT auth.uid() ), 'dev'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'owner'::character varying)));
ALTER POLICY "Employees can view error logs" ON public.error_logs USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.user_id = ( SELECT auth.uid() )) AND ((e.status)::text = 'active'::text)))));
ALTER POLICY "Admins can manage event_types" ON public.event_types USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.event_types USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can manage external_api_status" ON public.external_api_status USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can view external_api_status" ON public.external_api_status USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_only ON public.external_api_status USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can view all feedback" ON public.feedback USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Users can insert their own feedback" ON public.feedback WITH CHECK ((( SELECT auth.uid() ) = user_id));
ALTER POLICY "Users can update their own feedback" ON public.feedback USING ((( SELECT auth.uid() ) = user_id));
ALTER POLICY "Users can view their own feedback" ON public.feedback USING ((( SELECT auth.uid() ) = user_id));
ALTER POLICY admin_owner_select ON public.feedback USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY owner_all ON public.feedback USING ((user_id = ( SELECT auth.uid() ))) WITH CHECK ((user_id = ( SELECT auth.uid() )));
ALTER POLICY "Admins can manage funnel_stages" ON public.funnel_stages USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.funnel_stages USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can manage genders" ON public.genders USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.genders USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can manage group_template_settings" ON public.group_template_settings USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.group_template_settings USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Dev or Owner can view all import jobs" ON public.import_jobs USING ((has_employee_role(( SELECT auth.uid() ), 'dev'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'owner'::character varying)));
ALTER POLICY import_jobs_delete ON public.import_jobs USING (can_manage_team(( SELECT auth.uid() ), team_id));
ALTER POLICY import_jobs_insert ON public.import_jobs WITH CHECK ((is_team_member(( SELECT auth.uid() ), team_id) AND (uploaded_by = ( SELECT auth.uid() ))));
ALTER POLICY import_jobs_select ON public.import_jobs USING (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY import_row_errors_select ON public.import_row_errors USING ((EXISTS ( SELECT 1
   FROM import_jobs j
  WHERE ((j.id = import_row_errors.import_job_id) AND is_team_member(( SELECT auth.uid() ), j.team_id)))));
ALTER POLICY "Admins can manage industries" ON public.industries USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.industries USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Dev or Owner can view ingestion dlq" ON public.ingestion_dlq USING ((has_employee_role(( SELECT auth.uid() ), 'dev'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'owner'::character varying)));
ALTER POLICY inv_admin ON public.invoices USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY inv_insert_own ON public.invoices WITH CHECK ((( SELECT auth.uid() ) = user_id));
ALTER POLICY inv_select_own ON public.invoices USING ((( SELECT auth.uid() ) = user_id));
ALTER POLICY "Admins can manage locations" ON public.locations USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY owner_access ON public.locations USING (((EXISTS ( SELECT 1
   FROM profile_customers pc
  WHERE ((pc.location_id = locations.id) AND (pc.user_id = ( SELECT auth.uid() ))))) OR has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK (((EXISTS ( SELECT 1
   FROM profile_customers pc
  WHERE ((pc.location_id = locations.id) AND (pc.user_id = ( SELECT auth.uid() ))))) OR has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Employees can manage activity codes" ON public.loyalty_activity_codes USING (is_employee(( SELECT auth.uid() ))) WITH CHECK (is_employee(( SELECT auth.uid() )));
ALTER POLICY users_can_insert_own_completions ON public.loyalty_mission_completions WITH CHECK ((user_id = ( SELECT auth.uid() )));
ALTER POLICY users_can_view_own_completions ON public.loyalty_mission_completions USING ((user_id = ( SELECT auth.uid() )));
ALTER POLICY admin_can_manage_missions ON public.loyalty_missions USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can manage loyalty_points" ON public.loyalty_points USING ((EXISTS ( SELECT 1
   FROM (employees e
     JOIN role_employees r ON ((e.role_employees_id = r.id)))
  WHERE ((e.user_id = ( SELECT auth.uid() )) AND ((r.role_name)::text = ANY (ARRAY[('owner'::character varying)::text, ('admin'::character varying)::text]))))));
ALTER POLICY "Users can view own loyalty points" ON public.loyalty_points USING ((EXISTS ( SELECT 1
   FROM profile_customers pc
  WHERE ((pc.id = loyalty_points.profile_customer_id) AND (pc.user_id = ( SELECT auth.uid() ))))));
ALTER POLICY employees_can_read_all_loyalty_points ON public.loyalty_points USING ((EXISTS ( SELECT 1
   FROM (employees_profile ep
     JOIN employees e ON ((e.id = ep.employees_id)))
  WHERE (e.user_id = ( SELECT auth.uid() )))));
ALTER POLICY "Customers can view own tier history" ON public.loyalty_tier_history USING ((EXISTS ( SELECT 1
   FROM profile_customers pc
  WHERE ((pc.id = loyalty_tier_history.profile_customer_id) AND (pc.user_id = ( SELECT auth.uid() ))))));
ALTER POLICY "Employees can insert tier history" ON public.loyalty_tier_history WITH CHECK (is_employee(( SELECT auth.uid() )));
ALTER POLICY employees_can_read_tier_history ON public.loyalty_tier_history USING (is_employee(( SELECT auth.uid() )));
ALTER POLICY "Admins can manage metric_templates" ON public.metric_templates USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.metric_templates USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Users can insert own notification preferences" ON public.notification_preferences WITH CHECK ((( SELECT auth.uid() ) = user_id));
ALTER POLICY "Users can update own notification preferences" ON public.notification_preferences USING ((( SELECT auth.uid() ) = user_id));
ALTER POLICY "Users can view own notification preferences" ON public.notification_preferences USING ((( SELECT auth.uid() ) = user_id));
ALTER POLICY "Employees can mark notifications as read" ON public.notifications USING (((target_role = 'all'::text) OR (EXISTS ( SELECT 1
   FROM (employees e
     JOIN role_employees re ON ((e.role_employees_id = re.id)))
  WHERE ((e.user_id = ( SELECT auth.uid() )) AND (((re.role_name)::text = notifications.target_role) OR ((re.role_name)::text = 'owner'::text)) AND ((e.status)::text = 'active'::text)))))) WITH CHECK (true);
ALTER POLICY "Employees can view their role notifications" ON public.notifications USING (((target_role = 'all'::text) OR (EXISTS ( SELECT 1
   FROM (employees e
     JOIN role_employees re ON ((e.role_employees_id = re.id)))
  WHERE ((e.user_id = ( SELECT auth.uid() )) AND (((re.role_name)::text = notifications.target_role) OR ((re.role_name)::text = 'owner'::text)) AND ((e.status)::text = 'active'::text))))));
ALTER POLICY "Admins can manage payment_methods" ON public.payment_methods USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.payment_methods USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can manage payment_providers" ON public.payment_providers USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.payment_providers USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY txn_admin ON public.payment_transactions USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY txn_insert_own ON public.payment_transactions WITH CHECK ((( SELECT auth.uid() ) = user_id));
ALTER POLICY txn_select_own ON public.payment_transactions USING ((( SELECT auth.uid() ) = user_id));
ALTER POLICY "Employees can read persona metrics" ON public.persona_metrics_daily USING (((EXISTS ( SELECT 1
   FROM (employees e
     JOIN role_employees r ON ((e.role_employees_id = r.id)))
  WHERE ((e.user_id = ( SELECT auth.uid() )) AND ((r.role_name)::text = ANY (ARRAY[('dev'::character varying)::text, ('support'::character varying)::text, ('owner'::character varying)::text]))))) OR (NOT (EXISTS ( SELECT 1
   FROM employees
 LIMIT 1)))));
ALTER POLICY "Admins can manage pipeline_type" ON public.pipeline_type USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.pipeline_type USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can manage platform categories" ON public.platform_categories USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can manage platform_categories" ON public.platform_categories USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can manage platform_mapping_events" ON public.platform_mapping_events USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.platform_mapping_events USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can manage platform_standard_mappings" ON public.platform_standard_mappings USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.platform_standard_mappings USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can manage platforms" ON public.platforms USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can manage point earning rules" ON public.point_earning_rules USING ((EXISTS ( SELECT 1
   FROM (employees e
     JOIN role_employees re ON ((e.role_employees_id = re.id)))
  WHERE ((e.user_id = ( SELECT auth.uid() )) AND ((re.role_name)::text = ANY (ARRAY[('admin'::character varying)::text, ('owner'::character varying)::text, ('dev'::character varying)::text]))))));
ALTER POLICY "Employees can view all point earning rules" ON public.point_earning_rules USING ((EXISTS ( SELECT 1
   FROM (employees e
     JOIN role_employees re ON ((e.role_employees_id = re.id)))
  WHERE ((e.user_id = ( SELECT auth.uid() )) AND ((e.status)::text = 'active'::text) AND ((e.approval_status)::text = 'approved'::text) AND ((re.role_name)::text = ANY (ARRAY[('support'::character varying)::text, ('admin'::character varying)::text, ('owner'::character varying)::text, ('dev'::character varying)::text]))))));
ALTER POLICY "Support employees can delete point earning rules" ON public.point_earning_rules USING ((EXISTS ( SELECT 1
   FROM (employees e
     JOIN role_employees re ON ((e.role_employees_id = re.id)))
  WHERE ((e.user_id = ( SELECT auth.uid() )) AND ((e.status)::text = 'active'::text) AND ((e.approval_status)::text = 'approved'::text) AND ((re.role_name)::text = ANY (ARRAY[('support'::character varying)::text, ('dev'::character varying)::text, ('owner'::character varying)::text]))))));
ALTER POLICY "Support employees can insert point earning rules" ON public.point_earning_rules WITH CHECK ((EXISTS ( SELECT 1
   FROM (employees e
     JOIN role_employees re ON ((e.role_employees_id = re.id)))
  WHERE ((e.user_id = ( SELECT auth.uid() )) AND ((e.status)::text = 'active'::text) AND ((e.approval_status)::text = 'approved'::text) AND ((re.role_name)::text = ANY (ARRAY[('support'::character varying)::text, ('dev'::character varying)::text, ('owner'::character varying)::text]))))));
ALTER POLICY "Support employees can update point earning rules" ON public.point_earning_rules USING ((EXISTS ( SELECT 1
   FROM (employees e
     JOIN role_employees re ON ((e.role_employees_id = re.id)))
  WHERE ((e.user_id = ( SELECT auth.uid() )) AND ((e.status)::text = 'active'::text) AND ((e.approval_status)::text = 'approved'::text) AND ((re.role_name)::text = ANY (ARRAY[('support'::character varying)::text, ('admin'::character varying)::text, ('owner'::character varying)::text, ('dev'::character varying)::text]))))));
ALTER POLICY "Employees can manage transactions" ON public.points_transactions USING (is_employee(( SELECT auth.uid() )));
ALTER POLICY "Employees can view all points transactions" ON public.points_transactions USING (is_employee(( SELECT auth.uid() )));
ALTER POLICY "Employees can view all transactions" ON public.points_transactions USING (is_employee(( SELECT auth.uid() )));
ALTER POLICY "Users can view own transactions" ON public.points_transactions USING ((( SELECT auth.uid() ) = user_id));
ALTER POLICY post_personas_select ON public.post_personas USING ((post_id IN ( SELECT social_posts.id
   FROM social_posts
  WHERE (social_posts.team_id IN ( SELECT workspace_members.team_id
           FROM workspace_members
          WHERE (workspace_members.user_id = ( SELECT auth.uid() ))
        UNION
         SELECT workspaces.id
           FROM workspaces
          WHERE (workspaces.owner_id = ( SELECT auth.uid() )))))));
ALTER POLICY post_personas_write ON public.post_personas USING ((post_id IN ( SELECT social_posts.id
   FROM social_posts
  WHERE (social_posts.team_id IN ( SELECT workspace_members.team_id
           FROM workspace_members
          WHERE (workspace_members.user_id = ( SELECT auth.uid() ))
        UNION
         SELECT workspaces.id
           FROM workspaces
          WHERE (workspaces.owner_id = ( SELECT auth.uid() )))))));
ALTER POLICY "Admins can view all customer profiles" ON public.profile_customers USING ((EXISTS ( SELECT 1
   FROM (employees e
     JOIN role_employees r ON ((e.role_employees_id = r.id)))
  WHERE ((e.user_id = ( SELECT auth.uid() )) AND ((r.role_name)::text = ANY (ARRAY[('owner'::character varying)::text, ('admin'::character varying)::text]))))));
ALTER POLICY "Admins can view all profile_customers" ON public.profile_customers USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Employees can view all profile customers" ON public.profile_customers USING (is_employee(( SELECT auth.uid() )));
ALTER POLICY "Users can insert own customer profile" ON public.profile_customers WITH CHECK ((user_id = ( SELECT auth.uid() )));
ALTER POLICY "Users can update own customer profile" ON public.profile_customers USING ((user_id = ( SELECT auth.uid() )));
ALTER POLICY "Users can update own profile_customers" ON public.profile_customers USING ((( SELECT auth.uid() ) = user_id));
ALTER POLICY "Users can view own customer profile" ON public.profile_customers USING ((user_id = ( SELECT auth.uid() )));
ALTER POLICY "Users can view own profile_customers" ON public.profile_customers USING ((( SELECT auth.uid() ) = user_id));
ALTER POLICY employees_can_read_all_profile_customers ON public.profile_customers USING (is_employee(( SELECT auth.uid() )));
ALTER POLICY "Admins can manage provider_server" ON public.provider_server USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can view provider_server" ON public.provider_server USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_only ON public.provider_server USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can manage provinces" ON public.provinces USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.provinces USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can manage rating" ON public.rating USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.rating USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Team admins can delete reports" ON public.reports USING (can_manage_team(( SELECT auth.uid() ), team_id));
ALTER POLICY "Team members can create reports" ON public.reports WITH CHECK (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY "Team members can update reports" ON public.reports USING (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY "Team members can view reports" ON public.reports USING (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY "Admins can manage request_logs" ON public.request_logs USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can view request_logs" ON public.request_logs USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_only ON public.request_logs USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Team admins can manage revenue metrics" ON public.revenue_metrics USING (can_manage_team(( SELECT auth.uid() ), team_id));
ALTER POLICY "Team members can view revenue metrics" ON public.revenue_metrics USING (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY "Admins can manage reward items" ON public.reward_items USING ((EXISTS ( SELECT 1
   FROM (employees e
     JOIN role_employees re ON ((e.role_employees_id = re.id)))
  WHERE ((e.user_id = ( SELECT auth.uid() )) AND ((re.role_name)::text = ANY (ARRAY[('admin'::character varying)::text, ('owner'::character varying)::text, ('dev'::character varying)::text]))))));
ALTER POLICY "Employees can view all reward items" ON public.reward_items USING ((EXISTS ( SELECT 1
   FROM (employees e
     JOIN role_employees re ON ((e.role_employees_id = re.id)))
  WHERE ((e.user_id = ( SELECT auth.uid() )) AND ((e.status)::text = 'active'::text) AND ((e.approval_status)::text = 'approved'::text) AND ((re.role_name)::text = ANY (ARRAY[('support'::character varying)::text, ('admin'::character varying)::text, ('owner'::character varying)::text, ('dev'::character varying)::text]))))));
ALTER POLICY "Support employees can delete reward items" ON public.reward_items USING ((EXISTS ( SELECT 1
   FROM (employees e
     JOIN role_employees re ON ((e.role_employees_id = re.id)))
  WHERE ((e.user_id = ( SELECT auth.uid() )) AND ((e.status)::text = 'active'::text) AND ((e.approval_status)::text = 'approved'::text) AND ((re.role_name)::text = ANY (ARRAY[('support'::character varying)::text, ('dev'::character varying)::text, ('owner'::character varying)::text]))))));
ALTER POLICY "Support employees can insert reward items" ON public.reward_items WITH CHECK ((EXISTS ( SELECT 1
   FROM (employees e
     JOIN role_employees re ON ((e.role_employees_id = re.id)))
  WHERE ((e.user_id = ( SELECT auth.uid() )) AND ((e.status)::text = 'active'::text) AND ((e.approval_status)::text = 'approved'::text) AND ((re.role_name)::text = ANY (ARRAY[('support'::character varying)::text, ('dev'::character varying)::text, ('owner'::character varying)::text]))))));
ALTER POLICY "Support employees can update reward items" ON public.reward_items USING ((EXISTS ( SELECT 1
   FROM (employees e
     JOIN role_employees re ON ((e.role_employees_id = re.id)))
  WHERE ((e.user_id = ( SELECT auth.uid() )) AND ((e.status)::text = 'active'::text) AND ((e.approval_status)::text = 'approved'::text) AND ((re.role_name)::text = ANY (ARRAY[('support'::character varying)::text, ('admin'::character varying)::text, ('owner'::character varying)::text, ('dev'::character varying)::text]))))));
ALTER POLICY "Admins can manage reward redemptions" ON public.reward_redemptions USING ((EXISTS ( SELECT 1
   FROM (employees e
     JOIN role_employees re ON ((e.role_employees_id = re.id)))
  WHERE ((e.user_id = ( SELECT auth.uid() )) AND ((re.role_name)::text = ANY (ARRAY[('admin'::character varying)::text, ('owner'::character varying)::text, ('dev'::character varying)::text]))))));
ALTER POLICY "Support employees can update redemptions" ON public.reward_redemptions USING ((has_employee_role(( SELECT auth.uid() ), 'support'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'owner'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'dev'::character varying)));
ALTER POLICY "Support employees can view all redemptions" ON public.reward_redemptions USING ((has_employee_role(( SELECT auth.uid() ), 'support'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'owner'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'dev'::character varying)));
ALTER POLICY "Users can insert their own redemptions" ON public.reward_redemptions WITH CHECK ((user_id = ( SELECT auth.uid() )));
ALTER POLICY "Users can view and manage their own redemptions" ON public.reward_redemptions USING ((user_id = ( SELECT auth.uid() )));
ALTER POLICY "Admins can manage role_employees" ON public.role_employees USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Users can delete their team scheduled reports" ON public.scheduled_reports USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() ))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() )))));
ALTER POLICY "Users can insert their team scheduled reports" ON public.scheduled_reports WITH CHECK ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() ))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() )))));
ALTER POLICY "Users can update their team scheduled reports" ON public.scheduled_reports USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() ))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() )))));
ALTER POLICY "Users can view their team scheduled reports" ON public.scheduled_reports USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() ))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() )))));
ALTER POLICY "Admins can manage security_level" ON public.security_level USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.security_level USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can manage server" ON public.server USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can view server" ON public.server USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_only ON public.server USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY social_comments_delete ON public.social_comments USING (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY social_comments_insert ON public.social_comments WITH CHECK (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY social_comments_select ON public.social_comments USING (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY social_comments_update ON public.social_comments USING (is_team_member(( SELECT auth.uid() ), team_id)) WITH CHECK (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY "Admins can manage social_posts" ON public.social_posts USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Owners can insert social posts" ON public.social_posts WITH CHECK ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = social_posts.team_id) AND (w.owner_id = ( SELECT auth.uid() ))))));
ALTER POLICY "Owners can view social posts" ON public.social_posts USING ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = social_posts.team_id) AND (w.owner_id = ( SELECT auth.uid() ))))));
ALTER POLICY "Team admins can delete social posts" ON public.social_posts USING (can_manage_team(( SELECT auth.uid() ), team_id));
ALTER POLICY "Team members can create social posts" ON public.social_posts WITH CHECK (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY "Team members can update social posts" ON public.social_posts USING (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY "Team members can view social posts" ON public.social_posts USING (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY sub_admin ON public.subscriptions USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY sub_insert_own ON public.subscriptions WITH CHECK ((( SELECT auth.uid() ) = user_id));
ALTER POLICY sub_select_own ON public.subscriptions USING ((( SELECT auth.uid() ) = user_id));
ALTER POLICY sub_update_own ON public.subscriptions USING ((( SELECT auth.uid() ) = user_id));
ALTER POLICY "Employees can manage suspicious activities" ON public.suspicious_activities USING (is_employee(( SELECT auth.uid() )));
ALTER POLICY "Employees can view suspicious activities" ON public.suspicious_activities USING (is_employee(( SELECT auth.uid() )));
ALTER POLICY sync_history_delete ON public.sync_history USING (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY sync_history_insert ON public.sync_history WITH CHECK (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY sync_history_select ON public.sync_history USING (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY sync_history_update ON public.sync_history USING (is_team_member(( SELECT auth.uid() ), team_id)) WITH CHECK (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY "Admins can manage system health" ON public.system_health USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Users can delete their team tags" ON public.tags USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() ))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() )))));
ALTER POLICY "Users can insert their team tags" ON public.tags WITH CHECK ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() ))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() )))));
ALTER POLICY "Users can update their team tags" ON public.tags USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() ))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() )))));
ALTER POLICY "Users can view their team tags" ON public.tags USING ((team_id IN ( SELECT workspaces.id
   FROM workspaces
  WHERE (workspaces.owner_id = ( SELECT auth.uid() ))
UNION
 SELECT workspace_members.team_id
   FROM workspace_members
  WHERE (workspace_members.user_id = ( SELECT auth.uid() )))));
ALTER POLICY "System can insert activity logs" ON public.team_activity_logs WITH CHECK (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY "Team members can view activity logs" ON public.team_activity_logs USING (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY "Team managers can create invitations" ON public.team_invitations WITH CHECK (can_manage_team(( SELECT auth.uid() ), team_id));
ALTER POLICY "Team managers can delete invitations" ON public.team_invitations USING (can_manage_team(( SELECT auth.uid() ), team_id));
ALTER POLICY "Team managers can update invitations" ON public.team_invitations USING (can_manage_team(( SELECT auth.uid() ), team_id));
ALTER POLICY "Team members can view invitations" ON public.team_invitations USING (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY "Employees can insert tier history" ON public.tier_history WITH CHECK (is_employee(( SELECT auth.uid() )));
ALTER POLICY "Employees can manage tier history" ON public.tier_history USING (is_employee(( SELECT auth.uid() )));
ALTER POLICY "Employees can view all tier history" ON public.tier_history USING (is_employee(( SELECT auth.uid() )));
ALTER POLICY "Users can view own tier history" ON public.tier_history USING ((( SELECT auth.uid() ) = user_id));
ALTER POLICY "Admins can manage time_zones" ON public.time_zones USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY admin_owner_manage ON public.time_zones USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role))) WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can manage user completed rules" ON public.user_completed_rules USING ((EXISTS ( SELECT 1
   FROM (employees e
     JOIN role_employees re ON ((e.role_employees_id = re.id)))
  WHERE ((e.user_id = ( SELECT auth.uid() )) AND ((re.role_name)::text = ANY (ARRAY[('admin'::character varying)::text, ('owner'::character varying)::text, ('dev'::character varying)::text]))))));
ALTER POLICY "Users can view their own completed rules" ON public.user_completed_rules USING ((user_id = ( SELECT auth.uid() )));
ALTER POLICY upm_own ON public.user_payment_methods USING ((( SELECT auth.uid() ) = user_id));
ALTER POLICY "Customers can view their own redeemed coupons" ON public.user_redeemed_coupons USING ((( SELECT auth.uid() ) = user_id));
ALTER POLICY "Employees can view all redeemed coupons" ON public.user_redeemed_coupons USING ((EXISTS ( SELECT 1
   FROM employees e
  WHERE (e.user_id = ( SELECT auth.uid() )))));
ALTER POLICY "Admins can insert roles" ON public.user_roles WITH CHECK ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can view all roles" ON public.user_roles USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Workspace members can insert workspace_ad_persona" ON public.workspace_ad_persona WITH CHECK (is_team_member(( SELECT auth.uid() ), workspace_id));
ALTER POLICY "Workspace members can update workspace_ad_persona" ON public.workspace_ad_persona USING (is_team_member(( SELECT auth.uid() ), workspace_id));
ALTER POLICY "Workspace members can view workspace_ad_persona" ON public.workspace_ad_persona USING (is_team_member(( SELECT auth.uid() ), workspace_id));
ALTER POLICY "Team members can delete API keys" ON public.workspace_api_keys USING (((EXISTS ( SELECT 1
   FROM workspace_members
  WHERE ((workspace_members.team_id = workspace_api_keys.team_id) AND (workspace_members.user_id = ( SELECT auth.uid() ))))) OR (EXISTS ( SELECT 1
   FROM workspaces
  WHERE ((workspaces.id = workspace_api_keys.team_id) AND (workspaces.owner_id = ( SELECT auth.uid() )))))));
ALTER POLICY "Team members can insert API keys" ON public.workspace_api_keys WITH CHECK (((EXISTS ( SELECT 1
   FROM workspace_members
  WHERE ((workspace_members.team_id = workspace_api_keys.team_id) AND (workspace_members.user_id = ( SELECT auth.uid() ))))) OR (EXISTS ( SELECT 1
   FROM workspaces
  WHERE ((workspaces.id = workspace_api_keys.team_id) AND (workspaces.owner_id = ( SELECT auth.uid() )))))));
ALTER POLICY "Team members can update API keys" ON public.workspace_api_keys USING (((EXISTS ( SELECT 1
   FROM workspace_members
  WHERE ((workspace_members.team_id = workspace_api_keys.team_id) AND (workspace_members.user_id = ( SELECT auth.uid() ))))) OR (EXISTS ( SELECT 1
   FROM workspaces
  WHERE ((workspaces.id = workspace_api_keys.team_id) AND (workspaces.owner_id = ( SELECT auth.uid() )))))));
ALTER POLICY "Team members can view API keys" ON public.workspace_api_keys USING (((EXISTS ( SELECT 1
   FROM workspace_members
  WHERE ((workspace_members.team_id = workspace_api_keys.team_id) AND (workspace_members.user_id = ( SELECT auth.uid() ))))) OR (EXISTS ( SELECT 1
   FROM workspaces
  WHERE ((workspaces.id = workspace_api_keys.team_id) AND (workspaces.owner_id = ( SELECT auth.uid() )))))));
ALTER POLICY "Admins can view all team members" ON public.workspace_members USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Employees can view all workspace members" ON public.workspace_members USING ((has_employee_role(( SELECT auth.uid() ), 'support'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'owner'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'dev'::character varying)));
ALTER POLICY "Team managers can delete members" ON public.workspace_members USING (can_manage_team(( SELECT auth.uid() ), team_id));
ALTER POLICY "Team managers can insert members" ON public.workspace_members WITH CHECK (can_manage_team(( SELECT auth.uid() ), team_id));
ALTER POLICY "Team managers can update members" ON public.workspace_members USING (can_manage_team(( SELECT auth.uid() ), team_id));
ALTER POLICY "Team members can view their team members" ON public.workspace_members USING (is_team_member(( SELECT auth.uid() ), team_id));
ALTER POLICY "Users can update own workspace notifications (mark read)" ON public.workspace_notifications USING ((user_id = ( SELECT auth.uid() )));
ALTER POLICY "Users can view own workspace notifications" ON public.workspace_notifications USING ((user_id = ( SELECT auth.uid() )));
ALTER POLICY "Admins can update workspaces" ON public.workspaces USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Admins can view all teams" ON public.workspaces USING ((has_role(( SELECT auth.uid() ), 'admin'::app_role) OR has_role(( SELECT auth.uid() ), 'owner'::app_role)));
ALTER POLICY "Only team owners can delete teams" ON public.workspaces USING ((owner_id = ( SELECT auth.uid() )));
ALTER POLICY "Support or Owner can manage workspaces" ON public.workspaces USING ((has_employee_role(( SELECT auth.uid() ), 'support'::character varying) OR has_employee_role(( SELECT auth.uid() ), 'owner'::character varying)));
ALTER POLICY "Team members can view their teams" ON public.workspaces USING (((owner_id = ( SELECT auth.uid() )) OR is_team_member(( SELECT auth.uid() ), id)));
ALTER POLICY "Team owners and admins can update teams" ON public.workspaces USING (can_manage_team(( SELECT auth.uid() ), id));
ALTER POLICY "Users can create teams" ON public.workspaces WITH CHECK ((owner_id = ( SELECT auth.uid() )));
