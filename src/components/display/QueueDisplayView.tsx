/* -------------------------------------------------------------------------
 * QueueDisplayView — the presentation of the public waiting-room screen.
 * -------------------------------------------------------------------------
 * Pure: it renders exactly what it is given and fetches nothing, so the same
 * component is used by the page and by the tests. It can only show the
 * whitelisted fields of DisplaySnapshot: there is no prop through which a
 * phone number, diagnosis or national id could arrive.
 * ---------------------------------------------------------------------- */

import type { ConnectionState, DisplayCurrent, DisplaySnapshot } from '../../utils/queueDisplay';
import { roomLabel, waitLabel } from '../../utils/queueDisplay';

/** How many waiting patients fit on a TV without scrolling. */
export const MAX_WAITING_SHOWN = 12;

const STATE_LABEL: Record<ConnectionState, string> = {
  connected: 'متصل',
  reconnecting: 'جارٍ إعادة الاتصال…',
  offline: 'غير متصل',
  invalid: 'الشاشة غير مسجّلة',
};

export interface QueueDisplayViewProps {
  snapshot: DisplaySnapshot | null;
  connection: ConnectionState;
  /** HH:MM:SS of the last successful update, for the offline banner. */
  lastUpdate: string | null;
  /** The call to highlight with the "new call" alert, if one is active. */
  alertCall: DisplayCurrent | null;
  soundEnabled: boolean;
  speechSupported: boolean;
  clock: string;
  idle: boolean;
  canFullscreen: boolean;
  onEnableSound: () => void;
  onTestSound: () => void;
  onReplay: () => void;
  onFullscreen: () => void;
}

export function QueueDisplayView(p: QueueDisplayViewProps) {
  const s = p.snapshot;

  if (p.connection === 'invalid') {
    return (
      <main className="display display--message" dir="rtl" lang="ar">
        <div className="display__message">
          <h1>هذه الشاشة غير مسجّلة</h1>
          <p>تم إلغاء تسجيل هذه الشاشة أو أن الرابط غير صحيح. افتح صفحة «شاشات الانتظار» في التطبيق وأنشئ رابطًا جديدًا.</p>
        </div>
      </main>
    );
  }

  if (!s) {
    return (
      <main className="display display--message" dir="rtl" lang="ar">
        <div className="display__message">
          <h1>{p.connection === 'offline' ? 'تعذّر الاتصال بالخادم' : 'جارٍ تحميل قائمة الانتظار…'}</h1>
          <p>{p.connection === 'offline' ? 'سنعيد المحاولة تلقائيًا.' : 'لحظات من فضلك.'}</p>
        </div>
      </main>
    );
  }

  const now = p.alertCall ?? s.current[0] ?? null;
  const others = s.current.filter((c) => c !== now && c.call_id !== now?.call_id);
  const shown = s.waiting.slice(0, MAX_WAITING_SHOWN);
  const hidden = Math.max(0, s.waiting_count - shown.length);
  const stale = p.connection === 'offline' || p.connection === 'reconnecting';

  return (
    <main
      className={`display${p.idle ? ' display--idle' : ''}`}
      dir="rtl"
      lang="ar"
      aria-label="شاشة انتظار المرضى"
    >
      <header className="display__bar">
        <h1 className="display__clinic">{s.clinic_name ?? 'العيادة'}</h1>
        <div className="display__meta">
          <span className={`display__pill display__pill--${p.connection}`} role="status">
            {STATE_LABEL[p.connection]}
          </span>
          <span className="display__clock" dir="ltr">
            {p.clock}
          </span>
        </div>
      </header>

      <div className="display__main" style={stale ? { opacity: 0.75 } : undefined}>
        <section
          className={`display__panel display__now${p.alertCall ? ' display__now--alert' : ''}`}
          aria-label="النداء الحالي"
        >
          {now ? (
            <>
              {p.alertCall ? <span className="display__banner">نداء جديد</span> : null}
              <div className="display__now-label">
                {now.kind === 'recall' ? 'نداء مكرر — المريض رقم' : 'يُنادى الآن — المريض رقم'}
              </div>
              <div className="display__now-number">{now.ticket_no}</div>
              {now.name ? <div className="display__now-name">{now.name}</div> : null}
              {roomLabel(now.room) || now.doctor ? (
                <div className="display__now-where">
                  {[roomLabel(now.room), now.doctor].filter(Boolean).join(' — ')}
                </div>
              ) : null}
              {others.length ? (
                <div className="display__inside" aria-label="داخل الكشف">
                  {others.map((c) => (
                    <span className="display__inside-chip" key={`${c.call_id}-${c.ticket_no}`}>
                      رقم {c.ticket_no}
                      {c.name ? ` — ${c.name}` : ''}
                      {roomLabel(c.room) ? ` — ${roomLabel(c.room)}` : ''}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="display__now-empty">لا يوجد نداء حاليًا</div>
          )}
        </section>

        <section className="display__panel" aria-label="قائمة الانتظار">
          <h2 className="display__title">
            في الانتظار <span className="display__count">({s.waiting_count})</span>
          </h2>
          {shown.length ? (
            <ol className="display__list">
              {shown.map((w) => (
                <li className="display__item" key={w.ticket_no}>
                  <span className="display__item-no">{w.ticket_no}</span>
                  <span className="display__item-name">{w.name ?? ''}</span>
                  {waitLabel(w.wait_minutes) ? (
                    <span className="display__item-wait">{waitLabel(w.wait_minutes)}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <div className="display__empty">لا يوجد مرضى في الانتظار</div>
          )}
          {hidden ? <div className="display__more">+ {hidden} آخرون</div> : null}
        </section>
      </div>

      <footer className="display__foot display__foot--hideable">
        {!p.soundEnabled ? (
          <button type="button" className="display__btn display__btn--primary" onClick={p.onEnableSound}>
            🔊 تفعيل الصوت
          </button>
        ) : (
          <>
            <button type="button" className="display__btn" onClick={p.onTestSound}>
              اختبار الصوت
            </button>
            <button type="button" className="display__btn" onClick={p.onReplay} disabled={!s.current.length}>
              إعادة النداء
            </button>
          </>
        )}
        {p.canFullscreen ? (
          <button type="button" className="display__btn" onClick={p.onFullscreen}>
            ملء الشاشة
          </button>
        ) : null}
        {!p.speechSupported ? <span>النطق الصوتي غير مدعوم في هذا المتصفح — النداء مرئي فقط.</span> : null}
        {!p.soundEnabled && p.speechSupported ? <span>الصوت متوقف حتى يتم تفعيله.</span> : null}
      </footer>

      {p.connection === 'offline' ? (
        <div className="display__notice" role="alert">
          انقطع الاتصال بالخادم — القائمة المعروضة قد تكون قديمة{p.lastUpdate ? ` (آخر تحديث ${p.lastUpdate})` : ''}
        </div>
      ) : null}

      {/* Screen-reader / assistive announcement of a new call. */}
      <div aria-live="assertive" className="sr-only" style={{ position: 'absolute', inlineSize: 1, blockSize: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {p.alertCall ? `نداء جديد: المريض رقم ${p.alertCall.ticket_no}` : ''}
      </div>
    </main>
  );
}
