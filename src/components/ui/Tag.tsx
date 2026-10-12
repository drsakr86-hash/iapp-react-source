import type { ReactNode } from 'react';

export function Tag({ label, color = 'var(--muted)' }: { label: ReactNode; color?: string }) {
  return (
    <span className="tag" style={{ color }}>
      {label}
    </span>
  );
}
