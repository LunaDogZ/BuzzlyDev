select schemaname, tablename, policyname, cmd,
  format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;',
    policyname, schemaname, tablename, permissive, cmd,
    (select string_agg(case when r='public' then 'public' else quote_ident(r) end, ', ') from unnest(roles) r),
    case when qual is not null then E'\n  USING (' || qual || ')' else '' end,
    case when with_check is not null then E'\n  WITH CHECK (' || with_check || ')' else '' end) as create_sql
from pg_policies
where (schemaname='public' and tablename in ('workspace_api_keys','import_jobs','ads','ad_groups','campaigns','campaign_ads','campaign_tags','budgets','customer_personas','ad_personas','post_personas','workspace_ad_persona','social_posts','social_comments','reports','scheduled_reports','email_campaigns','tags','sync_history','conversion_events','team_activity_logs'))
   or (schemaname='storage' and tablename='objects' and policyname like 'imports\_%')
order by schemaname, tablename, cmd, policyname;
