/* -------------------------------------------------------------------------
 * QueueCallPanel — waiting list with queue numbers and the calling tools.
 * -------------------------------------------------------------------------
 * Used on the reception screen and the doctor's day screen. It adds NO
 * workflow of its own:
 *   - who may call comes from the workflow table (queue.canCall); a role the
 *     clinic has not allowed simply sees the numbered list without buttons,
 *   - "next" is decided by the database (iapp.call_next_patient), which also
 *     refuses double calls; the order shown here is the same priority,
 *   - every click carries a request id so a double-click or a retry after a
 *     dropped connection cannot call two people.
 * Start/finish of the exam stays where it was: "بدء الكشف" opens the visit,
 * completing the visit completes the appointment.
 * ---------------------------------------------------------------------- */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Tag } from '../ui';
import { useConfirm } from '../../hooks/useConfirm';
import { useToast } from '../../hooks/useToast';
import * as appointments from '../../services/appointments';
import type { BoardRow } from '../../services/appointments';
import * as queue from '../../services/queue';
import { orderWaitingQueue } from '../../utils/appointmentFilters';

const NETWORK_MSG = /تعذّر الاتصال/;

export function QueueCallPanel({
  rows,
  role,
  doctorId = null,
  showNext = true,
  onChanged,
}: {
  /** Today's appointments as the page already loaded them. */
  rows: BoardRow[];
  role: string;
  /** Set on the doctor's own screen: "next" is then limited to this doctor. */
  doctorId?: string | null;
  /** The doctor's screen already has its own big "call next" button. */
  showNext?: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [mayCall, setMayCall] = useState(false);
  const [tickets, setTickets] = useState<Map<string, number>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [doctorFilter, setDoctorFilter] = useState<string>('');
  /* One request id per logical click, kept until the server has answered. */
  const requestIds = useRef(new Map<string, string>());

  useEffect(() => {
    let alive = true;
    void queue.canCall(role).then((v) => alive && setMayCall(v));
    return () => {
      alive = false;
    };
  }, [role]);

  const date = rows[0]?.scheduled_date ?? null;
  const signature = rows.map((r) => `${r.id}:${r.status}`).join('|');
  useEffect(() => {
    if (!date) return;
    let alive = true;
    queue
      .loadTickets(date)
      .then((m) => alive && setTickets(m))
      .catch(() => undefined); // numbers are a convenience; the list still works without them
    return () => {
      alive = false;
    };
    // `signature` re-runs this when anybody arrives, is called or leaves.
  }, [date, signature]);

  const scoped = useMemo(
    () => rows.filter((r) => (doctorId ? r.doctor_id === doctorId : doctorFilter ? r.doctor_id === doctorFilter : true)),
    [rows, doctorId, doctorFilter],
  );
  const waiting = useMemo(() => orderWaitingQueue(scoped), [scoped]);
  const inClinic = useMemo(() => scoped.filter((r) => r.status === 'IN_CLINIC'), [scoped]);
  const next = waiting[0] ?? null;

  const doctors = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      if (['ARRIVED', 'WAITING'].includes(r.status ?? '') && r.doctor_id) {
        m.set(r.doctor_id, r.doctor_short || r.doctor_name || 'طبيب');
      }
    }
    return [...m.entries()];
  }, [rows]);

  const ticketOf = (id: string) => tickets.get(id);
  const who = (a: BoardRow) => {
    const n = ticketOf(a.id);
    return `${n != null ? `رقم ${n}` : ''}${a.display_name ? `${n != null ? ' — ' : ''}${a.display_name}` : ''}`.trim() || 'المريض';
  };

  const idFor = (key: string) => {
    let id = requestIds.current.get(key);
    if (!id) {
      id = queue.newRequestId();
      requestIds.current.set(key, id);
    }
    return id;
  };

  /* Run one action with the shared busy/error/refresh handling. */
  const run = useCallback(
    async (key: string, work: () => Promise<string | void>) => {
      if (busy) return;
      setBusy(key);
      try {
        const msg = await work();
        requestIds.current.delete(key);
        if (msg) toast.success(msg);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'تعذّر تنفيذ الإجراء';
        // A dropped connection keeps the same request id, so pressing again is safe.
        if (!NETWORK_MSG.test(message)) requestIds.current.delete(key);
        toast.error(message);
      } finally {
        setBusy(null);
        onChanged();
      }
    },
    [busy, onChanged, toast],
  );

  async function callNext() {
    if (!next) return;
    const mine = doctorId ? inClinic.find((r) => r.doctor_id === doctorId) : null;
    if (
      mine &&
      !(await confirm({
        title: 'نداء المريض التالي',
        message: `يوجد مريض داخل العيادة الآن (${mine.display_name ?? 'بدون اسم'}). هل تريد النداء مع ذلك؟`,
        confirmLabel: 'نداء',
      }))
    ) {
      return;
    }
    await run('next', async () => {
      const r = await queue.callNext({
        clinicId: next.clinic_id ?? '',
        doctorId: doctorId ?? (doctorFilter || null),
        requestId: idFor('next'),
      });
      const called = rows.find((x) => x.id === r.appointmentId);
      return r.deduped ? 'تم النداء قبل لحظات' : `تم نداء ${called ? who(called) : 'المريض التالي'}`;
    });
  }

  async function callOne(a: BoardRow) {
    await run(`call:${a.id}`, async () => {
      // A patient who has arrived but is not yet in the waiting room takes the
      // two legal steps in order (ARRIVED → WAITING → IN_CLINIC).
      if (a.status === 'ARRIVED') await appointments.wait(a.id);
      await queue.callSpecific(a.id);
      return `تم نداء ${who(a)}`;
    });
  }

  async function recallOne(a: BoardRow) {
    await run(`recall:${a.id}`, async () => {
      const r = await queue.recall(a.id, idFor(`recall:${a.id}`));
      return r.deduped ? 'تم النداء قبل لحظات' : `تمت إعادة نداء ${who(a)}`;
    });
  }

  async function cancelOne(a: BoardRow) {
    if (
      !(await confirm({
        title: 'إلغاء النداء',
        message: `إرجاع ${a.display_name ?? 'المريض'} إلى الانتظار؟ سيحتفظ بدوره في القائمة.`,
        confirmLabel: 'إرجاع',
      }))
    ) {
      return;
    }
    await run(`cancel:${a.id}`, async () => {
      await queue.cancelCall(a.id);
      return `أُعيد ${who(a)} إلى الانتظار`;
    });
  }

  if (!waiting.length && !inClinic.length && !doctors.length) {
    return (
      <Card title="نداء المرضى">
        <p className="muted">لا يوجد مرضى في الانتظار الآن.</p>
      </Card>
    );
  }

  return (
    <Card title={`نداء المرضى — في الانتظار (${waiting.length})`}>
      <div className="stack">
        {!doctorId && doctors.length > 1 ? (
          <label className="field">
            <span className="field__label">الطبيب</span>
            <select value={doctorFilter} onChange={(e) => setDoctorFilter(e.target.value)}>
              <option value="">كل الأطباء</option>
              {doctors.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {mayCall && showNext ? (
          <Button full disabled={!next || busy !== null} onClick={() => void callNext()}>
            {busy === 'next'
              ? 'جارٍ النداء…'
              : next
                ? `📣 نادِ التالي: ${who(next)}`
                : 'لا يوجد مرضى في الانتظار'}
          </Button>
        ) : null}
        {!mayCall ? (
          <p className="muted">أرقام الانتظار للاطلاع فقط — نداء المرضى متاح لمن تسمح له قواعد العيادة.</p>
        ) : null}

        {waiting.map((a, i) => (
          <div className="row" key={a.id} style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span>
              <strong>{ticketOf(a.id) != null ? `#${ticketOf(a.id)}` : `${i + 1}.`}</strong>{' '}
              {a.display_name ?? 'بدون اسم'}
              {appointments.waitLabel(a) ? <span className="muted"> · منذ {appointments.waitLabel(a)}</span> : null}
            </span>
            {mayCall ? (
              <Button variant="outline" disabled={busy !== null} onClick={() => void callOne(a)}>
                {busy === `call:${a.id}` ? '…' : 'نداء'}
              </Button>
            ) : null}
          </div>
        ))}

        {inClinic.length ? (
          <>
            <h3 className="muted" style={{ margin: '8px 0 0' }}>تم نداؤهم / داخل العيادة ({inClinic.length})</h3>
            {inClinic.map((a) => (
              <div className="row" key={a.id} style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span>
                  <strong>{ticketOf(a.id) != null ? `#${ticketOf(a.id)}` : ''}</strong> {a.display_name ?? 'بدون اسم'}{' '}
                  {a.room ? <Tag label={`غرفة ${a.room}`} color="var(--gold)" /> : null}
                </span>
                <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {mayCall ? (
                    <>
                      <Button variant="outline" disabled={busy !== null} onClick={() => void recallOne(a)}>
                        {busy === `recall:${a.id}` ? '…' : '🔁 إعادة النداء'}
                      </Button>
                      <Button variant="outline" disabled={busy !== null} onClick={() => void cancelOne(a)}>
                        إلغاء النداء
                      </Button>
                    </>
                  ) : null}
                  {role !== 'secretary' && a.patient_id ? (
                    <Link
                      className="chip chip--primary"
                      to={`/doctor/patients/${a.patient_id}?appointment=${a.id}&action=visit`}
                    >
                      بدء الكشف
                    </Link>
                  ) : null}
                </span>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </Card>
  );
}
