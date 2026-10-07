\pset format unaligned
\pset tuples_only on
select tablename||'|'||policyname||'|'||cmd||'|'||roles::text||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') from pg_policies where tablename in ('ad_insights','ad_accounts') order by 1;
select 'fn|'||coalesce((select p.proacl::text||'|'||md5(pg_get_functiondef(p.oid)) from pg_proc p where p.proname='seed_demo_insights'),'ABSENT');
