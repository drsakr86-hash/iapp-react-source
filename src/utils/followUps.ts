/**
 * Pure grouping for the follow-up reminders list. No network, no DOM.
 * Dates are ISO yyyy-mm-dd strings compared lexically (valid for ISO dates).
 */

export interface DueFollowUp {
  id: string;
  patient_id: string;
  due_date: string;
  reason: string | null;
  status: string | null;
  notified_at: string | null;
  name: string;
  phone: string | null;
  code: string | null;
}

export type FollowUpGroup = 'overdue' | 'today' | 'upcoming';

export const FOLLOWUP_GROUPS: { key: FollowUpGroup; label: string }[] = [
  { key: 'overdue', label: 'متأخرة' },
  { key: 'today', label: 'اليوم' },
  { key: 'upcoming', label: 'قادمة' },
];

export function groupOf(dueDate: string, today: string): FollowUpGroup {
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  return 'upcoming';
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  return Math.round((b - a) / 86_400_000);
}

export function dueLabel(dueDate: string, today: string): string {
  const d = daysBetween(today, dueDate);
  if (d === 0) return 'اليوم';
  if (d === 1) return 'غدًا';
  if (d === -1) return 'أمس';
  if (d > 0) return `بعد ${d} أيام`;
  return `متأخرة ${-d} يوم`;
}

/** ISO date `n` days after `iso`. */
export function addDays(iso: string, n: number): string {
  const t = Date.parse(iso + 'T00:00:00Z') + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Overdue first (oldest first), then today, then upcoming (soonest first); not-yet-contacted before contacted. */
export function sortFollowUps(rows: DueFollowUp[]): DueFollowUp[] {
  return [...rows].sort(
    (x, y) =>
      x.due_date.localeCompare(y.due_date) ||
      Number(!!x.notified_at) - Number(!!y.notified_at) ||
      x.name.localeCompare(y.name, 'ar'),
  );
}

export function countByGroup(rows: DueFollowUp[], today: string): Record<FollowUpGroup, number> {
  const c: Record<FollowUpGroup, number> = { overdue: 0, today: 0, upcoming: 0 };
  for (const r of rows) c[groupOf(r.due_date, today)]++;
  return c;
}
