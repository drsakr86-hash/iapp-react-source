import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AuthContext } from '../contexts/auth-context';
import {
  browserStorage,
  clearDraft,
  draftKey,
  readDraft,
  writeDraft,
} from '../utils/draftStore';

const SAVE_DELAY_MS = 500;

export interface DraftApi<T> {
  value: T;
  /** Same contract as a useState setter; marks the form as edited. */
  set: (u: T | ((prev: T) => T)) => void;
  /** epoch ms of the restored draft, or null when this is a fresh form. */
  restoredAt: number | null;
  /** Call after a successful save — removes the draft and stops further writes. */
  clear: () => void;
  /** "Start over": removes the draft and resets to the initial value. */
  discard: () => void;
}

/**
 * useState + automatic local draft. `scope` identifies the form
 * (e.g. ['exam', patientId, visitId]); pass null to disable (nothing stored).
 * Writes are debounced and also flushed when the page is hidden, which is
 * what happens when a phone call or app switch backgrounds the WebView.
 */
export function useDraftState<T>(scope: string[] | null, initial: () => T): DraftApi<T> {
  const userId = useContext(AuthContext)?.profile?.userId ?? null;
  const key = scope ? draftKey(userId, ...scope) : null;

  const [seed] = useState(() => {
    const d = key ? readDraft<T>(browserStorage(), key, Date.now()) : null;
    return d ? { v: d.v, t: d.t } : { v: initial(), t: null as number | null };
  });
  const [value, setValue] = useState<T>(seed.v);
  const [restoredAt, setRestoredAt] = useState<number | null>(seed.t);

  const touched = useRef(false);
  const stopped = useRef(false);
  const latest = useRef(value);

  useEffect(() => {
    latest.current = value;
    if (!key || !touched.current || stopped.current) return;
    const id = setTimeout(() => {
      /* clear() may have run while this write was pending (save pressed within
         the debounce window) — a stale timer must not resurrect the draft. */
      if (!stopped.current) writeDraft(browserStorage(), key, value, Date.now());
    }, SAVE_DELAY_MS);
    return () => clearTimeout(id);
  }, [key, value]);

  useEffect(() => {
    if (!key) return;
    const flush = () => {
      if (touched.current && !stopped.current) writeDraft(browserStorage(), key, latest.current, Date.now());
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', flush);
    };
  }, [key]);

  const set = useCallback((u: T | ((prev: T) => T)) => {
    touched.current = true;
    setValue(u);
  }, []);

  const clear = useCallback(() => {
    stopped.current = true;
    if (key) clearDraft(browserStorage(), key);
  }, [key]);

  const discard = useCallback(() => {
    if (key) clearDraft(browserStorage(), key);
    touched.current = false;
    setRestoredAt(null);
    setValue(initial());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { value, set, restoredAt, clear, discard };
}
