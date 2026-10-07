select p.oid::regprocedure::text as sig, p.proname,
  p.prosecdef as secdef,
  p.prorettype::regtype::text as rettype,
  p.provolatile as vol,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_x,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_x,
  coalesce(array_to_string(p.proacl,' '),'(default)') as acl,
  l.lanname as lang,
  p.prosrc as src
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
where n.nspname='public' and p.prokind in ('f','p')
  and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
order by p.proname;
