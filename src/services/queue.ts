/* -------------------------------------------------------------------------
 * queue service — calling patients, for staff screens.
 * -------------------------------------------------------------------------
 * Boundary over the database, like appointments.ts: no state machine, no
 * queue-ordering rules and no concurrency logic here. The database decides
 * who is next (iapp.call_next_patient), who may call (the WAITING -> IN_CLINIC
 * row of iapp.appointment_transitions) and refuses a double call. This file
 * only sends the request and translates the answer.
 *
 * Every state-changing request carries a client-generated request id. If the
 * same click is sent twice (double-click, a retry after a dropped
 * connection) the database returns the first result instead of acting twice.
 * ---------------------------------------------------------------------- */

import { supabase } from './supabase';
import * as appointments from './appointments';
import { reportError } from '../utils/errors';

export interface CallResult {
  callId: number;
  appointmentId: string;
  kind: 'call' | 'recall';
  room: string | null;
  calledAt: string;
  /** true = this request had already been processed (or another device just did the same): nothing new happened. */
  deduped: boolean;
}

/** One id per click. crypto.randomUUID needs a secure context (https/localhost), which Pages is. */
export function newRequestId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type RawCall = {
  call_id: number;
  appointment_id: string;
  kind: string;
  room: string | null;
  called_at: string;
  deduped: boolean;
};

function toResult(rows: RawCall[] | null): CallResult {
  const r = rows?.[0];
  if (!r) throw new Error('تعذّر تسجيل النداء — حاول مرة أخرى');
  return {
    callId: r.call_id,
    appointmentId: r.appointment_id,
    kind: r.kind === 'recall' ? 'recall' : 'call',
    room: r.room,
    calledAt: r.called_at,
    deduped: r.deduped,
  };
}

/**
 * Call the next patient of a clinic (optionally of one doctor). The database
 * picks and locks the patient, so two devices pressing this together call two
 * different patients, never the same one twice.
 */
export async function callNext(opts: {
  clinicId: string;
  doctorId?: string | null;
  room?: string | null;
  requestId: string;
  /** Clinic-local day (YYYY-MM-DD). Omit to let the database use the clinic's own time zone. */
  date?: string;
}): Promise<CallResult> {
  const { data, error } = await supabase.rpc('call_next_patient', {
    p_clinic_id: opts.clinicId,
    p_doctor_id: opts.doctorId ?? undefined,
    p_room: opts.room ?? undefined,
    p_request_id: opts.requestId,
    p_date: opts.date,
  });
  if (error) throw new Error(reportError(error, 'النداء'));
  return toResult(data as RawCall[] | null);
}

/** Announce an already-called patient again. No state change. */
export async function recall(appointmentId: string, requestId: string): Promise<CallResult> {
  const { data, error } = await supabase.rpc('recall_patient', {
    p_appointment_id: appointmentId,
    p_request_id: requestId,
  });
  if (error) throw new Error(reportError(error, 'إعادة النداء'));
  return toResult(data as RawCall[] | null);
}

/** Call one specific patient — the existing call_patient move, unchanged. */
export const callSpecific = (appointmentId: string) => appointments.callPatient(appointmentId);

/**
 * Cancel a call: IN_CLINIC -> WAITING. The patient keeps his arrival time, so
 * he keeps his place in the queue.
 */
export const cancelCall = (appointmentId: string) => appointments.wait(appointmentId);

/**
 * May this role call patients? Read from the workflow table (never hard-coded)
 * so it follows the clinic's rule: today only doctor/admin, and the day the
 * clinic lets reception call, it appears here with no code change.
 */
export async function canCall(role: string): Promise<boolean> {
  try {
    const all = await appointments.loadTransitions();
    return all.some((t) => {
      const row = t as { from_status?: string; to_status?: string; allowed_roles?: string[] | string };
      if (row.from_status !== 'WAITING' || row.to_status !== 'IN_CLINIC') return false;
      let roles = row.allowed_roles ?? [];
      if (typeof roles === 'string') roles = roles.replace(/^[{"]+|[}"]+$/g, '').split(/["\s]*,[ "\s]*/);
      return Array.isArray(roles) && roles.includes(role);
    });
  } catch {
    return false;
  }
}

/**
 * Queue number per appointment for a day (arrival order). The public screen
 * numbers patients the same way, so "number 7" means the same person on both.
 * Row access is the caller's own (RLS): a secretary gets her clinic only.
 */
export async function loadTickets(date: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('v_queue_tickets')
    .select('appointment_id, ticket_no')
    .eq('scheduled_date', date);
  if (error) throw new Error(reportError(error, 'أرقام الانتظار'));
  const map = new Map<string, number>();
  for (const r of data ?? []) {
    if (r.appointment_id && r.ticket_no != null) map.set(r.appointment_id, r.ticket_no);
  }
  return map;
}
