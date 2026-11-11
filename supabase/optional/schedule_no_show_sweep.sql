-- =========================================================================
-- OPTIONAL — NOT a migration, NOT applied anywhere. Run by hand when decided.
-- =========================================================================
-- iapp.sweep_no_shows() exists but nothing ever calls it, so past CONFIRMED
-- appointments stay "confirmed" forever. This schedules it nightly.
--
-- READ FIRST — it changes data:
--   * The first run marks EVERY past CONFIRMED appointment as NO_SHOW (14 of
--     them on 2026-10-14). Review them before enabling:
--       select id, scheduled_date, scheduled_time, clinic_id
--         from iapp.appointments
--        where deleted_at is null and status = 'CONFIRMED'
--          and scheduled_date < (now() at time zone 'Africa/Cairo')::date
--        order by 1, 2;
--   * It never touches ARRIVED / WAITING / IN_CLINIC (a patient who was seen
--     is never recorded as absent). Old rows stuck in those states must be
--     closed by a person, one by one.
--
-- 23:30 UTC = 01:30 / 02:30 Cairo, after every clinic has closed.
-- UNDO:  select cron.unschedule('iapp-sweep-no-shows');
-- =========================================================================
create extension if not exists pg_cron;

select cron.schedule(
  'iapp-sweep-no-shows',
  '30 23 * * *',
  $$select iapp.sweep_no_shows(120)$$
);
