-- =========================================================================
-- Reception (secretary) may call patients
-- =========================================================================
-- Decision: Dr. Abdo, 2026-10-15 ("خلي السكرتيرة كمان تنادي").
-- "Calling" a patient is the move WAITING -> IN_CLINIC. Who may make it is data
-- in iapp.appointment_transitions.allowed_roles, so this is a one-row data
-- change; no function, policy or app code changes. The app (iapp.call_next_patient,
-- iapp.recall_patient, the call panel) reads this row, so reception sees the
-- call buttons as soon as the row changes.
-- Idempotent: running it twice changes nothing.
--
-- ROLLBACK:
--   update iapp.appointment_transitions
--      set allowed_roles = array_remove(allowed_roles, 'secretary')
--    where from_status = 'WAITING' and to_status = 'IN_CLINIC';
-- =========================================================================
update iapp.appointment_transitions
   set allowed_roles = array_append(allowed_roles, 'secretary')
 where from_status = 'WAITING'
   and to_status   = 'IN_CLINIC'
   and not ('secretary' = any (allowed_roles::text[]));
