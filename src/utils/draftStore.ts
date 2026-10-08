/**
 * Draft storage for in-progress clinical forms. Pure functions over a
 * Storage-like object so they can be unit-tested without a browser.
 *
 * Why this exists: an examination takes minutes to fill. A dropped
 * connection, a phone call that backgrounds the Median WebView, or an
 * accidental tap outside the dialog used to lose all of it.
 *
 * Privacy on shared clinic PCs:
 *  - drafts hold form text and the patient's id (a UUID) — never the name;
 *  - they expire after DRAFT_TTL_MS (12 h) and are dropped on read;
 *  - they are keyed by the signed-in user and ALL are wiped on sign-out.
 */

export const DRAFT_PREFIX = 'iapp:draft:';
export const DRAFT_TTL_MS = 12 * 60 * 60 * 1000;

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  key(i: number): string | null;
  readonly length: number;
}

export interface Draft<T> {
  v: T;
  /** epoch ms of the last write */
  t: number;
}

export function draftKey(userId: string | null | undefined, ...parts: string[]): string {
  return DRAFT_PREFIX + [userId || 'anon', ...parts].join(':');
}

export function readDraft<T>(
  storage: StorageLike | null,
  key: string,
  now: number,
  ttlMs: number = DRAFT_TTL_MS,
): Draft<T> | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft<T>;
    if (!d || typeof d.t !== 'number' || !('v' in d)) {
      storage.removeItem(key);
      return null;
    }
    if (now - d.t > ttlMs || d.t > now + 60_000) {
      storage.removeItem(key);
      return null;
    }
    return d;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
    return null;
  }
}

export function writeDraft<T>(storage: StorageLike | null, key: string, value: T, now: number): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify({ v: value, t: now } satisfies Draft<T>));
    return true;
  } catch {
    return false; // quota / private mode — drafts are best-effort
  }
}

export function clearDraft(storage: StorageLike | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Removes every draft (called on sign-out). Returns how many were removed. */
export function clearAllDrafts(storage: StorageLike | null): number {
  if (!storage) return 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(DRAFT_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => storage.removeItem(k));
    return keys.length;
  } catch {
    return 0;
  }
}

/** Browser localStorage, or null when blocked (private mode, disabled storage). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** "منذ 3 دقائق" — Arabic relative age for the restore banner. */
export function agoAr(thenMs: number, nowMs: number): string {
  const min = Math.max(0, Math.round((nowMs - thenMs) / 60_000));
  if (min < 1) return 'منذ لحظات';
  if (min === 1) return 'منذ دقيقة';
  if (min === 2) return 'منذ دقيقتين';
  if (min <= 10) return `منذ ${min} دقائق`;
  if (min < 60) return `منذ ${min} دقيقة`;
  const h = Math.floor(min / 60);
  if (h === 1) return 'منذ ساعة';
  if (h === 2) return 'منذ ساعتين';
  if (h <= 10) return `منذ ${h} ساعات`;
  return `منذ ${h} ساعة`;
}
