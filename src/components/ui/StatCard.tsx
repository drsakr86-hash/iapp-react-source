/**
 * Dashboard figure in the I App Lite style: emoji, big coloured number, label,
 * and a tinted corner circle. Becomes a toggle button when `onClick` is given
 * (used as a filter), otherwise a plain tile.
 */
export function StatCard({
  icon,
  value,
  suffix,
  label,
  color,
  onClick,
  active,
}: {
  icon?: string;
  value: number | string;
  suffix?: string;
  label: string;
  /** CSS colour, e.g. 'var(--gold)'. Defaults to the theme accent. */
  color?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const style = color ? ({ '--stat-color': color } as React.CSSProperties) : undefined;
  const inner = (
    <>
      {icon ? (
        <span className="stat-card__icon" aria-hidden="true" style={{ display: 'block' }}>
          {icon}
        </span>
      ) : null}
      <span className="stat-card__value" style={{ display: 'block' }}>
        {value}
        {suffix ? <span className="stat-card__suffix">{suffix}</span> : null}
      </span>
      <span className="stat-card__label">{label}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="stat-card stat-card--btn" style={style} aria-pressed={active} onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="stat-card" style={style}>
      {inner}
    </div>
  );
}
