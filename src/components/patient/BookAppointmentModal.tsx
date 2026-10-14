import { useEffect, useRef, useState } from 'react';
import { Button, Field, Input, Modal, Spinner } from '../ui';
import { useToast } from '../../hooks/useToast';
import * as portal from '../../services/patientPortal';
import { availableSlots, type Slot } from '../../services/appointments';
import * as clinicsSvc from '../../services/clinics';
import type { ClinicRow } from '../../services/clinics';
import * as M from '../../utils/models';

export function BookAppointmentModal({
  onClose,
  onBooked,
}: {
  onClose: () => void;
  onBooked: () => void;
}) {
  const toast = useToast();

  const [clinics, setClinics] = useState<ClinicRow[]>([]);
  const [clinicsLoading, setClinicsLoading] = useState(true);
  const [clinicId, setClinicId] = useState('');
  const [date, setDate] = useState(M.today());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [slotsTry, setSlotsTry] = useState(0);
  const submitting = useRef(false);
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clinics load once — this list rarely changes mid-booking.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await clinicsSvc.list();
        if (!alive) return;
        setClinics(rows);
        if (rows.length === 1) setClinicId(rows[0].id);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'تعذّر تحميل العيادات');
      } finally {
        if (alive) setClinicsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Slots re-fetch whenever clinic or date changes (or on "retry"). Anything
  // from the previous clinic/day is cleared FIRST, so a failed fetch can never
  // leave an old grid on screen that looks selectable for the new choice.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    setSlots([]);
    setTime('');
    setSlotsError(null);
    if (!clinicId || !date) return;
    let alive = true;
    (async () => {
      setSlotsLoading(true);
      try {
        const rows = await availableSlots(clinicId, date);
        if (alive) setSlots(rows);
      } catch (e) {
        if (alive) setSlotsError(e instanceof Error ? e.message : 'تعذّر تحميل الأوقات المتاحة');
      } finally {
        if (alive) setSlotsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [clinicId, date, slotsTry]);

  async function submit() {
    if (busy || submitting.current) return;
    submitting.current = true;
    setError(null);
    setBusy(true);
    try {
      await portal.bookMyAppointment({ clinicId, date, time, notes });
      toast.success('تم إرسال طلب الموعد — بانتظار تأكيد العيادة');
      onBooked();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر حجز الموعد');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal title="حجز موعد جديد" onClose={onClose}>
      <div className="stack">
        <p className="muted">
          الحجز من هنا طلب مبدئي — العيادة هتراجعه وتأكده بعدين، مش موعد مؤكَّد على طول.
        </p>

        <Field label="العيادة">
          {clinicsLoading ? (
            <Spinner label="جارٍ التحميل…" />
          ) : (
            <select className="input" value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
              <option value="">— اختر العيادة —</option>
              {clinics.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name_ar}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label="التاريخ">
          <Input type="date" min={M.today()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        {clinicId && date ? (
          <Field label="الوقت">
            {slotsLoading ? <Spinner label="جارٍ تحميل الأوقات المتاحة…" /> : null}
            {!slotsLoading && slotsError ? (
              <div className="stack" style={{ gap: 8 }}>
                <p className="alert">{slotsError}</p>
                <Button variant="outline" onClick={() => setSlotsTry((n) => n + 1)}>
                  إعادة المحاولة
                </Button>
              </div>
            ) : null}
            {!slotsLoading && !slotsError && slots.length === 0 ? (
              <p className="muted">لا توجد أوقات متاحة في هذا اليوم.</p>
            ) : null}
            {!slotsLoading && slots.length > 0 ? (
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                {slots.map((s) => (
                  <button
                    key={s.slot_time}
                    type="button"
                    className={'chip' + (time === s.slot_time ? ' chip--primary' : '')}
                    disabled={!s.is_free}
                    onClick={() => setTime(s.slot_time)}
                    style={!s.is_free ? { opacity: 0.4, textDecoration: 'line-through' } : undefined}
                  >
                    {s.slot_time.slice(0, 5)}
                  </button>
                ))}
              </div>
            ) : null}
          </Field>
        ) : null}

        <Field label="ملاحظات (اختياري)">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {error ? <p className="alert">{error}</p> : null}

        <Button onClick={submit} full disabled={busy || !clinicId || !date || !time}>
          {busy ? 'جارٍ الإرسال…' : 'إرسال طلب الحجز'}
        </Button>
      </div>
    </Modal>
  );
}
