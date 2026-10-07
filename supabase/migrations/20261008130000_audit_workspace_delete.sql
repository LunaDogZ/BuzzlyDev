-- Audit every workspace deletion: who did it, and how many rows it took with it.
--
-- Why. Deleting a workspace cascades through 22 tables directly and 5 more
-- beneath them (import_jobs -> import_row_errors, social_posts -> post_personas,
-- ...), and until now left no trace at all — proven on the live project by
-- tests/evidence/l7-cascade-probe/2026-10-08/. Import history can vanish with
-- nothing to say when, by whom, or how much.
--
-- How. A BEFORE DELETE row trigger walks the foreign keys that point at the
-- workspace from the live catalog (ON DELETE CASCADE -> "removed", SET NULL ->
-- "detached"), up to 4 levels, so a table added later is counted without
-- editing this function. A row reachable by two paths (ingestion_batches via
-- team_id and via import_job_id) is counted once: each table's filters are
-- OR-ed and counted together at the end.
--
-- BEFORE, not AFTER: the cascades run as AFTER triggers of their own, so by the
-- time an AFTER trigger here could look, the rows are already gone. If the
-- delete is then refused (ad_accounts, campaigns, ads, ad_groups and
-- subscriptions have no delete action), the audit row rolls back with it — the
-- log records deletions that happened, not attempts.
--
-- "Who": auth.uid() is null for service_role, the dashboard and the SQL editor,
-- which are exactly the doors L-7 cannot rule out — so the JWT role and the
-- session user are recorded as well.
--
-- Single-column foreign keys only; every key on this path is one today. A
-- multi-column key would be skipped, and is listed in metadata.skipped_fks so
-- the omission is visible rather than silent.

CREATE OR REPLACE FUNCTION public.audit_workspace_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  q_tables  regclass[] := ARRAY['public.workspaces'::regclass];
  q_filters text[]     := ARRAY[format('id = %L', OLD.id)];
  q_depth   int[]      := ARRAY[0];
  i         int        := 1;
  fk        record;
  v_filter  text;
  v_n       bigint;
  v_cascade jsonb := '{}';   -- table -> [filters], ON DELETE CASCADE
  v_setnull jsonb := '{}';   -- table -> [filters], ON DELETE SET NULL
  v_skipped jsonb := '[]';
  v_removed jsonb := '{}';
  v_detached jsonb := '{}';
  t         text;
BEGIN
  WHILE i <= cardinality(q_tables) LOOP
    FOR fk IN
      SELECT c.conname, c.conrelid::regclass AS child, c.confdeltype AS action,
             cardinality(c.conkey) AS width, a.attname AS fkcol, ra.attname AS refcol
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_attribute a  ON a.attrelid  = c.conrelid  AND a.attnum  = c.conkey[1]
      JOIN pg_catalog.pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
      WHERE c.contype = 'f' AND c.confrelid = q_tables[i] AND c.confdeltype IN ('c', 'n')
    LOOP
      IF fk.width <> 1 THEN
        v_skipped := v_skipped || to_jsonb(fk.conname::text);
        CONTINUE;
      END IF;

      v_filter := format('%I IN (SELECT %I FROM %s WHERE %s)',
                         fk.fkcol, fk.refcol, q_tables[i], q_filters[i]);
      EXECUTE format('SELECT count(*) FROM %s WHERE %s', fk.child, v_filter) INTO v_n;
      CONTINUE WHEN v_n = 0;

      IF fk.action = 'c' THEN
        v_cascade := jsonb_set(v_cascade, ARRAY[fk.child::text],
                               COALESCE(v_cascade -> fk.child::text, '[]') || to_jsonb(v_filter));
        IF q_depth[i] < 4 THEN
          q_tables  := q_tables  || fk.child;
          q_filters := q_filters || v_filter;
          q_depth   := q_depth   || (q_depth[i] + 1);
        END IF;
      ELSE
        v_setnull := jsonb_set(v_setnull, ARRAY[fk.child::text],
                               COALESCE(v_setnull -> fk.child::text, '[]') || to_jsonb(v_filter));
      END IF;
    END LOOP;
    i := i + 1;
  END LOOP;

  FOR t IN SELECT jsonb_object_keys(v_cascade) LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE (%s)', t,
                   (SELECT string_agg(f, ') OR (') FROM jsonb_array_elements_text(v_cascade -> t) f))
      INTO v_n;
    v_removed := v_removed || jsonb_build_object(t, v_n);
  END LOOP;
  FOR t IN SELECT jsonb_object_keys(v_setnull) LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE (%s)', t,
                   (SELECT string_agg(f, ') OR (') FROM jsonb_array_elements_text(v_setnull -> t) f))
      INTO v_n;
    v_detached := v_detached || jsonb_build_object(t, v_n);
  END LOOP;

  INSERT INTO public.audit_logs_enhanced (user_id, category, description, status, metadata)
  VALUES (
    auth.uid(),
    'security',
    format('Workspace deleted: %s', OLD.name),
    'success',
    jsonb_build_object(
      'action_name', 'Workspace Deleted',
      'workspace_id', OLD.id,
      'workspace_name', OLD.name,
      'workspace_owner_id', OLD.owner_id,
      'deleted_by_uid', auth.uid(),
      -- NULLIF: a pooled connection can carry '' here, and ''::jsonb would
      -- raise — turning the audit into something that blocks deletes.
      'jwt_role', NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      'session_user', session_user,
      'rows_removed', v_removed,
      'rows_detached', v_detached,
      'skipped_fks', v_skipped
    )
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS audit_workspace_delete ON public.workspaces;
CREATE TRIGGER audit_workspace_delete
  BEFORE DELETE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.audit_workspace_delete();
