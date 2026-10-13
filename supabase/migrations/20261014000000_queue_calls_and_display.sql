-- =========================================================================
-- I App — waiting-room call events + public queue display
-- =========================================================================
-- STATUS: PROPOSED MIGRATION FILE ONLY. NOT APPLIED TO ANY SUPABASE PROJECT.
-- Review it, apply it to IAPP-Test first, run the checks at the bottom, and
-- only then apply it to iapp-production. Purely additive: no existing table,
-- column, policy or function is altered or dropped.
--
-- WHAT ALREADY EXISTS AND IS REUSED (nothing here replaces it)
--   * The appointment state machine: iapp.transition() + the legal moves in
--     iapp.appointment_transitions. "Calling" a patient IS the move
--     WAITING -> IN_CLINIC; "cancel the call" IS IN_CLINIC -> WAITING (the
--     original waiting_at/arrived_at stay, so the patient keeps his place);
--     "end of exam" IS IN_CLINIC -> COMPLETED. Who may do each move is read
--     from allowed_roles in that table — this file hard-codes no role.
--   * The clinic's queue priority, exactly as the app already applies it in
--     utils/appointmentFilters.pickNextInQueue: longest wait first (minutes,
--     rounded like v_appointment_board.wait_minutes), ties -> earlier
--     scheduled_time.
--   * iapp.my_clinic_ids() for clinic scoping, iapp.acting_role() for the role.
--   * tg_reject_noop_transition, which already makes "call the same patient
--     twice" fail at the database (second call finds the status unchanged).
--
-- WHAT IS ADDED, AND WHY EACH PIECE IS NEEDED
--   1. iapp.queue_calls — append-only log of call / re-call events. Nothing
--      in the schema records "this patient was called at HH:MM:SS" or "he was
--      called again", and a TV needs exactly that to announce once per event.
--      It stores ids, a room label and timestamps only — no patient data.
--   2. A trigger on iapp.appointments that writes a 'call' event whenever a
--      row enters IN_CLINIC. Because it lives in the database, every path
--      (this React app, the legacy /iapp/ and /iapp/v2/ apps, direct RPC)
--      produces the event and the TV never misses a call.
--   3. iapp.call_next_patient() — atomic "call the next patient". Picks and
--      locks the row in one statement (FOR UPDATE SKIP LOCKED) under a
--      per-clinic/doctor advisory lock, so two devices pressing it together
--      can never call the same patient. A client-generated request id makes a
--      retried / double-clicked request return the first result.
--   4. iapp.recall_patient() — repeat the announcement for a patient who is
--      already IN_CLINIC (writes a 'recall' event; no state change).
--   5. iapp.v_queue_tickets — stable per-clinic/day queue number (ticket) so
--      reception and the TV agree on "number 7" when names are hidden.
--   6. iapp.display_devices + create/revoke/rename functions — a registry of
--      TV screens. A screen holds a long random token; only its SHA-256 is
--      stored. A screen has NO user account and NO table access.
--   7. public.display_queue(token) — the only thing an anonymous screen can
--      call. SECURITY DEFINER, read-only, returns a minimal whitelist of
--      fields (see its comment). Names are returned ONLY if the device was
--      registered with show_names = true (default false), and then only the
--      first word. Never phone, national id, patient code, notes, diagnosis.
--
-- ROLLBACK (all additive, safe to reverse):
--   drop function public.display_queue(text);
--   drop function iapp.display_snapshot(text);
--   drop function iapp.set_display_device_names(uuid, boolean);
--   drop function iapp.revoke_display_device(uuid);
--   drop function iapp.create_display_device(uuid, text, boolean);
--   drop function iapp.recall_patient(uuid, uuid);
--   drop function iapp.call_next_patient(uuid, uuid, text, uuid, date);
--   drop view     iapp.v_queue_tickets;
--   drop trigger  trg_queue_call_log on iapp.appointments;
--   drop function iapp.tg_queue_call_log();
--   drop table    iapp.display_devices;
--   drop table    iapp.queue_calls;
-- =========================================================================

-- ── 1. call / re-call event log ──────────────────────────────────────────
create table if not exists iapp.queue_calls (
  id              bigint generated always as identity primary key,
  appointment_id  uuid        not null references iapp.appointments(id),
  clinic_id       uuid        not null references iapp.clinics(id),
  doctor_id       uuid,
  room            text,
  kind            text        not null check (kind in ('call', 'recall')),
  via             text        not null default 'direct'
                              check (via in ('direct', 'next', 'recall')),
  request_id      uuid        not null,
  called_by       uuid,
  called_by_role  text,
  called_at       timestamptz not null default now(),
  constraint queue_calls_request_id_key unique (request_id)
);

create index if not exists idx_queue_calls_clinic_recent
  on iapp.queue_calls (clinic_id, id desc);
create index if not exists idx_queue_calls_appointment
  on iapp.queue_calls (appointment_id, id desc);

comment on table iapp.queue_calls is
  'Append-only log of patient call / re-call events, written only by the call trigger and iapp.recall_patient. Holds ids, room and timestamps only. request_id is unique, which is what makes a retried or double-clicked request idempotent.';

create or replace function iapp.tg_queue_calls_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'queue_calls is append-only';
end $$;

drop trigger if exists trg_queue_calls_append_only on iapp.queue_calls;
create trigger trg_queue_calls_append_only
  before update or delete on iapp.queue_calls
  for each row execute function iapp.tg_queue_calls_append_only();

alter table iapp.queue_calls enable row level security;

drop policy if exists queue_calls_staff_read on iapp.queue_calls;
create policy queue_calls_staff_read on iapp.queue_calls
  for select to authenticated
  using (
    iapp.is_doctor()
    or (iapp.is_secretary() and clinic_id in (select iapp.my_clinic_ids()))
  );

revoke all on iapp.queue_calls from public, anon, authenticated;
grant select on iapp.queue_calls to authenticated;

-- ── 2. the trigger: every entry into IN_CLINIC is a call ────────────────
create or replace function iapp.tg_queue_call_log() returns trigger
language plpgsql security definer
set search_path = iapp, public
as $$
declare
  v_req   uuid;
  v_via   text;
  v_room  text;
  v_role  text;
begin
  v_req  := coalesce(nullif(current_setting('iapp.call_request_id', true), '')::uuid,
                     gen_random_uuid());
  v_via  := coalesce(nullif(current_setting('iapp.call_via', true), ''), 'direct');
  v_room := coalesce(nullif(btrim(current_setting('iapp.call_room', true)), ''),
                     nullif(btrim(new.room), ''));
  v_role := nullif(current_setting('iapp.acting_role', true), '');

  insert into iapp.queue_calls
    (appointment_id, clinic_id, doctor_id, room, kind, via,
     request_id, called_by, called_by_role)
  values
    (new.id, new.clinic_id, new.doctor_id, v_room, 'call', v_via,
     v_req, auth.uid(), v_role);
  return null;
end $$;

drop trigger if exists trg_queue_call_log on iapp.appointments;
create trigger trg_queue_call_log
  after update of status on iapp.appointments
  for each row
  when (new.status = 'IN_CLINIC' and old.status is distinct from 'IN_CLINIC')
  execute function iapp.tg_queue_call_log();

-- ── 3. call the next patient (atomic, idempotent) ───────────────────────
create or replace function iapp.call_next_patient(
  p_clinic_id  uuid,
  p_doctor_id  uuid    default null,
  p_room       text    default null,
  p_request_id uuid    default null,
  p_date       date    default null
) returns table (
  call_id        bigint,
  appointment_id uuid,
  kind           text,
  room           text,
  called_at      timestamptz,
  deduped        boolean
)
language plpgsql security definer
set search_path = iapp, public
as $$
declare
  v_role  text := iapp.acting_role();
  v_req   uuid := coalesce(p_request_id, gen_random_uuid());
  v_tz    text;
  v_day   date;
  v_appt  iapp.appointments;
  v_call  iapp.queue_calls;
begin
  -- Who may call is whatever the workflow table says for WAITING -> IN_CLINIC.
  if not exists (
    select 1 from iapp.appointment_transitions t
     where t.from_status = 'WAITING' and t.to_status = 'IN_CLINIC'
       and v_role = any (t.allowed_roles)
  ) then
    raise exception 'forbidden_transition: role % may not call patients', v_role
      using errcode = '42501';
  end if;

  if p_clinic_id is null
     or p_clinic_id not in (select iapp.my_clinic_ids()) then
    raise exception 'forbidden: clinic is outside your scope' using errcode = '42501';
  end if;

  select c.timezone into v_tz from iapp.clinics c where c.id = p_clinic_id;
  if v_tz is null then
    raise exception 'not_found: clinic does not exist' using errcode = 'P0002';
  end if;
  v_day := coalesce(p_date, (now() at time zone v_tz)::date);

  -- One "call next" at a time per clinic/doctor. Anything arriving together
  -- waits here, then sees the first one's result.
  perform pg_advisory_xact_lock(
    hashtextextended('call_next:' || p_clinic_id::text || ':' || coalesce(p_doctor_id::text, ''), 0));

  -- Same click retried / double-clicked: return what already happened.
  select * into v_call from iapp.queue_calls q where q.request_id = v_req;
  if found then
    return query select v_call.id, v_call.appointment_id, v_call.kind,
                        v_call.room, v_call.called_at, true;
    return;
  end if;

  -- Clinic priority: longest wait first (whole minutes, as the board shows
  -- them), then earlier scheduled time, then arrival order for determinism.
  select a.* into v_appt
    from iapp.appointments a
   where a.deleted_at is null
     and a.clinic_id = p_clinic_id
     and a.scheduled_date = v_day
     and a.status in ('ARRIVED', 'WAITING')
     and (p_doctor_id is null or a.doctor_id = p_doctor_id)
   order by round(extract(epoch from (now() - a.arrived_at)) / 60) desc nulls last,
            a.scheduled_time asc nulls last,
            a.arrived_at asc nulls last,
            a.id
   limit 1
     for update skip locked;

  if not found then
    raise exception 'queue_empty: nobody is waiting' using errcode = 'P0002';
  end if;

  perform set_config('iapp.call_request_id', v_req::text, true);
  perform set_config('iapp.call_via', 'next', true);
  perform set_config('iapp.call_room', coalesce(p_room, ''), true);

  -- ARRIVED -> WAITING -> IN_CLINIC: both are existing legal moves, each
  -- checked against the caller's role by iapp.transition().
  if v_appt.status = 'ARRIVED' then
    perform iapp.transition(v_appt.id, 'WAITING');
  end if;
  perform iapp.transition(v_appt.id, 'IN_CLINIC');

  select * into v_call from iapp.queue_calls q where q.request_id = v_req;
  if not found then
    raise exception 'call_not_recorded: call event missing' using errcode = 'XX000';
  end if;

  return query select v_call.id, v_call.appointment_id, v_call.kind,
                      v_call.room, v_call.called_at, false;
end $$;

-- ── 4. re-call (announce again, no state change) ────────────────────────
create or replace function iapp.recall_patient(
  p_appointment_id uuid,
  p_request_id     uuid default null
) returns table (
  call_id        bigint,
  appointment_id uuid,
  kind           text,
  room           text,
  called_at      timestamptz,
  deduped        boolean
)
language plpgsql security definer
set search_path = iapp, public
as $$
declare
  v_role  text := iapp.acting_role();
  v_req   uuid := coalesce(p_request_id, gen_random_uuid());
  v_appt  iapp.appointments;
  v_last  iapp.queue_calls;
  v_call  iapp.queue_calls;
begin
  if not exists (
    select 1 from iapp.appointment_transitions t
     where t.from_status = 'WAITING' and t.to_status = 'IN_CLINIC'
       and v_role = any (t.allowed_roles)
  ) then
    raise exception 'forbidden_transition: role % may not call patients', v_role
      using errcode = '42501';
  end if;

  select * into v_appt from iapp.appointments a
   where a.id = p_appointment_id and a.deleted_at is null
   for update;
  if not found or v_appt.clinic_id not in (select iapp.my_clinic_ids()) then
    raise exception 'not_found: appointment does not exist' using errcode = 'P0002';
  end if;

  select * into v_call from iapp.queue_calls q where q.request_id = v_req;
  if found then
    return query select v_call.id, v_call.appointment_id, v_call.kind,
                        v_call.room, v_call.called_at, true;
    return;
  end if;

  if v_appt.status <> 'IN_CLINIC' then
    raise exception 'not_called: patient is not currently called' using errcode = '23514';
  end if;

  -- Two devices pressing "re-call" together announce once, not twice.
  select * into v_last from iapp.queue_calls q
   where q.appointment_id = v_appt.id order by q.id desc limit 1;
  if found and v_last.called_at > now() - interval '2 seconds' then
    return query select v_last.id, v_last.appointment_id, v_last.kind,
                        v_last.room, v_last.called_at, true;
    return;
  end if;

  insert into iapp.queue_calls
    (appointment_id, clinic_id, doctor_id, room, kind, via,
     request_id, called_by, called_by_role)
  values
    (v_appt.id, v_appt.clinic_id, v_appt.doctor_id,
     coalesce(nullif(btrim(v_last.room), ''), nullif(btrim(v_appt.room), '')),
     'recall', 'recall', v_req, auth.uid(), v_role)
  returning * into v_call;

  return query select v_call.id, v_call.appointment_id, v_call.kind,
                      v_call.room, v_call.called_at, false;
end $$;

-- ── 5. stable queue numbers shared by reception and the screen ──────────
create or replace view iapp.v_queue_tickets with (security_invoker = true) as
  select a.id        as appointment_id,
         a.clinic_id,
         a.scheduled_date,
         (row_number() over (
            partition by a.clinic_id, a.scheduled_date
            order by a.arrived_at, a.id))::int as ticket_no
    from iapp.appointments a
   where a.arrived_at is not null
     and a.deleted_at is null;

comment on view iapp.v_queue_tickets is
  'Queue number per clinic and day, in order of arrival. Counts everyone who arrived (including later cancellations) so a number never changes once issued. The public screen computes the same numbering in iapp.display_snapshot.';

revoke all on iapp.v_queue_tickets from public, anon, authenticated;
grant select on iapp.v_queue_tickets to authenticated;

-- ── 6. registered display screens ───────────────────────────────────────
create table if not exists iapp.display_devices (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid        not null references iapp.clinics(id),
  label        text        not null check (length(btrim(label)) between 2 and 80),
  token_hash   text        not null unique,
  show_names   boolean     not null default false,
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  last_seen_at timestamptz,
  revoked_at   timestamptz
);

comment on table iapp.display_devices is
  'TV / waiting-room screens. token_hash is the SHA-256 of a random token shown once at creation; the token itself is never stored. show_names defaults to false (queue numbers only).';

alter table iapp.display_devices enable row level security;

drop policy if exists display_devices_staff_read on iapp.display_devices;
create policy display_devices_staff_read on iapp.display_devices
  for select to authenticated
  using (iapp.is_doctor());

revoke all on iapp.display_devices from public, anon, authenticated;
grant select (id, clinic_id, label, show_names, is_active, created_at, last_seen_at, revoked_at)
  on iapp.display_devices to authenticated;

create or replace function iapp.create_display_device(
  p_clinic_id  uuid,
  p_label      text,
  p_show_names boolean default false
) returns table (device_id uuid, token text)
language plpgsql security definer
set search_path = iapp, public
as $$
declare
  v_token text;
  v_id    uuid;
begin
  if not iapp.is_doctor() then
    raise exception 'forbidden: doctor or admin role required' using errcode = '42501';
  end if;
  if not exists (select 1 from iapp.clinics c where c.id = p_clinic_id and c.is_active) then
    raise exception 'not_found: clinic does not exist' using errcode = 'P0002';
  end if;

  -- 2 x 122 random bits from the database's CSPRNG; shown once, stored hashed.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into iapp.display_devices (clinic_id, label, token_hash, show_names, created_by)
  values (p_clinic_id, btrim(p_label),
          encode(sha256(convert_to(v_token, 'utf8')), 'hex'),
          coalesce(p_show_names, false), auth.uid())
  returning id into v_id;

  return query select v_id, v_token;
end $$;

create or replace function iapp.revoke_display_device(p_id uuid) returns void
language plpgsql security definer
set search_path = iapp, public
as $$
begin
  if not iapp.is_doctor() then
    raise exception 'forbidden: doctor or admin role required' using errcode = '42501';
  end if;
  update iapp.display_devices
     set is_active = false, revoked_at = coalesce(revoked_at, now())
   where id = p_id;
  if not found then
    raise exception 'not_found: display does not exist' using errcode = 'P0002';
  end if;
end $$;

create or replace function iapp.set_display_device_names(p_id uuid, p_show boolean) returns void
language plpgsql security definer
set search_path = iapp, public
as $$
begin
  if not iapp.is_doctor() then
    raise exception 'forbidden: doctor or admin role required' using errcode = '42501';
  end if;
  update iapp.display_devices set show_names = coalesce(p_show, false) where id = p_id;
  if not found then
    raise exception 'not_found: display does not exist' using errcode = 'P0002';
  end if;
end $$;

-- ── 7. what an anonymous screen may read ────────────────────────────────
-- Whitelist, by construction (nothing is selected that is not listed here):
--   clinic name, today's date, whether names are shown, an opaque call id,
--   per patient: queue number, doctor short name, room, status bucket,
--   waiting minutes, call time — and the first word of the name ONLY when the
--   device was registered with show_names = true.
create or replace function iapp.display_snapshot(p_token text) returns jsonb
language plpgsql security definer
set search_path = iapp, public
as $$
declare
  v_dev      iapp.display_devices;
  v_clinic   text;
  v_tz       text;
  v_day      date;
  v_current  jsonb;
  v_waiting  jsonb;
  v_count    int;
  v_latest   bigint;
begin
  select * into v_dev from iapp.display_devices d
   where d.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
     and d.is_active and d.revoked_at is null;
  if not found then
    raise exception 'invalid_display_token: display is not registered' using errcode = '28000';
  end if;

  if v_dev.last_seen_at is null or v_dev.last_seen_at < now() - interval '60 seconds' then
    update iapp.display_devices set last_seen_at = now() where id = v_dev.id;
  end if;

  select c.name_ar, c.timezone into v_clinic, v_tz from iapp.clinics c where c.id = v_dev.clinic_id;
  v_day := (now() at time zone v_tz)::date;

  with tk as (
    select a.id, (row_number() over (order by a.arrived_at, a.id))::int as ticket_no
      from iapp.appointments a
     where a.clinic_id = v_dev.clinic_id and a.scheduled_date = v_day
       and a.arrived_at is not null and a.deleted_at is null
  ),
  cur as (
    select a.id, tk.ticket_no, a.room as appt_room,
           coalesce(d.short_name, d.full_name_ar) as doctor,
           coalesce(p.full_name, a.guest_name) as full_name,
           lc.id as call_id, lc.kind, lc.called_at, lc.room as call_room
      from iapp.appointments a
      join tk on tk.id = a.id
      left join iapp.patients p on p.id = a.patient_id
      left join iapp.doctors  d on d.id = a.doctor_id
      left join lateral (
        select q.id, q.kind, q.called_at, q.room from iapp.queue_calls q
         where q.appointment_id = a.id order by q.id desc limit 1) lc on true
     where a.clinic_id = v_dev.clinic_id and a.scheduled_date = v_day
       and a.deleted_at is null and a.status = 'IN_CLINIC'
       and (a.patient_id is null or (p.id is not null and p.deleted_at is null))
     order by lc.id desc nulls last
     limit 8
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'call_id',   cur.call_id,
           'kind',      cur.kind,
           'ticket_no', cur.ticket_no,
           'name',      case when v_dev.show_names
                             then nullif(split_part(btrim(cur.full_name), ' ', 1), '') end,
           'doctor',    cur.doctor,
           'room',      coalesce(nullif(btrim(cur.call_room), ''), nullif(btrim(cur.appt_room), '')),
           'called_at', cur.called_at
         ) order by cur.call_id desc nulls last), '[]'::jsonb)
    into v_current from cur;

  with tk as (
    select a.id, (row_number() over (order by a.arrived_at, a.id))::int as ticket_no
      from iapp.appointments a
     where a.clinic_id = v_dev.clinic_id and a.scheduled_date = v_day
       and a.arrived_at is not null and a.deleted_at is null
  ),
  q as (
    select a.id, tk.ticket_no,
           coalesce(p.full_name, a.guest_name) as full_name,
           coalesce(d.short_name, d.full_name_ar) as doctor,
           round(extract(epoch from (now() - a.arrived_at)) / 60)::int as wait_minutes,
           a.scheduled_time, a.arrived_at
      from iapp.appointments a
      join tk on tk.id = a.id
      left join iapp.patients p on p.id = a.patient_id
      left join iapp.doctors  d on d.id = a.doctor_id
     where a.clinic_id = v_dev.clinic_id and a.scheduled_date = v_day
       and a.deleted_at is null and a.status in ('ARRIVED', 'WAITING')
       and (a.patient_id is null or (p.id is not null and p.deleted_at is null))
  )
  select count(*)::int,
         coalesce(jsonb_agg(jsonb_build_object(
           'ticket_no',    q.ticket_no,
           'name',         case when v_dev.show_names
                                then nullif(split_part(btrim(q.full_name), ' ', 1), '') end,
           'doctor',       q.doctor,
           'wait_minutes', q.wait_minutes
         ) order by q.wait_minutes desc nulls last, q.scheduled_time asc nulls last,
                    q.arrived_at asc nulls last, q.id) filter (where true), '[]'::jsonb)
    into v_count, v_waiting from q;

  select coalesce(max(qc.id), 0) into v_latest
    from iapp.queue_calls qc
   where qc.clinic_id = v_dev.clinic_id
     and (qc.called_at at time zone v_tz)::date = v_day;

  return jsonb_build_object(
    'server_time',    now(),
    'clinic_name',    v_clinic,
    'day',            v_day,
    'show_names',     v_dev.show_names,
    'latest_call_id', v_latest,
    'current',        v_current,
    'waiting',        v_waiting,
    'waiting_count',  v_count
  );
end $$;

-- The anonymous entry point lives in `public` (the only schema `anon` can see)
-- and is a thin wrapper. Default privileges in `public` grant EXECUTE to anon
-- on new functions, so the grants below are explicit.
create or replace function public.display_queue(p_token text) returns jsonb
language plpgsql security definer
set search_path = iapp, public
as $$
begin
  return iapp.display_snapshot(p_token);
end $$;

comment on function public.display_queue(text) is
  'Read-only queue snapshot for a registered display screen. Returns only: clinic name, day, queue numbers, doctor short name, room, waiting minutes, call ids/times and (only if the device allows) the first word of a name. Invalid or revoked token raises invalid_display_token.';

-- ── grants ──────────────────────────────────────────────────────────────
revoke all on function iapp.call_next_patient(uuid, uuid, text, uuid, date)   from public, anon;
revoke all on function iapp.recall_patient(uuid, uuid)                        from public, anon;
revoke all on function iapp.create_display_device(uuid, text, boolean)        from public, anon;
revoke all on function iapp.revoke_display_device(uuid)                       from public, anon;
revoke all on function iapp.set_display_device_names(uuid, boolean)           from public, anon;
revoke all on function iapp.display_snapshot(text)                            from public, anon, authenticated;
revoke all on function iapp.tg_queue_call_log()                               from public, anon, authenticated;
revoke all on function iapp.tg_queue_calls_append_only()                      from public, anon, authenticated;
revoke all on function public.display_queue(text)                             from public;

grant execute on function iapp.call_next_patient(uuid, uuid, text, uuid, date) to authenticated;
grant execute on function iapp.recall_patient(uuid, uuid)                      to authenticated;
grant execute on function iapp.create_display_device(uuid, text, boolean)      to authenticated;
grant execute on function iapp.revoke_display_device(uuid)                     to authenticated;
grant execute on function iapp.set_display_device_names(uuid, boolean)         to authenticated;
grant execute on function public.display_queue(text)                           to anon, authenticated;
