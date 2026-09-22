/* -------------------------------------------------------------------------
 * CollectFeeModal — secretary collects the consultation fee for one
 * appointment. Calls iapp.record_consultation_payment only; no other
 * financial RPC is reachable from here (see secretary/payments.ts header).
 * ---------------------------------------------------------------------- */

import { useEffect, useMemo, useState } from 'react';
import { Button, Modal } from '../ui';
import { useToast } from '../../hooks/useToast';
import type { BoardRow } from '../../services/appointments';
import * as catalogSvc from '../../services/catalog';
import * as accountsSvc from '../../services/accounting/accounts';
import * as paymentMethodsSvc from '../../services/accounting/paymentMethods';
import * as secretaryPaymentsSvc from '../../services/secretary/payments';
import type { PaymentMethodRow } from '../../types/accounting.types';

export function CollectFeeModal({
  appointment,
  onClose,
  onCollected,
}: {
  appointment: BoardRow;
  onClose: () => void;
  onCollected: () => void;
}) {
  const toast = useToast();

  const [services, setServices] = useState<catalogSvc.ServiceRow[]>([]);
  const [accounts, setAccounts] = useState<accountsSvc.AccountRow[]>([]);
  const [methods, setMethods] = useState<PaymentMethodRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [serviceId, setServiceId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [methodId, setMethodId] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([catalogSvc.list(), accountsSvc.list(), paymentMethodsSvc.list()])
      .then(([svc, acc, pm]) => {
        if (!active) return;
        setServices(svc);
        setAccounts(acc);
        setMethods(pm);

        /* Default to the clinic's consultation service, if one is
           findable by category/name — the secretary can still change it. */
        const consult =
          svc.find((s) => s.category === 'consultation') ??
          svc.find((s) => s.name_ar.includes('كشف'));
        if (consult) {
          setServiceId(consult.id);
          setAmount(String(consult.default_price ?? ''));
        }
        if (acc.length === 1) setAccountId(acc[0].id);
        if (pm.length) setMethodId(pm.find((m) => m.code === 'cash')?.id ?? pm[0].id);
      })
      .catch((e) => active && setLoadError(e instanceof Error ? e.message : 'تعذّر التحميل'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId) ?? null,
    [services, serviceId],
  );

  async function submit() {
    if (saving) return;
    const value = Number(amount);
    if (!(value > 0)) {
      toast.error('أدخل مبلغاً صحيحاً');
      return;
    }
    if (!accountId) {
      toast.error('اختر الخزينة/الحساب');
      return;
    }
    setSaving(true);
    try {
      const result = await secretaryPaymentsSvc.recordConsultationPayment({
        p_patient_id: appointment.patient_id ?? '',
        p_visit_id: appointment.visit_id,
        p_clinic_id: appointment.clinic_id,
        p_service_id: serviceId || null,
        p_account_id: accountId,
        p_amount: value,
        p_payment_method_id: methodId || null,
        p_notes: notes || null,
        p_appointment_id: appointment.id,
      });
      toast.success(`تم التحصيل — إيصال رقم ${result.receipt_no}`);
      onCollected();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذّر تحصيل المبلغ');
    } finally {
      setSaving(false);
    }
  }

  if (!appointment.patient_id) {
    return (
      <Modal title="تحصيل رسم الكشف" onClose={onClose}>
        <p className="alert">هذا الموعد بلا سجل مريض — لا يمكن تسجيل تحصيل بدون مريض.</p>
      </Modal>
    );
  }

  if (appointment.consultation_fee_paid_at) {
    return (
      <Modal title="تحصيل رسم الكشف" onClose={onClose}>
        <p className="muted">تم تحصيل رسم الكشف لهذا الموعد بالفعل.</p>
      </Modal>
    );
  }

  return (
    <Modal title={`تحصيل رسم الكشف — ${appointment.display_name ?? ''}`} onClose={onClose}>
      {loading ? <p className="muted">جارٍ التحميل…</p> : null}
      {loadError ? <p className="alert">{loadError}</p> : null}

      {!loading && !loadError ? (
        <div className="stack" style={{ gap: 8 }}>
          <label className="field">
            <span className="field__label">الخدمة</span>
            <select
              value={serviceId}
              onChange={(e) => {
                const s = services.find((x) => x.id === e.target.value);
                setServiceId(e.target.value);
                if (s) setAmount(String(s.default_price ?? amount));
              }}
            >
              <option value="">— بدون —</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name_ar} {s.default_price ? `(${s.default_price})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">المبلغ *</span>
            <input
              type="number"
              dir="ltr"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>

          <label className="field">
            <span className="field__label">الخزينة/الحساب *</span>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">— اختر —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name_ar}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">طريقة الدفع</span>
            <select value={methodId} onChange={(e) => setMethodId(e.target.value)}>
              <option value="">— اختر —</option>
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name_ar}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">ملاحظات</span>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          {selectedService && Number(amount) !== selectedService.default_price ? (
            <p className="muted" style={{ fontSize: 11 }}>
              المبلغ مختلف عن السعر الافتراضي للخدمة ({selectedService.default_price}).
            </p>
          ) : null}

          <Button disabled={saving} onClick={() => void submit()}>
            {saving ? 'جارٍ الحفظ…' : 'تسجيل التحصيل'}
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}
