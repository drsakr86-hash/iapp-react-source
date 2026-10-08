import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, ErrorState, SkeletonList, StatTile, Tag } from '../../components/ui';
import { MedValue } from '../../components/medical/Medical';
import { NewAppointmentForm } from '../../components/appointments/NewAppointmentForm';
import { useDoctor } from '../../hooks/useDoctor';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import * as appointments from '../../services/appointments';
import type { BoardRow } from '../../services/appointments';
import { useConfirm } from '../../hooks/useConfirm';
import { useToast } from '../../hooks/useToast';
import { today } from '../../utils/medical';
import {
  QUEUE_FILTERS,
  countByFilter,
  matchesFilter,
  orderForReception,
  pickNextInQueue,
  type QueueFilter,
} from '../../utils/appointmentFilters';

/** The queue changes while the doctor works; refresh quietly. */
const REFRESH_MS = 30_000;

export default function DoctorHome() {
  useDocumentTitle('اليوم');

  const { doctor, displayName } = useDoctor();

  const [list, setList] = useState<BoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [calling, setCalling] = useState(false);
  const toast = useToast();
  const { confirm } = useConfirm();

  const date = today();

  /* `quiet` refreshes keep the list on screen: no spinner flash, and a failed
     background refresh leaves the last good data instead of an error. */
  const load = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
      setError(null);
    }

    try {
      const rows = await appointments.board({
        date,
      });

      const doctorRows = doctor?.id
        ? rows.filter((row) => row.doctor_id === doctor.id)
        : rows;

      doctorRows.sort((a, b) =>
        String(a.scheduled_time ?? '').localeCompare(String(b.scheduled_time ?? '')),
      );

      setList(doctorRows);
      if (quiet) setError(null);
    } catch (e) {
      if (!quiet) setError(e instanceof Error ? e.message : 'تعذّر تحميل مواعيد اليوم');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [date, doctor?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && !booking) void load(true);
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [load, booking]);

  async function runAction(
    appointment: BoardRow,
    action: appointments.AppointmentAction,
  ) {
    setWorkingId(appointment.id);

    try {
      await action.run();

      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر تنفيذ الإجراء');
    } finally {
      setWorkingId(null);
    }
  }

  const counts = useMemo(() => countByFilter(list), [list]);
  const completed = list.filter((a) => a.status === 'COMPLETED').length;
  const visible = useMemo(
    () => orderForReception(list.filter((a) => matchesFilter(a, filter))),
    [list, filter],
  );
  const nextUp = useMemo(() => pickNextInQueue(list), [list]);
  const inClinicNow = list.find((a) => a.status === 'IN_CLINIC') ?? null;

  /* "Call next" uses the SAME database-driven transition the card button uses
     (actionsFor reads iapp.appointment_transitions), so it can never offer a
     move the workflow does not allow. */
  async function callNext() {
    if (!nextUp || calling) return;
    if (
      inClinicNow &&
      !(await confirm({
        title: 'نداء المريض التالي',
        message: `يوجد مريض داخل العيادة الآن (${inClinicNow.display_name ?? 'بدون اسم'}). هل تريد نداء ${nextUp.display_name ?? 'التالي'} مع ذلك؟`,
        confirmLabel: 'نداء',
      }))
    ) {
      return;
    }
    setCalling(true);
    try {
      const acts = await appointments.actionsFor(nextUp, 'doctor');
      const call = acts.find((x) => x.to === 'IN_CLINIC');
      if (!call) {
        toast.error('لا يمكن نداء هذا المريض في حالته الحالية');
        return;
      }
      await call.run();
      toast.success(`تم نداء ${nextUp.display_name ?? 'المريض'}`);
      await load(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذّر نداء المريض');
    } finally {
      setCalling(false);
    }
  }

  return (
    <div className="stack">

      <Card title={`أهلاً ${displayName}`}>
        <p className="muted">
          لوحة الطبيب اليومية — مواعيد اليوم وحالة المرضى.
        </p>

        <div
          className="row"
          style={{
            gap: 8,
            flexWrap: 'wrap',
            marginTop: 12,
          }}
        >
          <Tag label={`📅 ${date}`} color="var(--accent)" />
          <Tag label={`👥 ${list.length} موعد`} color="var(--teal)" />
          <Tag label={`✓ ${completed} مكتمل`} color="var(--success)" />
        </div>
      </Card>

      <div className="stats" role="group" aria-label="تصفية مواعيد اليوم حسب الحالة">
        {QUEUE_FILTERS.map((f) => (
          <StatTile
            key={f.key}
            label={f.label}
            value={counts[f.key]}
            active={filter === f.key}
            onClick={() => setFilter(f.key)}
            tone={f.key === 'waiting' && counts.waiting > 0 ? 'var(--gold)' : undefined}
          />
        ))}
      </div>

      <Button full disabled={!nextUp || calling} onClick={() => void callNext()}>
        {calling
          ? 'جارٍ النداء…'
          : nextUp
            ? `📣 نادِ التالي: ${nextUp.display_name ?? 'بدون اسم'}${
                nextUp.wait_minutes ? ` (ينتظر ${nextUp.wait_minutes} د)` : ''
              }`
            : 'لا يوجد مرضى في الانتظار'}
      </Button>

      <Card title="اليوم">
        <div
          className="row"
          style={{
            justifyContent: 'space-between',
            gap: 8,
            alignItems: 'end',
          }}
        >
          <div>
            <strong>{displayName}</strong>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {list.length
                ? `${list.length} موعد مسجل اليوم`
                : 'لا توجد مواعيد مسجلة اليوم'}
            </p>
          </div>

          <Button onClick={() => setBooking((v) => !v)}>
            {booking ? 'إغلاق' : 'حجز موعد جديد'}
          </Button>
        </div>
      </Card>

      {booking ? (
        <NewAppointmentForm
          defaultDoctorId={doctor?.id ?? null}
          onCreated={(row) => {
            setBooking(false);

            if (row.scheduled_date === date) {
              void load(true);
            }
          }}
          onCancel={() => setBooking(false)}
        />
      ) : null}

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <Card title={filter === 'all' ? `مواعيد اليوم (${list.length})` : `${QUEUE_FILTERS.find((f) => f.key === filter)?.label} (${visible.length} من ${list.length})`}>
        {loading ? <SkeletonList rows={3} label="جارٍ تحميل مواعيد اليوم…" /> : null}

        {!loading && !error && !list.length ? (
          <p className="muted">
            لا توجد مواعيد للدكتور {displayName} اليوم.
          </p>
        ) : null}

        {!loading && !error && list.length > 0 && !visible.length ? (
          <p className="muted">لا توجد مواعيد في هذه الحالة.</p>
        ) : null}

        {visible.map((a) => {
          const label = appointments.statusLabel(a.status ?? 'REQUESTED');

          return (
            <div className="rx-med" key={a.id}>

              <div
                className="row"
                style={{
                  justifyContent: 'space-between',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <strong>
                  <MedValue>
                    {String(a.scheduled_time).slice(0, 5)}
                  </MedValue>
                </strong>

                <Tag
                  label={`${label.icon} ${label.ar}`}
                  color={label.color}
                />
              </div>

              <p
                className="rx-med__sig"
                style={{ fontSize: 16, fontWeight: 600 }}
              >
                {a.display_name ?? a.patient_id ?? 'مريض غير محدد'}
              </p>

              {a.patient_code ? (
                <p className="muted">
                  كود المريض: {a.patient_code}
                </p>
              ) : null}

              <div
                className="row"
                style={{
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                {a.clinic_name ? (
                  <Tag
                    label={`🏥 ${a.clinic_name}`}
                    color="var(--muted)"
                  />
                ) : null}

                {a.doctor_name ? (
                  <Tag
                    label={`👨‍⚕️ ${a.doctor_name}`}
                    color="var(--accent)"
                  />
                ) : null}

                {a.wait_minutes != null && a.wait_minutes > 0 ? (
                  <Tag
                    label={`⏱ ${a.wait_minutes} دقيقة`}
                    color="var(--gold)"
                  />
                ) : null}
              </div>

              {a.appointment_type ? (
                <p className="muted">
                  نوع الموعد: {a.appointment_type}
                </p>
              ) : null}

              {a.notes ? (
                <p className="muted">
                  ملاحظات: {a.notes}
                </p>
              ) : null}

              {a.patient_id ? (
                <div className="row" style={{ marginTop: 8 }}>
                  <Link
                    className="chip chip--primary"
                    to={`/doctor/patients/${a.patient_id}?appointment=${a.id}&action=visit`}
                  >
                    فتح ملف المريض / بدء الكشف
                  </Link>
                </div>
              ) : null}

              <AppointmentActions
                appointment={a}
                working={workingId === a.id}
                onRun={(action) => void runAction(a, action)}
              />
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function AppointmentActions({
  appointment,
  working,
  onRun,
}: {
  appointment: BoardRow;
  working: boolean;
  onRun: (action: appointments.AppointmentAction) => void;
}) {
  const [actions, setActions] = useState<appointments.AppointmentAction[]>(
    [],
  );

  useEffect(() => {
    let active = true;

    appointments
      .actionsFor(appointment, 'doctor')
      .then((rows) => {
        if (active) setActions(rows);
      })
      .catch(() => {
        if (active) setActions([]);
      });

    return () => {
      active = false;
    };
  }, [appointment]);

  if (!actions.length) return null;

  return (
    <div
      className="row"
      style={{
        gap: 8,
        flexWrap: 'wrap',
        marginTop: 12,
      }}
    >
      {actions.map((action) => (
        <Button
          key={action.to}
          disabled={working}
          onClick={() => onRun(action)}
        >
          {working ? 'جارٍ التنفيذ…' : action.label}
        </Button>
      ))}
    </div>
  );
}