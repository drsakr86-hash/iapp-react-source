-- =========================================================================
-- I App — Secretary reception queue + scoped consultation-fee collection
-- =========================================================================
-- STATUS: PROPOSED MIGRATION FILE ONLY. NOT APPLIED TO SUPABASE.
--
-- DEPENDS ON 20260906010000_accounting_ledger.sql (iapp.accounts,
-- iapp.payment_methods, iapp.financial_transactions, iapp.next_receipt_no).
-- That migration must be applied FIRST — this one will fail on an empty
-- database. Read its own header before applying either.
--
-- Booking itself needs no change here: iapp.book_appointment already
-- permits the secretary role (`v_role in ('secretary','doctor','admin')`,
-- verified in the live production schema dump). This migration only adds
-- what secretary does NOT yet have:
--
--   1. iapp.is_doctor_admin_or_secretary() / assert_...() — a new, narrow
--      role helper used ONLY by #2 below. It does not touch or widen
--      iapp.assert_doctor_or_admin(), which keeps gating every other
--      accounting RPC (create_revenue, create_expense, create_refund,
--      create_transfer, create_adjustment, create_opening_balance,
--      create_daily_closing) exactly as before. Secretary is granted
--      execute on none of those — only on #2.
--
--   2. iapp.record_consultation_payment(...) — the one financial write
--      secretary may perform. Same write path as record_patient_payment
--      (one row into iapp.payments, one into iapp.financial_transactions,
--      same receipt sequence) — this is not a new model, just the
--      existing one opened to a second, more limited role.
--
--   3. An idempotent data fix on iapp.appointment_transitions: adds
--      'secretary' to allowed_roles for the reception-facing transitions
--      (ARRIVED, WAITING, CANCELLED, NO_SHOW) where it is not already
--      present. IN_CLINIC ("نداء للكشف" — calling the patient in) and
--      COMPLETED stay doctor/admin only; this file does not touch them.
--      Safe to re-run: the WHERE clause skips rows that already have it.
-- =========================================================================

-- ── narrow role helper — used only by record_consultation_payment ───────
create or replace function iapp.is_doctor_admin_or_secretary()
returns boolean
language sql stable security invoker
set search_path = pg_catalog, iapp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('doctor', 'admin', 'secretary')
  );
$$;

create or replace function iapp.assert_doctor_admin_or_secretary()
returns void
language plpgsql security invoker
set search_path = pg_catalog, iapp
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not iapp.is_doctor_admin_or_secretary() then
    raise exception 'not authorized: doctor, admin or secretary role required';
  end if;
end;
$$;

-- ── the one financial write secretary can perform ────────────────────────
create or replace function iapp.record_consultation_payment(
  p_patient_id uuid, p_visit_id uuid, p_clinic_id uuid, p_service_id uuid,
  p_account_id uuid, p_amount numeric, p_payment_method_id uuid,
  p_notes text, p_transaction_date date default current_date
) returns table (payment_id uuid, transaction_id uuid, receipt_no text)
language plpgsql security definer
set search_path = pg_catalog, iapp
as $$
declare
  v_payment_id uuid;
  v_txn_id uuid;
  v_receipt text;
  v_currency char(3);
  v_legacy_method iapp.payment_method;
  v_method_code text;
begin
  perform iapp.assert_doctor_admin_or_secretary();

  if p_amount is null or p_amount <= 0 then
    raise exception 'payment amount must be positive';
  end if;
  if p_account_id is null then
    raise exception 'an account must be selected';
  end if;

  select currency into v_currency from iapp.accounts where id = p_account_id;
  if v_currency is null then raise exception 'account % not found', p_account_id; end if;

  select code into v_method_code from iapp.payment_methods where id = p_payment_method_id;
  v_legacy_method := case v_method_code
    when 'bank_transfer' then 'transfer'::iapp.payment_method
    when 'cash' then 'cash'::iapp.payment_method
    when 'card' then 'card'::iapp.payment_method
    when 'insurance' then 'insurance'::iapp.payment_method
    else 'other'::iapp.payment_method
  end;

  v_receipt := iapp.next_receipt_no(p_clinic_id);

  insert into iapp.payments
    (patient_id, visit_id, clinic_id, service_id, amount, amount_paid, discount,
     currency, method, status, receipt_no, notes, paid_at)
  values
    (p_patient_id, p_visit_id, p_clinic_id, p_service_id, p_amount, p_amount, 0,
     v_currency, v_legacy_method, 'paid', v_receipt, p_notes, now())
  returning id into v_payment_id;

  insert into iapp.financial_transactions
    (transaction_type, account_id, clinic_id, amount, currency, transaction_date,
     description, patient_id, visit_id, service_id, payment_method_id, receipt_no,
     legacy_payment_id)
  values
    ('revenue', p_account_id, p_clinic_id, p_amount, v_currency, p_transaction_date,
     p_notes, p_patient_id, p_visit_id, p_service_id, p_payment_method_id, v_receipt,
     v_payment_id)
  returning id into v_txn_id;

  return query select v_payment_id, v_txn_id, v_receipt;
end;
$$;

revoke execute on function iapp.record_consultation_payment(
  uuid, uuid, uuid, uuid, uuid, numeric, uuid, text, date) from public;
grant execute on function iapp.record_consultation_payment(
  uuid, uuid, uuid, uuid, uuid, numeric, uuid, text, date) to authenticated;

-- ── reception queue actions for secretary — idempotent data fix ─────────
update iapp.appointment_transitions
set allowed_roles = array_append(allowed_roles, 'secretary')
where to_status in ('ARRIVED', 'WAITING', 'CANCELLED', 'NO_SHOW')
  and not ('secretary' = any(allowed_roles));
