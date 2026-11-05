/**
 * شيتات الفحص السريري — a reference page for the doctor: a tick-list per
 * condition plus a decision flow. Progress is kept on this device only
 * (localStorage). Nothing here touches Supabase, so the backend is unchanged.
 */
import { Fragment, useEffect, useState } from 'react';
import { Card, TabPanel, Tabs } from '../../components/ui';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { CHECKLISTS, type Checklist, type FlowNode } from '../../i18n/checklists';

type Checked = Record<number, boolean>;

function readChecked(key: string): Checked {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    return parsed && typeof parsed === 'object' ? (parsed as Checked) : {};
  } catch {
    return {};
  }
}

function writeChecked(key: string, value: Checked): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode): the list still works for this visit */
  }
}

/** Recursive decision flow: boxes stacked top-down, decisions split into نعم / لا. */
function Flow({ nodes }: { nodes: FlowNode[] }) {
  return (
    <div className="flow">
      {nodes.map((n, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <span className="flow__arr" aria-hidden="true">
              ↓
            </span>
          ) : null}
          {typeof n === 'string' ? (
            <div className="flow__box">{n}</div>
          ) : (
            <div className="flow__dec">
              <div className="flow__box flow__box--q">{n.q}</div>
              <div className="flow__branches">
                <Branch label="نعم" nodes={n.yes} />
                <Branch label="لا" nodes={n.no} />
              </div>
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

function Branch({ label, nodes }: { label: string; nodes: FlowNode[] }) {
  return (
    <div className="flow__branch">
      <span className="flow__chip">{label}</span>
      <Flow nodes={nodes} />
    </div>
  );
}

function ChecklistView({ c }: { c: Checklist }) {
  const storageKey = `iapp-checklist:${c.id}`;
  const [checked, setChecked] = useState<Checked>(() => readChecked(storageKey));
  const [armed, setArmed] = useState(false);

  const total = c.groups.reduce((n, g) => n + g.items.length, 0);
  const done = Object.values(checked).filter(Boolean).length;

  useEffect(() => {
    writeChecked(storageKey, checked);
  }, [storageKey, checked]);

  // Reset takes two taps; the first one arms it for a few seconds.
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  // Running index across groups, so every item has a stable key in storage.
  let index = 0;

  return (
    <Card title={c.name}>
      <p className="muted">{c.lede}</p>

      <div className="chk__progress">
        <span className="chk__count">
          تم {done} من {total}
        </span>
        <div
          className="chk__bar"
          role="progressbar"
          aria-label="نسبة الإنجاز"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <i style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
        <button
          type="button"
          className="chk__reset"
          onClick={() => {
            if (!armed) {
              setArmed(true);
              return;
            }
            setArmed(false);
            setChecked({});
          }}
        >
          {armed ? 'اضغط مرة أخرى للتأكيد' : 'مسح التقدم'}
        </button>
      </div>

      {c.groups.map((g) => (
        <Fragment key={g.title}>
          <h3 className="chk__group">{g.title}</h3>
          <ul className="chk__list">
            {g.items.map((text) => {
              const i = index++;
              const isDone = !!checked[i];
              return (
                <li key={i} className={isDone ? 'is-done' : undefined}>
                  <label>
                    <input
                      type="checkbox"
                      checked={isDone}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setChecked((prev) => ({ ...prev, [i]: next }));
                      }}
                    />
                    <span>{text}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </Fragment>
      ))}

      <h3 className="chk__group">المخطط التشخيصي</h3>
      <Flow nodes={c.flow} />
    </Card>
  );
}

export default function DoctorChecklists() {
  useDocumentTitle('شيتات الفحص');
  const [active, setActive] = useState<string>(CHECKLISTS[0].id);

  return (
    <div className="stack">
      <Tabs
        label="الأمراض"
        idPrefix="chk"
        tabs={CHECKLISTS.map((c) => ({ key: c.id, label: c.name }))}
        value={active}
        onChange={setActive}
      />
      {CHECKLISTS.map((c) => (
        <TabPanel key={c.id} id={c.id} idPrefix="chk" active={c.id === active}>
          <ChecklistView c={c} />
        </TabPanel>
      ))}
      <p className="muted chk__disclaimer">
        هذه الشيتات أدوات مساعدة للمراجعة، ولا تغني عن الحكم السريري والبروتوكولات المعتمدة في
        القسم.
      </p>
    </div>
  );
}
