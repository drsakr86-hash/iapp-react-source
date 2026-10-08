import { useState } from 'react';
import { agoAr } from '../../utils/draftStore';

/** Shown on a form that was pre-filled from an unsaved local draft. */
export function DraftBanner({ restoredAt, onDiscard }: { restoredAt: number | null; onDiscard: () => void }) {
  /* "now" is captured once when the banner mounts: the label is a snapshot
     of how old the draft was when it was restored, not a live clock. */
  const [now] = useState(() => Date.now());
  if (restoredAt == null) return null;
  return (
    <div className="draftbanner" role="status">
      <span>تم استرجاع مسودة غير محفوظة ({agoAr(restoredAt, now)}).</span>
      <button type="button" className="chip" onClick={onDiscard}>
        تجاهل المسودة
      </button>
    </div>
  );
}
