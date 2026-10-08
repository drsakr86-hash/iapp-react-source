/**
 * Reception list helpers — pure, so they can be tested without a database.
 * Used by the secretary screen: status filter chips, quick search, and the
 * order the day's list is shown in.
 */
import type { BoardRow } from '../services/appointments';
import { toLatinDigits } from './whatsapp';

export type QueueFilter = 'all' | 'waiting' | 'expected' | 'inclinic' | 'done';

export const QUEUE_FILTERS: { key: QueueFilter; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'waiting', label: 'في الانتظار' },
  { key: 'expected', label: 'لم يصلوا' },
  { key: 'inclinic', label: 'داخل العيادة' },
  { key: 'done', label: 'منتهية' },
];

const GROUPS: Record<Exclude<QueueFilter, 'all'>, string[]> = {
  waiting: ['ARRIVED', 'WAITING'],
  expected: ['REQUESTED', 'PENDING', 'CONFIRMED'],
  inclinic: ['IN_CLINIC'],
  done: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
};

export function matchesFilter(row: Pick<BoardRow, 'status'>, f: QueueFilter): boolean {
  if (f === 'all') return true;
  return GROUPS[f].includes(row.status ?? '');
}

export function countByFilter(rows: Pick<BoardRow, 'status'>[]): Record<QueueFilter, number> {
  const out: Record<QueueFilter, number> = { all: rows.length, waiting: 0, expected: 0, inclinic: 0, done: 0 };
  for (const r of rows) {
    for (const k of Object.keys(GROUPS) as Exclude<QueueFilter, 'all'>[]) {
      if (GROUPS[k].includes(r.status ?? '')) out[k]++;
    }
  }
  return out;
}

/** Lower-cases, converts Arabic digits, strips Arabic diacritics and unifies alef/yaa/taa-marbuta. */
export function normalizeSearch(s: string): string {
  return toLatinDigits(s)
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim();
}

/** Matches name, phone (digits only, so "010 123" finds "0101234567") or patient code. */
export function matchesSearch(
  row: Pick<BoardRow, 'display_name' | 'display_phone' | 'patient_code'>,
  query: string,
): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const name = normalizeSearch(row.display_name ?? '');
  const code = normalizeSearch(row.patient_code ?? '');
  if (name.includes(q) || code.includes(q)) return true;
  const qDigits = q.replace(/\D/g, '');
  if (qDigits.length >= 3) {
    const phone = toLatinDigits(row.display_phone ?? '').replace(/\D/g, '');
    return phone.includes(qDigits);
  }
  return false;
}

/**
 * Display order: people who need attention first (waiting → in clinic →
 * expected), finished/cancelled last; within a group by time. Does not mutate.
 */
export function orderForReception<T extends Pick<BoardRow, 'status' | 'scheduled_time'>>(rows: T[]): T[] {
  const rank = (s: string | null) => {
    if (GROUPS.waiting.includes(s ?? '')) return 0;
    if (GROUPS.inclinic.includes(s ?? '')) return 1;
    if (GROUPS.expected.includes(s ?? '')) return 2;
    return 3;
  };
  return [...rows].sort(
    (a, b) =>
      rank(a.status) - rank(b.status) ||
      /* A row with no time sorts last within its group, not first. */
      String(a.scheduled_time ?? '99:99').localeCompare(String(b.scheduled_time ?? '99:99')),
  );
}

/**
 * Who should be called into the room next: among people who have arrived
 * (ARRIVED / WAITING), the one who has waited longest; ties (or unknown wait)
 * fall back to the earlier scheduled time. Returns null when nobody is waiting.
 */
export function pickNextInQueue<T extends Pick<BoardRow, 'status' | 'scheduled_time' | 'wait_minutes'>>(
  rows: T[],
): T | null {
  const queued = rows.filter((r) => GROUPS.waiting.includes(r.status ?? ''));
  if (!queued.length) return null;
  return [...queued].sort(
    (a, b) =>
      (b.wait_minutes ?? -1) - (a.wait_minutes ?? -1) ||
      String(a.scheduled_time ?? '99:99').localeCompare(String(b.scheduled_time ?? '99:99')),
  )[0];
}
