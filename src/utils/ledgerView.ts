/**
 * Pure helpers for the payments ledger screen: search, paging, CSV export, and
 * the receipt text sent over WhatsApp. No fetching — operate on loaded rows.
 */
import { normalizeSearch } from './appointmentFilters';

export const LEDGER_PAGE_SIZE = 25;
/** The service layer caps one ledger query at this many rows (payments.ts). */
export const LEDGER_FETCH_LIMIT = 500;

export interface LedgerRow {
  id: string;
  patient_id: string;
  service_id: string | null;
  amount: number;
  amount_paid: number;
  method: string | null;
  status: string;
  receipt_no: string | null;
  notes: string | null;
  paid_at: string | null;
  created_at?: string;
}

/** Matches patient name, receipt number, or notes. Empty query matches all. */
export function filterLedger<T extends LedgerRow>(
  rows: T[],
  query: string,
  patientName: (id: string) => string | undefined,
): T[] {
  const q = normalizeSearch(query);
  if (!q) return rows;
  return rows.filter((r) => {
    const hay = normalizeSearch(`${patientName(r.patient_id) ?? ''} ${r.receipt_no ?? ''} ${r.notes ?? ''}`);
    return hay.includes(q);
  });
}

export function paginate<T>(rows: T[], page: number, size = LEDGER_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { items: rows.slice((p - 1) * size, p * size), page: p, pages, total: rows.length };
}

/** Spreadsheet formula injection: a cell starting with = + - @ would be executed by Excel. */
function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export interface CsvLookups {
  patientName: (id: string) => string | undefined;
  serviceName: (id: string | null) => string | undefined;
  methodAr: (m: string | null) => string;
  statusAr: (s: string) => string;
  dateLabel: (iso: string | null) => string;
}

/** UTF-8 with BOM so Excel opens the Arabic text correctly. */
export function ledgerToCsv(rows: LedgerRow[], L: CsvLookups): string {
  const head = ['التاريخ', 'المريض', 'الخدمة', 'المبلغ', 'المدفوع', 'المتبقي', 'الطريقة', 'الحالة', 'رقم الإيصال', 'ملاحظات'];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push(
      [
        L.dateLabel(r.paid_at),
        L.patientName(r.patient_id) ?? '',
        L.serviceName(r.service_id) ?? '',
        r.amount.toFixed(2),
        r.amount_paid.toFixed(2),
        (r.amount - r.amount_paid).toFixed(2),
        L.methodAr(r.method),
        L.statusAr(r.status),
        r.receipt_no ?? '',
        r.notes ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return '﻿' + lines.join('\r\n');
}

export function receiptShareMessage(r: {
  patientName: string;
  clinic?: string | null;
  date: string;
  receiptNo?: string | null;
  serviceName?: string | null;
  amountPaid: number;
  currency?: string | null;
}): string {
  const cur = r.currency && r.currency !== 'EGP' ? r.currency : 'جنيه';
  return [
    `السلام عليكم ${r.patientName}،`,
    `إيصال دفع${r.clinic ? ' — ' + r.clinic : ''}`,
    `التاريخ: ${r.date}`,
    r.receiptNo ? `رقم الإيصال: ${r.receiptNo}` : '',
    r.serviceName ? `الخدمة: ${r.serviceName}` : '',
    `المبلغ المدفوع: ${r.amountPaid.toFixed(2)} ${cur}`,
    '',
    'شكراً لثقتكم.',
  ]
    .filter((x, i, a) => x !== '' || (i > 0 && a[i - 1] !== ''))
    .join('\n');
}
