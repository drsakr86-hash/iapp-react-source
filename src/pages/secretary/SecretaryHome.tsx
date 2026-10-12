/* -------------------------------------------------------------------------
 * SecretaryHome — reception dashboard.
 * -------------------------------------------------------------------------
 * Three jobs, all on one screen:
 *   1. حجز  — NewAppointmentForm, unchanged, already permits the secretary
 *      role at the RPC level (iapp.book_appointment).
 *   2. تنظيم دخول الحالات — AppointmentCard with role="secretary". The
 *      action buttons it shows (وصول / انتظار / إلغاء / لم يحضر) are
 *      driven entirely by iapp.appointment_transitions.allowed_roles —
 *      see the Step-6 migration. "نداء للكشف" / "إنهاء" stay doctor-only
 *      and simply won't appear here.
 *   3. تحصيل فلوس الكشف — CollectFeeModal, calls
 *      iapp.record_consultation_payment only (see its own header for why
 *      that is a separate, narrower RPC from the doctor/admin ledger).
 * ---------------------------------------------------------------------- */
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, EmptyState, Spinner } from '../../components/ui';
import { AppointmentCard } from '../../components/doctor/AppointmentCard';
import { NewAppointmentForm } from '../../components/appointments/NewAppointmentForm';
import { CollectFeeModal } from '../../components/secretary/CollectFeeModal';
import { useAuth } from '../../hooks/useAuth';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import * as appointments from '../../services/appointments';
import type { BoardRow } from '../../services/appointments';
import { today } from '../../utils/medical';

export default function SecretaryHome() {
  useDocumentTitle('السكرتارية');
  const { profile } = useAuth();

  /* No clinic picker here: a secretary account is now clinic-scoped via
     iapp.staff + iapp.my_clinic_ids() (RLS on iapp.appointments already
     filters by it). Asking her to pick a clinic and then silently
     returning zero rows for any clinic that isn't hers would be
     confusing — the board view already shows only what she's allowed
     to see. */
  const [date, setDate] = useState(today());
  const [list, setList] = useState<BoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [collecting, setCollecting] = useState<BoardRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setList(await appointments.byDate(date));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر تحميل المواعيد');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div className="stack">
      <Card title={`أهلاً ${profile?.fullName ?? ''}`}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
          <label className="field">
            <span className="field__label">اليوم</span>
            <input type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <Button onClick={() => setBooking((v) => !v)}>
            {booking ? 'إغلاق' : 'حجز موعد جديد'}
          </Button>
        </div>
      </Card>

      {booking ? (
        <NewAppointmentForm
          onCreated={(row) => {
            setBooking(false);
            if (row.scheduled_date === date) void load();
          }}
          onCancel={() => setBooking(false)}
        />
      ) : null}

      <Card title={`مواعيد اليوم (${list.length})`}>
        {loading ? <Spinner label="جارٍ التحميل…" /> : null}
        {!loading && error ? <EmptyState icon="⚠️" text={error} /> : null}
        {!loading && !error && !list.length ? (
          <EmptyState icon="📋" text="لا توجد مواعيد في هذا اليوم." />
        ) : null}

        {!loading && !error
          ? list.map((a) => (
              <div key={a.id} className="stack" style={{ gap: 4, marginBlockEnd: 8 }}>
                <AppointmentCard appointment={a} role="secretary" onChanged={() => void load()} />
                {a.patient_id ? (
                  a.consultation_fee_paid_at ? (
                    <span className="chip chip--muted">✅ تم تحصيل رسم الكشف</span>
                  ) : (
                    <Button variant="outline" onClick={() => setCollecting(a)}>
                      💳 تحصيل رسم الكشف
                    </Button>
                  )
                ) : null}
              </div>
            ))
          : null}
      </Card>

      {collecting ? (
        <CollectFeeModal
          appointment={collecting}
          onClose={() => setCollecting(null)}
          onCollected={() => {
            setCollecting(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
