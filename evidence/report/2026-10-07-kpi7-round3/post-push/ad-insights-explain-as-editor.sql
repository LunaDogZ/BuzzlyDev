begin;
select set_config('request.jwt.claims', json_build_object('sub','<id>','role','authenticated')::text, true);
select set_config('request.jwt.claim.sub', '<id>', true);
set local role authenticated;
explain (analyze, buffers, format text) select count(*) from public.ad_insights where ad_account_id in ('<id>') and true;
rollback;
