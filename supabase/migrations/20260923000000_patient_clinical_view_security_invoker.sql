-- Harden v_patient_clinical so it respects RLS on the caller's own privileges
-- instead of running as the view owner.
alter view iapp.v_patient_clinical set (security_invoker = true);

-- security_invoker requires the querying role to have its own grant on the
-- underlying table; iapp.patients previously had INSERT only for
-- 'authenticated', which the owner-privileged view silently worked around.
grant select on iapp.patients to authenticated;
