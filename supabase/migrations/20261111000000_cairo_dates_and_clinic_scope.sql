-- =========================================================================
-- Three small server-side corrections (no table, column or data change)
-- =========================================================================
-- 1. "Today" is the clinic's day, not the database's.
--    The database runs in UTC. iapp.book_appointment and
--    iapp.reschedule_appointment rejected past dates with `current_date`, so
--    between 00:00 and 02:00/03:00 Cairo time "yesterday" was still accepted.
--    They now compare against the Cairo date. (All clinics are Africa/Cairo.)
--
-- 2. Reception acts only inside its own clinics.
--    iapp.transition checked the ROLE but not the CLINIC: a secretary who knew
--    an appointment's UUID could change the state of another clinic's
--    appointment (cancel, mark arrived, call). She could never SEE such an
--    appointment (RLS apt_secretary_read), so nothing in the app relies on it.
--    The same "not found" error is raised as for a missing row.
--    Doctors/admins are unaffected: iapp.my_clinic_ids() returns every clinic
--    for them, and an unassigned secretary keeps single-clinic mode.
--
-- 3. iapp.tg_queue_calls_append_only gets a fixed search_path (Supabase
--    advisor: function_search_path_mutable).
--
-- HOW: 1 and 2 patch the LIVE function text (pg_get_functiondef + replace), so
-- nothing else in those functions is touched even if the live body differs
-- from the copy in this repository. Each patch is skipped when already applied
-- and FAILS LOUDLY (whole migration rolls back) if the expected text is not
-- found — it never silently does nothing.
--
-- ROLLBACK: re-run the previous definitions, i.e. replace
--   (now() at time zone 'Africa/Cairo')::date   ->  current_date
-- in the two booking functions, and delete the "clinic scope" block from
-- iapp.transition;  alter function iapp.tg_queue_calls_append_only() reset search_path;
-- =========================================================================

do $mig$
declare
  v_def  text;
  v_new  text;
  r      record;
  c_cairo constant text := '(now() at time zone ''Africa/Cairo'')::date';
begin
  -- ---- 1. Cairo "today" in the two booking functions -------------------
  for r in
    select p.oid, p.proname,
           case p.proname when 'book_appointment' then 'p_date < current_date'
                          else 'p_new_date < current_date' end as old_txt,
           case p.proname when 'book_appointment' then 'p_date < ' || c_cairo
                          else 'p_new_date < ' || c_cairo end as new_txt
      from pg_proc p
     where p.pronamespace = 'iapp'::regnamespace
       and p.proname in ('book_appointment', 'reschedule_appointment')
  loop
    v_def := pg_get_functiondef(r.oid);
    if position(r.new_txt in v_def) > 0 then
      raise notice '% already uses the Cairo date — skipped', r.proname;
      continue;
    end if;
    if position(r.old_txt in v_def) = 0 then
      raise exception 'cairo_patch: expected text "%" not found in iapp.%', r.old_txt, r.proname;
    end if;
    execute replace(v_def, r.old_txt, r.new_txt);
    raise notice '% now uses the Cairo date', r.proname;
  end loop;

  if (select count(*) from pg_proc p
       where p.pronamespace = 'iapp'::regnamespace
         and p.proname in ('book_appointment', 'reschedule_appointment')) <> 2 then
    raise exception 'cairo_patch: expected exactly one book_appointment and one reschedule_appointment';
  end if;

  -- ---- 2. clinic scope for reception in iapp.transition -----------------
  select pg_get_functiondef(p.oid) into strict v_def
    from pg_proc p
   where p.pronamespace = 'iapp'::regnamespace and p.proname = 'transition';

  if position('clinic scope' in v_def) > 0 then
    raise notice 'transition already checks the clinic — skipped';
  else
    if position('perform set_config(''iapp.acting_role'', v_role, true);' in v_def) = 0 then
      raise exception 'scope_patch: anchor line not found in iapp.transition';
    end if;
    v_new := replace(
      v_def,
      'perform set_config(''iapp.acting_role'', v_role, true);',
      '-- clinic scope: reception may only act on appointments of its own clinics.' || E'\n' ||
      '  if v_role = ''secretary''' || E'\n' ||
      '     and v_row.clinic_id is not null' || E'\n' ||
      '     and v_row.clinic_id not in (select iapp.my_clinic_ids()) then' || E'\n' ||
      '    -- Same error as a missing row: do not confirm existence.' || E'\n' ||
      '    raise exception ''not_found: appointment does not exist'' using errcode=''P0002'';' || E'\n' ||
      '  end if;' || E'\n\n' ||
      '  perform set_config(''iapp.acting_role'', v_role, true);');
    execute v_new;
    raise notice 'transition now checks the clinic for reception';
  end if;
end
$mig$;

-- ---- 3. fixed search_path ------------------------------------------------
alter function iapp.tg_queue_calls_append_only() set search_path = iapp, public;
