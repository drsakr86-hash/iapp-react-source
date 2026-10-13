/* -------------------------------------------------------------------------
 * Announcer — chime + spoken Arabic for the waiting-room screen.
 * -------------------------------------------------------------------------
 * Browsers refuse to play sound until the page has had a user gesture, so
 * nothing here plays until `enable()` has been called from a click/key press
 * (the screen shows a button for it). Everything degrades quietly: if
 * speechSynthesis or Web Audio is missing, `say()` resolves and the VISUAL
 * call on the screen is unaffected.
 *
 * Calls are spoken one at a time, oldest first, so two calls arriving in the
 * same poll never talk over each other.
 * ---------------------------------------------------------------------- */

export interface Announcer {
  /** What this browser can do (for the on-screen hint). */
  support: { speech: boolean; chime: boolean };
  /** Must be called from a user gesture. Resolves true when sound is unlocked. */
  enable(): Promise<boolean>;
  readonly enabled: boolean;
  /** Chime then speak. Resolves when finished (or immediately if sound is off/unsupported). */
  say(text: string): Promise<void>;
  /** Chime + a short test phrase. */
  test(): Promise<void>;
}

type AudioCtxCtor = typeof AudioContext;

export function createAnnouncer(env: {
  speech?: SpeechSynthesis | null;
  Utterance?: typeof SpeechSynthesisUtterance | null;
  AudioContext?: AudioCtxCtor | null;
} = {}): Announcer {
  const g = globalThis as unknown as {
    speechSynthesis?: SpeechSynthesis;
    SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
    AudioContext?: AudioCtxCtor;
    webkitAudioContext?: AudioCtxCtor;
  };
  const speech = env.speech !== undefined ? env.speech : (g.speechSynthesis ?? null);
  const Utterance = env.Utterance !== undefined ? env.Utterance : (g.SpeechSynthesisUtterance ?? null);
  const Ctx = env.AudioContext !== undefined ? env.AudioContext : (g.AudioContext ?? g.webkitAudioContext ?? null);

  let ctx: AudioContext | null = null;
  let enabled = false;
  let chain: Promise<void> = Promise.resolve();

  function arabicVoice(): SpeechSynthesisVoice | null {
    try {
      const voices = speech?.getVoices() ?? [];
      return (
        voices.find((v) => /^ar[-_]EG/i.test(v.lang)) ??
        voices.find((v) => /^ar/i.test(v.lang)) ??
        null
      );
    } catch {
      return null;
    }
  }

  async function chime(): Promise<void> {
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      const t0 = ctx.currentTime;
      // two soft rising tones
      [660, 880].forEach((freq, i) => {
        const osc = ctx!.createOscillator();
        const gain = ctx!.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + i * 0.28);
        gain.gain.exponentialRampToValueAtTime(0.35, t0 + i * 0.28 + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.28 + 0.26);
        osc.connect(gain).connect(ctx!.destination);
        osc.start(t0 + i * 0.28);
        osc.stop(t0 + i * 0.28 + 0.3);
      });
      await new Promise((r) => setTimeout(r, 620));
    } catch {
      /* no chime — the spoken/visual call still happens */
    }
  }

  function speak(text: string): Promise<void> {
    if (!speech || !Utterance) return Promise.resolve();
    return new Promise<void>((resolve) => {
      try {
        const u = new Utterance(text);
        const v = arabicVoice();
        u.lang = v?.lang ?? 'ar-SA';
        if (v) u.voice = v;
        u.rate = 0.9;
        u.volume = 1;
        // Some engines never fire onend; never let one hang the queue.
        const guard = setTimeout(resolve, 15_000);
        const done = () => {
          clearTimeout(guard);
          resolve();
        };
        u.onend = done;
        u.onerror = done;
        speech.speak(u);
      } catch {
        resolve();
      }
    });
  }

  const announcer: Announcer = {
    support: { speech: !!(speech && Utterance), chime: !!Ctx },
    get enabled() {
      return enabled;
    },
    async enable() {
      try {
        if (Ctx && !ctx) ctx = new Ctx();
        if (ctx && ctx.state === 'suspended') await ctx.resume();
        // Touch the speech engine inside the gesture so later calls are allowed.
        speech?.getVoices();
        enabled = true;
      } catch {
        enabled = !!(speech && Utterance);
      }
      return enabled;
    },
    say(text: string) {
      if (!enabled) return Promise.resolve();
      chain = chain.then(async () => {
        await chime();
        await speak(text);
      });
      return chain;
    },
    test() {
      return announcer.say('اختبار النداء، رقم واحد، تفضّل بالدخول');
    },
  };
  return announcer;
}
