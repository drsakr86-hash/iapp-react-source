/**
 * One number with a label. Becomes a button (filter toggle) when `onClick`
 * is given, otherwise a plain tile. Replaces the hand-rolled
 * <Card><strong style={{fontSize:28}}> tiles.
 */
export function StatTile({
  label,
  value,
  onClick,
  active,
  tone,
}: {
  label: string;
  value: number | string;
  onClick?: () => void;
  active?: boolean;
  /** CSS colour for the value, e.g. 'var(--gold)'. */
  tone?: string;
}) {
  const inner = (
    <>
      <span className="stat__value" style={tone ? { color: tone } : undefined}>
        {value}
      </span>
      <span className="stat__label">{label}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="stat stat--btn" aria-pressed={active} onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="stat">{inner}</div>
  );
}
