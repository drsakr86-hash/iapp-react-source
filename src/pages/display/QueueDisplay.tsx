/* -------------------------------------------------------------------------
 * QueueDisplay — the public waiting-room screen (/display).
 * -------------------------------------------------------------------------
 * Opened on a TV or a spare tablet from the link created under
 * «شاشات الانتظار». No sign-in: the screen identifies itself with its token
 * and can only READ one whitelisted snapshot (public.display_queue).
 *
 * Refresh: it polls every 3 s (backing off to 15 s while the server is
 * unreachable), so a new call appears within a few seconds. While offline it
 * keeps showing the last good list but says so — it never presents a stale
 * queue as live.
 *
 * Announcing: a call is announced exactly once. The first snapshot after a
 * load/reload announces nothing; later snapshots announce only calls with an
 * id newer than the last one announced (kept in sessionStorage so an F5 does
 * not replay), and never a call older than 90 s of SERVER time.
 * ---------------------------------------------------------------------- */

import { useCallback, useEffect, useRef, useState } from 'react';
import '../../styles/display.css';
import { QueueDisplayView } from '../../components/display/QueueDisplayView';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { DisplayError, clearToken, fetchSnapshot, resolveToken } from '../../services/display';
import { createAnnouncer, type Announcer } from '../../utils/announce';
import {
  connectionState,
  highestCallId,
  newAnnouncements,
  nextPollDelay,
  speechText,
  type ConnectionState,
  type DisplayCurrent,
  type DisplaySnapshot,
} from '../../utils/queueDisplay';

const ALERT_MS = 12_000;
const IDLE_MS = 10_000;
/** Data older than this many poll intervals (7 x 3 s = 21 s) is no longer "recent". */
const STALE_POLLS = 7;

const hhmmss = (d: Date) => d.toLocaleTimeString('en-GB', { hour12: false });

export default function QueueDisplay({ pollBaseMs = 3000 }: { pollBaseMs?: number } = {}) {
  useDocumentTitle('شاشة الانتظار');
  const staleMs = pollBaseMs * STALE_POLLS;

  const [token] = useState<string | null>(() => resolveToken());
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('offline');
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [alertCall, setAlertCall] = useState<DisplayCurrent | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [clock, setClock] = useState(() => hhmmss(new Date()));
  const [idle, setIdle] = useState(false);

  const [announcer] = useState<Announcer>(() => createAnnouncer());

  const failures = useRef(0);
  const lastOk = useRef<number | null>(null);
  const invalid = useRef(token === null);
  const lastAnnounced = useRef<number | null>(null);
  const alertTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const storageKey = token ? `iapp:display-last-call:${token.slice(0, 8)}` : '';

  /* The last announced call id survives an F5 (sessionStorage) but not a
     browser restart; after a restart the first snapshot announces nothing. */
  useEffect(() => {
    if (!storageKey) return;
    try {
      const v = sessionStorage.getItem(storageKey);
      if (v !== null && /^\d+$/.test(v)) lastAnnounced.current = Number(v);
    } catch {
      /* storage blocked: behave as a fresh load */
    }
  }, [storageKey]);

  const handleSnapshot = useCallback(
    (snap: DisplaySnapshot) => {
      const toSay = newAnnouncements(snap, lastAnnounced.current);
      const next = Math.max(lastAnnounced.current ?? 0, highestCallId(snap));
      lastAnnounced.current = next;
      try {
        if (storageKey) sessionStorage.setItem(storageKey, String(next));
      } catch {
        /* ignore */
      }
      if (!toSay.length) return;
      setAlertCall(toSay[toSay.length - 1]);
      clearTimeout(alertTimer.current);
      alertTimer.current = setTimeout(() => setAlertCall(null), ALERT_MS);
      for (const c of toSay) void announcer.say(speechText(c));
    },
    [storageKey, announcer],
  );

  /* Poll loop. */
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      try {
        const snap = await fetchSnapshot(token);
        if (cancelled) return;
        failures.current = 0;
        lastOk.current = Date.now();
        handleSnapshot(snap);
        setSnapshot(snap);
        setLastUpdate(hhmmss(new Date()));
        setConnection('connected');
      } catch (e) {
        if (cancelled) return;
        if (e instanceof DisplayError && e.kind === 'invalid') {
          invalid.current = true;
          clearToken();
          setConnection('invalid');
          return; // a revoked screen stops polling
        }
        failures.current += 1;
      }
      timer = setTimeout(() => void run(), nextPollDelay(failures.current, pollBaseMs));
    };
    void run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, handleSnapshot, pollBaseMs]);

  /* 1 s tick: clock + connection health (also catches a request that hangs
     without ever failing). */
  useEffect(() => {
    const id = setInterval(() => {
      setClock(hhmmss(new Date()));
      const now = Date.now();
      const hung = lastOk.current != null && now - lastOk.current > staleMs;
      setConnection(
        connectionState({
          invalid: invalid.current,
          lastOkMs: lastOk.current,
          nowMs: now,
          failures: Math.max(failures.current, hung ? 1 : 0),
          staleAfterMs: staleMs,
        }),
      );
    }, 1000);
    return () => clearInterval(id);
  }, [staleMs]);

  /* Hide the controls after a few quiet seconds (TV). */
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), IDLE_MS);
    };
    wake();
    const events = ['pointermove', 'pointerdown', 'keydown'] as const;
    events.forEach((ev) => window.addEventListener(ev, wake));
    return () => {
      clearTimeout(t);
      events.forEach((ev) => window.removeEventListener(ev, wake));
    };
  }, []);

  /* Keep the TV awake where supported. */
  useEffect(() => {
    type Lock = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Lock> } };
    let lock: Lock | null = null;
    const acquire = async () => {
      try {
        lock = (await nav.wakeLock?.request('screen')) ?? null;
      } catch {
        lock = null;
      }
    };
    void acquire();
    const onVis = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  useEffect(() => () => clearTimeout(alertTimer.current), []);

  const a = announcer;
  const enableSound = () => {
    void a.enable().then((ok) => setSoundEnabled(ok));
  };
  const replay = () => {
    const c = alertCall ?? snapshot?.current[0];
    if (c) void a.say(speechText(c));
  };
  const fullscreen = () => {
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <QueueDisplayView
      snapshot={snapshot}
      connection={token === null ? 'invalid' : connection}
      lastUpdate={lastUpdate}
      alertCall={alertCall}
      soundEnabled={soundEnabled}
      speechSupported={a.support.speech}
      clock={clock}
      idle={idle}
      canFullscreen={typeof document !== 'undefined' && !!document.fullscreenEnabled}
      onEnableSound={enableSound}
      onTestSound={() => void a.test()}
      onReplay={replay}
      onFullscreen={fullscreen}
    />
  );
}
