/**
 * WhatsApp click-to-chat helpers (wa.me). Pure — no network, no DOM.
 *
 * Phone numbers in the database are free text as typed by reception
 * (01012345678, 010 1234 5678, +20 101 234 5678, ٠١٠١٢٣٤٥٦٧٨ …).
 * wa.me needs digits only, with the country code and no leading zero.
 * Default country is Egypt (+20).
 */

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/** Converts Arabic-Indic / Persian digits to ASCII, leaves everything else alone. */
export function toLatinDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (ch) => {
    const a = ARABIC_INDIC.indexOf(ch);
    if (a >= 0) return String(a);
    return String(EASTERN_ARABIC_INDIC.indexOf(ch));
  });
}

/**
 * Returns the international digits-only number (e.g. "201012345678"), or
 * null when the input cannot be a valid mobile number. Never guesses: a
 * wrong number would send a patient's appointment details to a stranger.
 */
export function normalizePhone(raw: string | null | undefined, defaultCountry = '20'): string | null {
  if (!raw) return null;
  const hadPlus = raw.trim().startsWith('+');
  let d = toLatinDigits(raw).replace(/\D/g, '');
  if (!d) return null;

  let international = hadPlus;
  if (d.startsWith('00')) {
    d = d.slice(2); // 0020…  → 20…
    international = true;
  } else if (!hadPlus && d.startsWith('0')) {
    d = defaultCountry + d.slice(1); // 010… → 2010…
  } else if (defaultCountry === '20' && /^1[0125]\d{8}$/.test(d)) {
    d = '20' + d; // 1012345678 (typed without the leading zero)
  }

  if (defaultCountry === '20' && d.startsWith('20')) {
    // Egyptian mobile: 20 + 1[0125] + 8 digits = 12 digits
    return /^201[0125]\d{8}$/.test(d) ? d : null;
  }
  // Another country: only when the user wrote it as international (+ or 00),
  // otherwise it is ambiguous and we do not guess.
  return international && d.length >= 10 && d.length <= 15 ? d : null;
}

export function whatsappUrl(phone: string | null | undefined, message?: string): string | null {
  const n = normalizePhone(phone);
  if (!n) return null;
  return `https://wa.me/${n}` + (message ? `?text=${encodeURIComponent(message)}` : '');
}

export interface ReminderInput {
  name?: string | null;
  clinic?: string | null;
  doctor?: string | null;
  /** "الخميس 2026-10-09" — already formatted for display. */
  dayLabel: string;
  /** "HH:MM" */
  time: string;
}

/** Appointment reminder text. Contains no clinical information on purpose. */
export function reminderMessage(r: ReminderInput): string {
  const who = r.name ? ` ${r.name}` : '';
  const where = r.clinic ? ` في ${r.clinic}` : '';
  const withDoc = r.doctor ? ` مع ${r.doctor}` : '';
  return (
    `السلام عليكم${who}،\n` +
    `نذكّركم بموعدكم${where}${withDoc} يوم ${r.dayLabel} الساعة ${r.time}.\n` +
    `نرجو الحضور قبل الموعد بـ 10 دقائق، وفي حال عدم القدرة على الحضور برجاء إبلاغنا.`
  );
}
