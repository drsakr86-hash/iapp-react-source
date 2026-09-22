/**
 * Arabic error translation.
 *
 * Ported from iapp-core.js translateAuthError() and the per-service
 * translate() helpers. Raw PostgreSQL and PostgREST messages must never
 * reach a user — particularly a patient. Each service adds its own
 * constraint-name mappings on top of these shared cases.
 */

export const GENERIC_ERROR = 'حدث خطأ غير متوقع — حاول مرة أخرى';

export function translateAuthError(message: unknown): string {
  const m = String(message ?? '');
  if (/Invalid login credentials/i.test(m)) return 'البريد أو كلمة المرور غير صحيحة';
  if (/Email not confirmed/i.test(m)) return 'البريد غير مؤكَّد في Supabase Auth';
  if (/rate limit|too many/i.test(m)) return 'محاولات كثيرة — انتظر قليلاً';
  if (/network|fetch|Failed to fetch/i.test(m)) return 'تعذّر الاتصال بالخادم';
  return 'تعذّر تسجيل الدخول';
}

/** Shared database/transport cases. Services layer their own on top. */
export function translateDbError(error: unknown, context?: string): string {
  const m = String((error as { message?: string })?.message ?? error ?? '');
  const where = context ? ` (${context})` : '';

  if (/row-level security|permission denied|not authorized|Unauthorized/i.test(m))
    return 'لا تملك صلاحية لهذا الإجراء' + where;
  if (/JWT expired|token is expired/i.test(m)) return 'انتهت الجلسة — سجّل الدخول من جديد';
  if (/network|fetch|Failed to fetch/i.test(m)) return 'تعذّر الاتصال بالخادم' + where;
  if (/duplicate key|already exists/i.test(m)) return 'هذا السجل موجود بالفعل' + where;
  if (/violates foreign key/i.test(m)) return 'بيانات مرتبطة غير صحيحة' + where;
  if (/already has an opening balance/i.test(m))
    return 'هذا الحساب لديه رصيد افتتاحي بالفعل — لا يمكن إضافة أكثر من رصيد افتتاحي واحد لكل حساب' + where;
  if (/opening balance can only be the account.?s first transaction/i.test(m))
    return 'لا يمكن إضافة رصيد افتتاحي لحساب لديه حركات مالية بالفعل — الرصيد الافتتاحي يجب أن يكون أول حركة على الحساب' + where;

  // iapp.book_appointment / iapp.transition — raised with these exact
  // prefixes (see production-schema.sql), so match on the prefix rather
  // than the full message.
  if (/already_collected/i.test(m)) return 'تم تحصيل رسم الكشف لهذا الموعد بالفعل' + where;
  if (/slot_taken/i.test(m)) return 'هذا الموعد محجوز بالفعل — اختر وقتًا آخر' + where;
  if (/past_date/i.test(m)) return 'لا يمكن الحجز في تاريخ سابق' + where;
  if (/no_patient_link/i.test(m)) return 'هذا الحساب غير مرتبط بملف مريض' + where;
  if (/no_subject/i.test(m)) return 'اختر مريضًا أو أدخل اسم الحالة' + where;
  if (/forbidden_transition/i.test(m)) return 'هذا الإجراء غير متاح لدورك في هذه الحالة' + where;
  if (/forbidden:/i.test(m)) return 'غير مسموح لك بهذا الإجراء' + where;
  if (/invalid_transition/i.test(m)) return 'لا يمكن الانتقال إلى هذه الحالة من الحالة الحالية' + where;
  if (/reason_required/i.test(m)) return 'السبب مطلوب لإتمام هذا الإجراء' + where;
  if (/not_found: appointment/i.test(m)) return 'الموعد غير موجود' + where;
  if (/too_late/i.test(m)) return 'تعذّر تنفيذ هذا الإجراء في الحالة الحالية للموعد' + where;

  return GENERIC_ERROR + where;
}

/**
 * Log the technical detail, return the Arabic message.
 * Never render the raw message; never swallow it silently either.
 */
export function reportError(error: unknown, context?: string): string {
  if (import.meta.env.DEV) console.error('[iapp]', context ?? '', error);
  return translateDbError(error, context);
}
