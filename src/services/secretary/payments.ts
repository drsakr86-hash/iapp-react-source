/* -------------------------------------------------------------------------
 * secretary/payments.ts — the one financial write the secretary role may
 * perform: collecting the consultation fee at reception.
 * -------------------------------------------------------------------------
 * Wraps iapp.record_consultation_payment (see
 * supabase/migrations/20260911000000_secretary_reception_and_payment.sql).
 * PROVISIONAL, same as services/accounting/*: this RPC does not exist until
 * that migration — and its dependency, 20260906010000_accounting_ledger.sql
 * — are both applied. Not in the generated Database types yet, hence the
 * callRpc indirection (see accounting/_rpc.ts).
 *
 * This file must never grow a create_expense/create_refund/create_transfer
 * wrapper. Those stay doctor/admin-only by design — see the migration
 * header for why.
 * ---------------------------------------------------------------------- */

import { callRpc } from '../accounting/_rpc';

export interface RecordConsultationPaymentParams {
  p_patient_id: string;
  p_visit_id: string | null;
  p_clinic_id: string | null;
  p_service_id: string | null;
  p_account_id: string;
  p_amount: number;
  p_payment_method_id: string | null;
  p_notes: string | null;
  p_transaction_date?: string;
  p_appointment_id?: string | null;
}

export interface RecordConsultationPaymentResult {
  payment_id: string;
  transaction_id: string;
  receipt_no: string;
}

export async function recordConsultationPayment(
  p: RecordConsultationPaymentParams,
): Promise<RecordConsultationPaymentResult> {
  if (!(p.p_amount > 0)) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  if (!p.p_account_id) throw new Error('اختر الخزينة/الحساب');
  const rows = await callRpc<RecordConsultationPaymentResult[]>(
    'record_consultation_payment',
    p as unknown as Record<string, unknown>,
    'تحصيل رسم الكشف',
  );
  return rows[0];
}
