/* -------------------------------------------------------------------------
 * Waiting-room display — pure logic (no React, no Supabase, no browser APIs).
 * -------------------------------------------------------------------------
 * Everything the public screen has to *decide* lives here so it can be tested
 * without a database or a TV:
 *   - what in a server snapshot is allowed on screen (whitelist),
 *   - which calls are new and must be announced (and which must NOT be),
 *   - what is said out loud,
 *   - how healthy the connection is and when to poll next.
 *
 * Privacy: `parseSnapshot` copies ONLY the whitelisted fields. If the server
 * ever returned a phone number, a diagnosis or any other field, it would be
 * dropped here and could never reach the DOM — defence in depth on top of the
 * server-side whitelist in public.display_queue.
 * ---------------------------------------------------------------------- */

export interface DisplayCurrent {
  call_id: number | null;
  kind: 'call' | 'recall' | null;
  ticket_no: number;
  /** First word of the name, present only when the screen was registered with names on. */
  name: string | null;
  doctor: string | null;
  room: string | null;
  called_at: string | null;
}

export interface DisplayWaiting {
  ticket_no: number;
  name: string | null;
  doctor: string | null;
  wait_minutes: number | null;
}

export interface DisplaySnapshot {
  server_time: string;
  clinic_name: string | null;
  day: string | null;
  show_names: boolean;
  latest_call_id: number;
  current: DisplayCurrent[];
  waiting: DisplayWaiting[];
  waiting_count: number;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null;

/** Validate + whitelist a server response. Returns null if it is not a snapshot. */
export function parseSnapshot(raw: unknown): DisplaySnapshot | null {
  if (!isObj(raw)) return null;
  const serverTime = str(raw.server_time);
  if (!serverTime || Number.isNaN(Date.parse(serverTime))) return null;
  const showNames = raw.show_names === true;

  const current: DisplayCurrent[] = [];
  for (const c of Array.isArray(raw.current) ? raw.current : []) {
    if (!isObj(c)) continue;
    const ticket = int(c.ticket_no);
    if (ticket == null) continue;
    current.push({
      call_id: int(c.call_id),
      kind: c.kind === 'recall' ? 'recall' : c.kind === 'call' ? 'call' : null,
      ticket_no: ticket,
      name: showNames ? str(c.name) : null,
      doctor: str(c.doctor),
      room: str(c.room),
      called_at: str(c.called_at),
    });
  }

  const waiting: DisplayWaiting[] = [];
  for (const w of Array.isArray(raw.waiting) ? raw.waiting : []) {
    if (!isObj(w)) continue;
    const ticket = int(w.ticket_no);
    if (ticket == null) continue;
    waiting.push({
      ticket_no: ticket,
      name: showNames ? str(w.name) : null,
      doctor: str(w.doctor),
      wait_minutes: int(w.wait_minutes),
    });
  }

  return {
    server_time: serverTime,
    clinic_name: str(raw.clinic_name),
    day: str(raw.day),
    show_names: showNames,
    latest_call_id: int(raw.latest_call_id) ?? 0,
    current,
    waiting,
    waiting_count: int(raw.waiting_count) ?? waiting.length,
  };
}

/** Highest call id the snapshot proves the screen has "seen". */
export function highestCallId(s: DisplaySnapshot): number {
  return s.current.reduce((m, c) => Math.max(m, c.call_id ?? 0), s.latest_call_id);
}

/**
 * Which calls must be announced now.
 *
 *  - First snapshot after load/reload (lastAnnouncedId === null): announce
 *    NOTHING. A reload or a re-render must never replay a call.
 *  - Otherwise: every current call whose id is newer than the last announced
 *    one, oldest first (two calls in one poll are both announced, in order).
 *  - Calls older than `maxAgeMs` (measured with SERVER time, so a TV with a
 *    wrong clock behaves) are skipped: a screen that was offline for ten
 *    minutes must not shout stale names when it reconnects.
 */
export function newAnnouncements(
  snapshot: DisplaySnapshot,
  lastAnnouncedId: number | null,
  maxAgeMs = 90_000,
): DisplayCurrent[] {
  if (lastAnnouncedId === null) return [];
  const serverNow = Date.parse(snapshot.server_time);
  return snapshot.current
    .filter((c) => c.call_id != null && c.call_id > lastAnnouncedId)
    .filter((c) => {
      if (!c.called_at) return true;
      const t = Date.parse(c.called_at);
      return Number.isNaN(t) || serverNow - t <= maxAgeMs;
    })
    .sort((a, b) => (a.call_id ?? 0) - (b.call_id ?? 0));
}

/** "1" → "غرفة 1"; "غرفة الفحص 7" stays as written. */
export function roomLabel(room: string | null): string | null {
  if (!room) return null;
  return /^[\d٠-٩]+$/.test(room.trim()) ? `غرفة ${room.trim()}` : room.trim();
}

/** The sentence read aloud (Arabic). Never includes anything but name/number/doctor/room. */
export function speechText(c: DisplayCurrent): string {
  const room = roomLabel(c.room);
  const parts: string[] = [];
  if (c.kind === 'recall') parts.push('نداء مكرر');
  if (c.name) parts.push(c.name);
  parts.push(`رقم ${c.ticket_no}`);
  let tail = 'تفضّل بالدخول';
  if (room) tail += ` إلى ${room}`;
  if (c.doctor) tail += room ? ` عند ${c.doctor}` : ` إلى ${c.doctor}`;
  parts.push(tail);
  return parts.join('، ');
}

export type ConnectionState = 'connected' | 'reconnecting' | 'offline' | 'invalid';

/**
 * connected    — last poll succeeded recently.
 * reconnecting — polls are failing but the last good data is still recent.
 * offline      — no good data for a while: the screen says so instead of
 *                silently showing a stale queue as if it were live.
 * invalid      — the server said the screen is not registered / was revoked.
 */
export function connectionState(opts: {
  invalid: boolean;
  lastOkMs: number | null;
  nowMs: number;
  failures: number;
  staleAfterMs?: number;
}): ConnectionState {
  if (opts.invalid) return 'invalid';
  if (opts.failures === 0 && opts.lastOkMs != null) return 'connected';
  const stale = opts.staleAfterMs ?? 20_000;
  if (opts.lastOkMs != null && opts.nowMs - opts.lastOkMs <= stale) return 'reconnecting';
  return opts.failures > 0 || opts.lastOkMs == null ? 'offline' : 'connected';
}

/** Poll every `base` ms (3 s); after failures back off 2x → 4x → 5x base, i.e. 6 → 12 → 15 s (never hammer a struggling server). */
export function nextPollDelay(failures: number, base = 3000): number {
  if (failures <= 0) return base;
  return Math.min(base * 2 ** Math.min(failures, 4), base * 5);
}

export function waitLabel(min: number | null): string {
  if (min == null || min <= 0) return '';
  return min < 60 ? `${min} د` : `${Math.floor(min / 60)} س ${min % 60} د`;
}
