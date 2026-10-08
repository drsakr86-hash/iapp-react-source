/**
 * Plain-text summaries of printable documents, for sending to the patient's
 * own WhatsApp number. Pure — builds strings from the already-loaded
 * ReportData, never fetches anything.
 *
 * Scope on purpose: prescriptions (drugs, glasses), follow-up appointment, and
 * a short visit summary. The full examination and imaging reports stay
 * print/PDF-only — they are long, clinical, and not meant for a chat thread.
 */
import type { ReportData, ReportDocType } from '../types/report';
import { EYE_AR } from '../types/domain';
import { fmtDay } from './models';

export const SHAREABLE_DOCS: ReportDocType[] = ['complete', 'medication', 'glasses', 'followup'];

const signed = (n: number | null | undefined, digits = 2): string => {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  return (v > 0 ? '+' : '') + v.toFixed(digits);
};

function header(d: ReportData, title: string): string[] {
  const clinic = d.clinic?.name_ar ? ` — ${d.clinic.name_ar}` : '';
  return [`السلام عليكم ${d.patient.full_name}،`, `${title}${clinic}`, `التاريخ: ${fmtDay(d.visit.visit_date)}`, ''];
}

function footer(d: ReportData): string[] {
  const who = [d.doctor.titleAr, d.doctor.displayName].filter(Boolean).join(' ');
  return ['', who ? `مع تحيات ${who}` : 'مع تمنياتنا بالشفاء العاجل'];
}

function drugLines(d: ReportData): string[] {
  const out: string[] = [];
  let n = 1;
  for (const rx of d.drugs) {
    for (const it of rx.items) {
      const eye = it.eye ? ` (${EYE_AR[it.eye] ?? it.eye})` : '';
      const parts = [it.dose, it.frequency, it.duration].filter((x) => x && String(x).trim());
      out.push(`${n++}) ${it.displayName}${eye}${parts.length ? ' — ' + parts.join(' — ') : ''}`);
      if (it.instructions?.trim()) out.push(`   ${it.instructions.trim()}`);
    }
    if (rx.prescription.notes?.trim()) out.push(`ملاحظات: ${rx.prescription.notes.trim()}`);
  }
  return out;
}

function glassesLines(d: ReportData): string[] {
  const out: string[] = [];
  for (const g of d.glasses) {
    for (const [label, r] of [['العين اليمنى (OD)', g.od], ['العين اليسرى (OS)', g.os]] as const) {
      if (!r) continue;
      const bits = [`SPH ${signed(r.sphere)}`, `CYL ${signed(r.cylinder)}`];
      if (r.axis != null) bits.push(`AXIS ${r.axis}`);
      if (r.add_power != null) bits.push(`ADD ${signed(r.add_power)}`);
      out.push(`${label}: ${bits.join('  ')}`);
    }
    const pd = g.od?.ipd_mm ?? g.os?.ipd_mm;
    if (pd != null) out.push(`PD: ${pd} مم`);
    if (g.prescription.notes?.trim()) out.push(`ملاحظات: ${g.prescription.notes.trim()}`);
  }
  return out;
}

function followUpLines(d: ReportData): string[] {
  return d.followUps.map((f) => `موعد المتابعة: ${fmtDay(f.due_date)}${f.reason?.trim() ? ' — ' + f.reason.trim() : ''}`);
}

/** Returns null when the document has nothing to say (so no button is offered). */
export function buildShareMessage(type: ReportDocType, d: ReportData): string | null {
  let body: string[] = [];
  let title = '';
  switch (type) {
    case 'medication':
      title = 'وصفة الأدوية';
      body = drugLines(d);
      break;
    case 'glasses':
      title = 'وصفة النظارة';
      body = glassesLines(d);
      break;
    case 'followup':
      title = 'موعد المتابعة';
      body = followUpLines(d);
      break;
    case 'complete': {
      title = 'ملخص الزيارة';
      const dx = d.diagnoses.map((x) => x.diagnosis_text.trim()).filter(Boolean);
      const sections: string[] = [];
      if (dx.length) sections.push('التشخيص: ' + dx.join('، '));
      const drugs = drugLines(d);
      if (drugs.length) sections.push('الأدوية:', ...drugs);
      const gl = glassesLines(d);
      if (gl.length) sections.push('النظارة:', ...gl);
      sections.push(...followUpLines(d));
      body = sections;
      break;
    }
    default:
      return null;
  }
  if (!body.length) return null;
  return [...header(d, title), ...body, ...footer(d)].join('\n');
}
