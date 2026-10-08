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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, EmptyState, ErrorState, SkeletonList } from '../../components/ui';
import { AppointmentCard } from '../../components/doctor/AppointmentCard';
import { NewAppointmentForm } from '../../components/appointments/NewAppointmentForm';
import { CollectFeeModal } from '../../components/secretary/CollectFeeModal';
import { useAuth } from '../../hooks/useAuth';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import * as appointments from '../../services/appointments';
import type { BoardRow } from '../../services/appointments';
import { today } from '../../utils/medical';
import {
  QUEUE_FILTERS,
  countByFilter,
  matchesFilter,
  matchesSearch,
  orderForReception,
  type QueueFilter,
} from '../../utils/appointmentFilters';

/** The queue changes while reception works; refresh quietly while today is open. */
const REFRESH_MS = 30_000;

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
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [query, setQuery] = useState('');

  /* `quiet` refreshes keep the list on screen (no spinner flash) and never
     replace it with an error — a failed background refresh just leaves the
     last good data and the next tick tries again. */
  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) {
        setLoading(true);
        setError(null);
      }
      try {
        setList(await appointments.byDate(date));
        if (quiet) setError(null);
      } catch (e) {
        if (!quiet) setError(e instanceof Error ? e.message : 'تعذّر تحميل المواعيد');
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [date],
  );

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (date !== today()) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && !booking && !collecting) void load(true);
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [date, load, booking, collecting]);

  const counts = useMemo(() => countByFilter(list), [list]);
  const visible = useMemo(
    () => orderForReception(list.filter((a) => matchesFilter(a, filter) && matchesSearch(a, query))),
    [list, filter, query],
  );
  const filtering = filter !== 'all' || query.trim() !== '';

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

      <Card title={filtering ? `المواعيد (${visible.length} من ${list.length})` : `مواعيد اليوم (${list.length})`}>
        <div className="stack" style={{ gap: 8, marginBlockEnd: 12 }}>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍 ابحث بالاسم أو رقم التليفون أو كود المريض"
            aria-label="بحث في مواعيد اليوم"
          />
          <div className="filters" role="group" aria-label="تصفية حسب الحالة">
            {QUEUE_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className="chip"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span className="filters__count">{counts[f.key]}</span>
              </button>
            ))}
          </div>
        </div>

        {loading ? <SkeletonList rows={3} /> : null}
        {!loading && error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {!loading && !error && !list.length ? (
          <EmptyState icon="📋" text="لا توجد مواعيد في هذا اليوم." />
        ) : null}
        {!loading && !error && list.length > 0 && !visible.length ? (
          <EmptyState icon="🔍" text="لا توجد نتائج مطابقة." />
        ) : null}

        {!loading && !error
          ? visible.map((a) => (
              <div key={a.id} className="stack" style={{ gap: 4, marginBlockEnd: 8 }}>
                <AppointmentCard appointment={a} role="secretary" onChanged={() => void load(true)} />
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
