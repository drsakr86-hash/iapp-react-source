/* -------------------------------------------------------------------------
 * «شاشات الانتظار» — register and manage the waiting-room screens.
 * -------------------------------------------------------------------------
 * Plain on purpose: add a screen, copy its link once, open the link on the
 * TV. Names on the screen are OFF by default (queue numbers only); turning
 * them on shows each patient's first name only — never phone, diagnosis or
 * any medical data.
 * ---------------------------------------------------------------------- */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorState, SkeletonList } from '../../components/ui';
import { useConfirm } from '../../hooks/useConfirm';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useToast } from '../../hooks/useToast';
import * as clinics from '../../services/clinics';
import type { ClinicRow } from '../../services/clinics';
import * as devices from '../../services/displayDevices';
import type { DisplayDevice } from '../../services/displayDevices';

const ACTIVE_WITHIN_MS = 2 * 60 * 1000;

function lastSeen(d: DisplayDevice): string {
  if (!d.is_active) return 'ملغاة';
  if (!d.last_seen_at) return 'لم تتصل بعد';
  const ms = Date.now() - Date.parse(d.last_seen_at);
  if (ms <= ACTIVE_WITHIN_MS) return 'تعمل الآن';
  const mins = Math.round(ms / 60000);
  return mins < 60 ? `آخر اتصال منذ ${mins} د` : `آخر اتصال ${new Date(d.last_seen_at).toLocaleString('ar-EG')}`;
}

export default function DoctorDisplays() {
  useDocumentTitle('شاشات الانتظار');
  const toast = useToast();
  const { confirm } = useConfirm();

  const [list, setList] = useState<DisplayDevice[]>([]);
  const [clinicList, setClinicList] = useState<ClinicRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [clinicId, setClinicId] = useState('');
  const [label, setLabel] = useState('');
  const [showNames, setShowNames] = useState(false);
  const [saving, setSaving] = useState(false);
  /* Shown once, right after creation. Never stored on this device. */
  const [created, setCreated] = useState<{ label: string; url: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, c] = await Promise.all([devices.list(), clinics.list()]);
      setList(d);
      setClinicList(c);
      setClinicId((cur) => cur || c[0]?.id || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر تحميل الشاشات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void load();
  }, [load]);

  const clinicName = (id: string) => clinicList.find((c) => c.id === id)?.name_ar ?? '—';

  async function add() {
    if (saving) return;
    if (!clinicId) return toast.error('اختر العيادة');
    if (label.trim().length < 2) return toast.error('اكتب اسمًا للشاشة (مثل: تلفزيون الاستقبال)');
    setSaving(true);
    try {
      const r = await devices.create({ clinicId, label, showNames });
      setCreated({ label: label.trim(), url: devices.displayUrl(r.token) });
      setAdding(false);
      setLabel('');
      setShowNames(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذّر إنشاء الشاشة');
    } finally {
      setSaving(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('تم نسخ الرابط');
    } catch {
      toast.error('تعذّر النسخ — حدّد الرابط وانسخه يدويًا');
    }
  }

  async function toggleNames(d: DisplayDevice) {
    try {
      await devices.setShowNames(d.id, !d.show_names);
      toast.success(!d.show_names ? 'ستظهر الأسماء الأولى على هذه الشاشة' : 'ستظهر أرقام الانتظار فقط');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذّر التعديل');
    }
  }

  async function revoke(d: DisplayDevice) {
    if (
      !(await confirm({
        title: 'إلغاء الشاشة',
        message: `إلغاء «${d.label}»؟ ستتوقف عن العمل فورًا ولا يمكن إعادة استخدام رابطها.`,
        confirmLabel: 'إلغاء الشاشة',
        danger: true,
      }))
    ) {
      return;
    }
    try {
      await devices.revoke(d.id);
      toast.success('تم إلغاء الشاشة');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذّر الإلغاء');
    }
  }

  return (
    <div className="stack">
      <Card title="شاشات الانتظار">
        <p className="muted">
          أنشئ رابطًا لكل تلفزيون أو جهاز عرض، وافتحه عليه. الشاشة تعرض أرقام الانتظار والنداء الحالي فقط،
          ولا تستطيع تعديل أي بيانات.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Button onClick={() => setAdding((v) => !v)}>{adding ? 'إغلاق' : 'إضافة شاشة'}</Button>
          <Link className="chip" to="/doctor/more">
            رجوع
          </Link>
        </div>
      </Card>

      {created ? (
        <Card title={`رابط «${created.label}» — يظهر مرة واحدة فقط`}>
          <div className="stack">
            <input
              readOnly
              dir="ltr"
              value={created.url}
              aria-label="رابط الشاشة"
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Button onClick={() => void copy(created.url)}>نسخ الرابط</Button>
              <Button variant="outline" onClick={() => setCreated(null)}>
                تم — أخفِ الرابط
              </Button>
            </div>
            <p className="muted">
              افتح هذا الرابط على التلفزيون ثم اضغط «تفعيل الصوت». لا يمكن عرض الرابط مرة أخرى؛ إن ضاع، ألغِ الشاشة
              وأنشئ غيرها.
            </p>
          </div>
        </Card>
      ) : null}

      {adding ? (
        <Card title="شاشة جديدة">
          <div className="stack">
            <label className="field">
              <span className="field__label">العيادة</span>
              <select value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
                {clinicList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name_ar}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">اسم الشاشة</span>
              <input
                value={label}
                maxLength={80}
                placeholder="مثال: تلفزيون الاستقبال"
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
              <span>إظهار الاسم الأول للمريض (وإلا تظهر أرقام الانتظار فقط)</span>
            </label>
            <Button disabled={saving} onClick={() => void add()}>
              {saving ? 'جارٍ الإنشاء…' : 'إنشاء الشاشة'}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card title={`الشاشات (${list.filter((d) => d.is_active).length})`}>
        {loading ? <SkeletonList rows={2} /> : null}
        {!loading && error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {!loading && !error && !list.length ? <EmptyState icon="📺" text="لا توجد شاشات بعد." /> : null}
        {!loading && !error
          ? list.map((d) => (
              <div key={d.id} className="stack" style={{ gap: 6, marginBlockEnd: 12, opacity: d.is_active ? 1 : 0.6 }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <strong>{d.label}</strong>
                  <span className="muted">{lastSeen(d)}</span>
                </div>
                <span className="muted">
                  {clinicName(d.clinic_id)} · {d.show_names ? 'تعرض الاسم الأول' : 'أرقام فقط'}
                </span>
                {d.is_active ? (
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <Button variant="outline" onClick={() => void toggleNames(d)}>
                      {d.show_names ? 'إخفاء الأسماء' : 'إظهار الأسماء الأولى'}
                    </Button>
                    <Button variant="danger" onClick={() => void revoke(d)}>
                      إلغاء الشاشة
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          : null}
      </Card>
    </div>
  );
}
