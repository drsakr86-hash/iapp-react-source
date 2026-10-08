import type { ReactNode } from 'react';

export interface TabDef<K extends string> {
  key: K;
  label: string;
  /** Small count badge, e.g. number of records in the tab. Hidden when 0/undefined. */
  badge?: number;
}

/**
 * Horizontal tab strip. Pair each tab with a <TabPanel>: panels that are not
 * active stay MOUNTED (just hidden), so a half-filled form keeps its state
 * when the user switches tabs and comes back.
 */
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix = 'tab',
}: {
  tabs: TabDef<K>[];
  value: K;
  onChange: (k: K) => void;
  label: string;
  idPrefix?: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          id={`${idPrefix}-${t.key}`}
          aria-selected={value === t.key}
          aria-controls={`${idPrefix}-panel-${t.key}`}
          tabIndex={value === t.key ? 0 : -1}
          className="tabs__tab"
          onClick={() => onChange(t.key)}
          onKeyDown={(e) => {
            // RTL: ArrowRight moves to the previous tab visually-right = earlier in the list.
            const i = tabs.findIndex((x) => x.key === value);
            const next = e.key === 'ArrowLeft' ? i + 1 : e.key === 'ArrowRight' ? i - 1 : null;
            if (next === null) return;
            e.preventDefault();
            const target = tabs[(next + tabs.length) % tabs.length];
            onChange(target.key);
            document.getElementById(`${idPrefix}-${target.key}`)?.focus();
          }}
        >
          {t.label}
          {t.badge ? <span className="tabs__badge">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({
  active,
  id,
  idPrefix = 'tab',
  children,
}: {
  active: boolean;
  id: string;
  idPrefix?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="stack"
      role="tabpanel"
      id={`${idPrefix}-panel-${id}`}
      aria-labelledby={`${idPrefix}-${id}`}
      hidden={!active}
    >
      {children}
    </div>
  );
}
