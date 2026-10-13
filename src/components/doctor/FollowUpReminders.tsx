/**
 * Follow-ups that are due (or overdue) with a one-tap WhatsApp reminder.
 * Doctor-only: follow_ups is readable by doctors only (RLS), so this card
 * lives on the doctor's home, not reception.
 *
 * The WhatsApp message carries no clinical information. The send is still
 * pressed by a person; opening the chat marks the follow-up as notified.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, EmptyState, ErrorState, SkeletonList, Tag } from '../ui';
import { followUps } from '../../services/examinations';
import { useConfirm } from '../../hooks/useConfirm';
import { useToast } from '../../hooks/useToast';
import { today } from '../../utils/medical';
import { fmtDay } from '../../utils/models';
import { followUpMessage, whatsappUrl } from '../../utils/whatsapp';
import {
  FOLLOWUP_GROUPS,
  addDays,
  countByGroup,
  dueLabel,
  groupOf,
  sortFollowUps,
  type DueFollowUp,
  type FollowUpGroup,
} from '../../utils/followUps';

const LOOKAHEAD_DAYS = 7;
const COLLAPSED = 6;

const GROUP_COLOR: Record<FollowUpGroup, string> = {
  overdue: 'var(--danger)',
  today: 'var(--gold)',
  upcoming: 'var(--accent)',
};

export function FollowUpReminders({ doctorName }: { doctorName?: string | null }) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [rows, setRows] = useState<DueFollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const day = today();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(sortFollowUps(await followUps.listDue(addDays(today(), LOOKAHEAD_DAYS))));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر تحميل المتابعات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void load();
  }, [load]);

  const counts = useMemo(() => countByGroup(rows, day), [rows, day]);
  const shown = showAll ? rows : rows.slice(0, COLLAPSED);

  async function notified(r: DueFollowUp) {
    // Called when WhatsApp is opened. Failure to record must not block the chat.
    try {
      await followUps.markNotified(r.id);
      setRows((cur) =>
        cur.map((x) => (x.id === r.id ? { ...x, status: 'notified', notified_at: new Date().toISOString() } : x)),
      );
    } catch {
      toast.error('تعذّر تسجيل التذكير — تأكد من الاتصال');
    }
  }

  async function dismiss(r: DueFollowUp) {
    const ok = await confirm({
      title: 'إلغاء المتابعة؟',
      message: `لن تظهر متابعة ${r.name} في القائمة بعد الآن.`,
      confirmLabel: 'إلغاء المتابعة',
      danger: true,
    });
    if (!ok) return;
    setBusyId(r.id);
    try {
      await followUps.cancel(r.id);
      setRows((cur) => cur.filter((x) => x.id !== r.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذّر إلغاء المتابعة');
    } finally {
      setBusyId(null);
    }
  }

  const title = rows.length ? `🔔 متابعات مستحقة (${rows.length})` : '🔔 متابعات مستحقة';

  return (
    <Card title={title}>
      {loading ? <SkeletonList rows={2} label="جارٍ تحميل المتابعات…" /> : null}
      {!loading && error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && !rows.length ? (
        <EmptyState icon="✅" text={`لا توجد متابعات متأخرة أو مستحقة خلال ${LOOKAHEAD_DAYS} أيام.`} />
      ) : null}

      {!loading && !error && rows.length ? (
        <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBlockEnd: 12 }}>
            {FOLLOWUP_GROUPS.filter((g) => counts[g.key] > 0).map((g) => (
              <Tag key={g.key} label={`${g.label} ${counts[g.key]}`} color={GROUP_COLOR[g.key]} />
            ))}
          </div>

          {shown.map((r) => {
            const g = groupOf(r.due_date, day);
            const url = whatsappUrl(
              r.phone,
              followUpMessage({ name: r.name, doctor: doctorName, dayLabel: fmtDay(r.due_date) }),
            );
            return (
              <div className="rx-med" key={r.id}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div>
                    <Link to={`/doctor/patients/${r.patient_id}`}>
                      <strong>{r.name}</strong>
                    </Link>
                    <p className="muted" style={{ margin: '4px 0 0' }}>
                      {r.reason || 'متابعة'} · {fmtDay(r.due_date)}
                    </p>
                  </div>
                  <Tag label={dueLabel(r.due_date, day)} color={GROUP_COLOR[g]} />
                </div>

                <div className="appt__actions" style={{ marginBlockStart: 8 }}>
                  {url ? (
                    <a
                      className="chip"
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => void notified(r)}
                    >
                      💬 تذكير واتساب
                    </a>
                  ) : (
                    <span className="chip chip--muted">رقم الهاتف غير صالح للواتساب</span>
                  )}
                  {r.notified_at ? <span className="chip chip--muted">✓ تم التذكير</span> : null}
                  <button
                    type="button"
                    className="chip"
                    disabled={busyId === r.id}
                    onClick={() => void dismiss(r)}
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            );
          })}

          {rows.length > COLLAPSED ? (
            <button type="button" className="chip" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'عرض أقل' : `عرض الكل (${rows.length})`}
            </button>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
