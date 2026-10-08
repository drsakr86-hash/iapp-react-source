/** Placeholder rows shown while a list loads (less jumpy than a lone spinner). */
export function SkeletonList({ rows = 3, label = 'جارٍ التحميل…' }: { rows?: number; label?: string }) {
  return (
    <div className="skeleton-list" role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton" key={i}>
          <span className="skeleton__bar skeleton__bar--short" />
          <span className="skeleton__bar" />
          <span className="skeleton__bar skeleton__bar--mid" />
        </div>
      ))}
    </div>
  );
}
