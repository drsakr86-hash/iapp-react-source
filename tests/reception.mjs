/**
 * Reception helpers: WhatsApp number normalization, queue filters, search,
 * and list ordering. Pure logic — no database.
 * Run: npm run reception
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const dir = path.dirname(fileURLToPath(import.meta.url));
const bundle = fs.readFileSync(path.join(dir, 'dist-reception/reception.js'), 'utf8');

let pass = 0;
const failures = [];
const ok = (name, cond, detail) => (cond ? pass++ : failures.push({ name, detail }));
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', url: 'http://localhost/' });
dom.window.eval(bundle);
const { wa, filters, share, ledger, theme, fu, models } = dom.window.__iappReception;

const h = (t) => console.log('\x1b[1m' + t + '\x1b[0m');

h('1. أرقام الواتساب — تطبيع');
eq('local 01…', wa.normalizePhone('01012345678'), '201012345678');
eq('spaces/dashes', wa.normalizePhone('010 1234-5678'), '201012345678');
eq('+20', wa.normalizePhone('+20 101 234 5678'), '201012345678');
eq('0020', wa.normalizePhone('00201012345678'), '201012345678');
eq('20 without plus', wa.normalizePhone('201012345678'), '201012345678');
eq('arabic digits', wa.normalizePhone('٠١٠١٢٣٤٥٦٧٨'), '201012345678');
eq('no leading zero', wa.normalizePhone('1012345678'), '201012345678');
eq('vodafone 010 / etisalat 011 / orange 012 / we 015', ['01012345678','01112345678','01212345678','01512345678'].map((x) => wa.normalizePhone(x)).every(Boolean), true);
eq('landline rejected', wa.normalizePhone('0453456789'), null);
eq('too short rejected', wa.normalizePhone('0101234'), null);
eq('wrong prefix 013 rejected', wa.normalizePhone('01312345678'), null);
eq('empty/null', [wa.normalizePhone(''), wa.normalizePhone(null), wa.normalizePhone(undefined), wa.normalizePhone('abc')], [null, null, null, null]);
eq('foreign with +', wa.normalizePhone('+966501234567'), '966501234567');
eq('foreign without + is not guessed', wa.normalizePhone('966501234567'), null);

h('2. رابط الواتساب والرسالة');
eq('url no text', wa.whatsappUrl('01012345678'), 'https://wa.me/201012345678');
eq('url invalid', wa.whatsappUrl('123'), null);
const msg = wa.reminderMessage({ name: 'أحمد', clinic: 'عيادة صقر', doctor: 'د. عبدو', dayLabel: 'الخميس 2026-10-09', time: '18:30' });
ok('message has time/day/name', msg.includes('18:30') && msg.includes('الخميس 2026-10-09') && msg.includes('أحمد'), msg);
const url = wa.whatsappUrl('01012345678', msg);
ok('url encodes text', url.startsWith('https://wa.me/201012345678?text=') && !url.includes(' ') && !url.includes('\n'), url);
const bare = wa.reminderMessage({ dayLabel: 'x', time: '10:00' });
ok('message without optional parts has no "undefined"/"null"', !/undefined|null/.test(bare), bare);

h('3. فلاتر الطابور');
const rows = [
  { id: 1, status: 'COMPLETED', scheduled_time: '09:00:00', display_name: 'سارة محمود', display_phone: '01011112222', patient_code: 'P-100' },
  { id: 2, status: 'CONFIRMED', scheduled_time: '12:00:00', display_name: 'أحمد علي', display_phone: '٠١٢٢٣٣٣٤٤٤٤', patient_code: 'P-101' },
  { id: 3, status: 'WAITING', scheduled_time: '11:00:00', display_name: 'إيمان حسن', display_phone: null, patient_code: null },
  { id: 4, status: 'IN_CLINIC', scheduled_time: '10:00:00', display_name: 'خالد', display_phone: '01555556666', patient_code: 'P-103' },
  { id: 5, status: 'ARRIVED', scheduled_time: '13:00:00', display_name: 'منى', display_phone: '01099998888', patient_code: 'P-104' },
  { id: 6, status: 'CANCELLED', scheduled_time: '08:00:00', display_name: 'عمر', display_phone: '01077776666', patient_code: 'P-105' },
  { id: 7, status: null, scheduled_time: null, display_name: null, display_phone: null, patient_code: null },
];
const c = filters.countByFilter(rows);
eq('counts', c, { all: 7, waiting: 2, expected: 1, inclinic: 1, done: 2 });
eq('filter waiting', rows.filter((r) => filters.matchesFilter(r, 'waiting')).map((r) => r.id), [3, 5]);
eq('filter done', rows.filter((r) => filters.matchesFilter(r, 'done')).map((r) => r.id), [1, 6]);
ok('null status only in "all"', filters.matchesFilter(rows[6], 'all') && !['waiting','expected','inclinic','done'].some((f) => filters.matchesFilter(rows[6], f)));

h('4. البحث');
const find = (q) => rows.filter((r) => filters.matchesSearch(r, q)).map((r) => r.id);
eq('empty query matches all', find('').length, 7);
eq('by name', find('سارة'), [1]);
eq('alef variants: ايمان ↔ إيمان', find('ايمان'), [3]);
eq('taa marbuta / haa: منه ↔ منى handled by yaa? (no) → exact', find('منى'), [5]);
eq('phone latin digits', find('0155555'), [4]);
eq('phone arabic digits query vs latin stored', find('٠١٠١١١١'), [1]);
eq('phone latin query vs arabic stored', find('012233'), [2]);
eq('phone with spaces', find('010 1111'), [1]);
eq('by code', find('p-104'), [5]);
eq('short digit query does not match phones (avoids noise)', find('09'), []);
eq('no match', find('zzz'), []);

h('5. ترتيب القائمة');
const ordered = filters.orderForReception(rows).map((r) => r.id);
eq('waiting → in clinic → expected → done, by time', ordered, [3, 5, 4, 2, 6, 1, 7]);
ok('does not mutate input', rows[0].id === 1 && rows[6].id === 7);


h('6. من هو التالي في الطابور');
{
  const q = [
    { id: 'a', status: 'WAITING', scheduled_time: '10:30:00', wait_minutes: 5 },
    { id: 'b', status: 'ARRIVED', scheduled_time: '11:00:00', wait_minutes: 25 },
    { id: 'c', status: 'CONFIRMED', scheduled_time: '09:00:00', wait_minutes: null },
    { id: 'd', status: 'IN_CLINIC', scheduled_time: '09:30:00', wait_minutes: 40 },
    { id: 'e', status: 'WAITING', scheduled_time: '09:45:00', wait_minutes: null },
  ];
  eq('longest wait first', filters.pickNextInQueue(q).id, 'b');
  eq('tie on unknown wait → earlier time', filters.pickNextInQueue([q[4], { id: 'f', status: 'ARRIVED', scheduled_time: '12:00:00', wait_minutes: null }]).id, 'e');
  eq('known wait beats unknown', filters.pickNextInQueue([q[4], q[0]]).id, 'a');
  eq('nobody waiting → null', filters.pickNextInQueue([q[2], q[3]]), null);
  eq('empty → null', filters.pickNextInQueue([]), null);
  eq('IN_CLINIC / CONFIRMED are never "next"', ['c', 'd'].includes(filters.pickNextInQueue(q).id), false);
}

h('7. نص المشاركة (واتساب)');
{
  const base = {
    patient: { full_name: 'محمد أحمد', phone: '01012345678' },
    visit: { visit_date: '2026-10-09' },
    clinic: { name_ar: 'عيادة صقر' },
    doctor: { displayName: 'عبد الستار صقر', titleAr: 'د.' },
    diagnoses: [{ diagnosis_text: 'جفاف العين' }, { diagnosis_text: '  ' }],
    followUps: [{ due_date: '2026-10-23', reason: 'قياس الضغط' }],
    glasses: [{ prescription: { notes: null }, od: { sphere: -1.5, cylinder: -0.75, axis: 90, add_power: null, ipd_mm: 62 }, os: { sphere: 0.25, cylinder: null, axis: null, add_power: 2, ipd_mm: null } }],
    drugs: [{ prescription: { notes: 'بعد الغسل' }, items: [
      { displayName: 'قطرة ترطيب', dose: 'قطرة', frequency: '4 مرات يومياً', duration: '14 يوماً', eye: 'OU', instructions: 'تُحفظ في الثلاجة' },
      { displayName: 'مرهم', dose: null, frequency: null, duration: null, eye: null, instructions: null },
    ] }],
  };
  const med = share.buildShareMessage('medication', base);
  ok('medication: header has name + clinic', med.includes('محمد أحمد') && med.includes('عيادة صقر'), med);
  ok('medication: numbered lines with parts', med.includes('1) قطرة ترطيب (كلتا العينين) — قطرة — 4 مرات يومياً — 14 يوماً'), med);
  ok('medication: instructions + notes kept', med.includes('تُحفظ في الثلاجة') && med.includes('ملاحظات: بعد الغسل'), med);
  ok('medication: drug without details has no dangling dash', med.includes('2) مرهم') && !med.includes('2) مرهم —'), med);
  ok('medication: signed off with the doctor', med.includes('د. عبد الستار صقر'), med);
  const gl = share.buildShareMessage('glasses', base);
  ok('glasses: signed powers', gl.includes('SPH -1.50') && gl.includes('CYL -0.75') && gl.includes('AXIS 90') && gl.includes('SPH +0.25'), gl);
  ok('glasses: missing cylinder shows a dash, never NaN/null', gl.includes('CYL —') && !/NaN|null|undefined/.test(gl), gl);
  ok('glasses: OD before OS and PD', gl.indexOf('(OD)') < gl.indexOf('(OS)') && gl.includes('PD: 62'), gl);
  const fu = share.buildShareMessage('followup', base);
  ok('followup: date + reason', fu.includes('2026-10-23') && fu.includes('قياس الضغط'), fu);
  const all = share.buildShareMessage('complete', base);
  ok('complete: diagnosis (blank ones skipped), drugs, glasses, follow-up', all.includes('التشخيص: جفاف العين') && !all.includes('جفاف العين،') && all.includes('الأدوية:') && all.includes('النظارة:') && all.includes('موعد المتابعة'), all);
  eq('no data → null (no button offered)', share.buildShareMessage('medication', { ...base, drugs: [] }), null);
  eq('non-shareable types → null', [share.buildShareMessage('examination', base), share.buildShareMessage('imaging_report', base), share.buildShareMessage('investigation_request', base)], [null, null, null]);
  ok('the share URL is built from it', wa.whatsappUrl('01012345678', med).startsWith('https://wa.me/201012345678?text='));
}

h('8. سجل المدفوعات: بحث وتصفح وCSV');
{
  const rows = Array.from({ length: 60 }, (_, i) => ({
    id: 'r' + i, patient_id: i % 2 ? 'p-b' : 'p-a', service_id: i % 3 ? 's1' : null, amount: 100 + i, amount_paid: i % 5 ? 100 + i : 50,
    method: 'cash', status: i % 5 ? 'paid' : 'partial', receipt_no: 'R-' + String(1000 + i), notes: i === 7 ? '=HYPERLINK("http://x")' : null, paid_at: '2026-10-0' + (1 + (i % 9)) + 'T10:00:00',
  }));
  const names = { 'p-a': 'أحمد علي', 'p-b': 'سارة محمود' };
  const nm = (id) => names[id];
  eq('empty query → all', ledger.filterLedger(rows, '', nm).length, 60);
  eq('by patient name', ledger.filterLedger(rows, 'سارة', nm).length, 30);
  eq('by receipt no', ledger.filterLedger(rows, 'r-1007', nm).map((r) => r.id), ['r7']);
  eq('alef-tolerant name search', ledger.filterLedger(rows, 'احمد', nm).length, 30);
  eq('no match', ledger.filterLedger(rows, 'zzz', nm).length, 0);
  const p1 = ledger.paginate(rows, 1);
  eq('page 1 size', [p1.items.length, p1.pages, p1.total], [25, 3, 60]);
  eq('last page is the remainder', ledger.paginate(rows, 3).items.length, 10);
  eq('page beyond range clamps', ledger.paginate(rows, 99).page, 3);
  eq('page 0 / NaN clamps to 1', [ledger.paginate(rows, 0).page, ledger.paginate(rows, NaN).page], [1, 1]);
  eq('empty list: one page, no items', [ledger.paginate([], 1).pages, ledger.paginate([], 1).items.length], [1, 0]);
  const L = { patientName: nm, serviceName: (id) => (id === 's1' ? 'كشف' : undefined), methodAr: () => 'نقدي', statusAr: (s) => (s === 'paid' ? 'مدفوع' : 'جزئي'), dateLabel: (i) => (i ? i.slice(0, 10) : '') };
  const csv = ledger.ledgerToCsv(rows.slice(0, 10), L);
  ok('CSV starts with BOM (Excel + Arabic)', csv.charCodeAt(0) === 0xfeff);
  eq('CSV: header + 10 rows', csv.split('\r\n').length, 11);
  ok('CSV: formula injection neutralised', csv.includes("\"'=HYPERLINK(\"\"http://x\"\")\"") || csv.includes("'=HYPERLINK"), csv.split('\r\n')[8]);
  ok('CSV: no raw formula cell', !csv.split('\r\n').slice(1).some((l) => l.split(',').some((c) => /^[=+\-@]/.test(c))));
  ok('CSV: outstanding computed', csv.split('\r\n')[1].includes('50.00'), csv.split('\r\n')[1]);
  const msg = ledger.receiptShareMessage({ patientName: 'أحمد', clinic: 'عيادة صقر', date: '2026-10-09', receiptNo: 'R-1', serviceName: 'كشف', amountPaid: 250, currency: 'EGP' });
  ok('receipt text', msg.includes('R-1') && msg.includes('250.00 جنيه') && msg.includes('كشف'), msg);
  ok('receipt text without optional parts is clean', !/undefined|null|\n\n\n/.test(ledger.receiptShareMessage({ patientName: 'x', date: 'd', amountPaid: 1 })));
}

h('9. الوضع الفاتح');
{
  const mk = (v) => ({ v, getItem() { return this.v; }, setItem(k, x) { this.v = x; } });
  eq('default is dark', theme.readTheme(mk(null)), 'dark');
  eq('stored light', theme.readTheme(mk('light')), 'light');
  eq('garbage → dark', theme.readTheme(mk('purple')), 'dark');
  eq('no storage → dark', theme.readTheme(null), 'dark');
  const st = mk(null); theme.writeTheme(st, 'light');
  eq('write then read', theme.readTheme(st), 'light');
  eq('throwing storage is tolerated', theme.readTheme({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }), 'dark');
  const d = new JSDOM('<!doctype html><html><head><meta name="theme-color" content="#0A0F1E"></head><body></body></html>').window.document;
  theme.applyTheme(d, 'light');
  eq('light sets data-theme + meta', [d.documentElement.getAttribute('data-theme'), d.querySelector('meta').getAttribute('content')], ['light', '#F4F7FB']);
  theme.applyTheme(d, 'dark');
  eq('dark removes it + meta back', [d.documentElement.getAttribute('data-theme'), d.querySelector('meta').getAttribute('content')], [null, '#0A0F1E']);
}

h('10. متابعات مستحقة');
{
  const T = '2026-10-13';
  eq('overdue', fu.groupOf('2026-10-12', T), 'overdue');
  eq('today', fu.groupOf(T, T), 'today');
  eq('upcoming', fu.groupOf('2026-10-14', T), 'upcoming');
  eq('month boundary', fu.addDays('2026-10-31', 1), '2026-11-01');
  eq('year boundary', fu.addDays('2026-12-31', 7), '2027-01-07');
  eq('label today', fu.dueLabel(T, T), 'اليوم');
  eq('label tomorrow', fu.dueLabel('2026-10-14', T), 'غدًا');
  eq('label yesterday', fu.dueLabel('2026-10-12', T), 'أمس');
  eq('label overdue', fu.dueLabel('2026-10-03', T), 'متأخرة 10 يوم');
  eq('label upcoming', fu.dueLabel('2026-10-16', T), 'بعد 3 أيام');
  const mk = (id, d, n, name) => ({ id, patient_id: id, due_date: d, reason: null, status: 'pending', notified_at: n, name, phone: null, code: null });
  const rows = [mk('c', '2026-10-15', null, 'ج'), mk('a', '2026-10-10', '2026-10-11', 'أ'), mk('b', '2026-10-10', null, 'ب'), mk('d', T, null, 'د')];
  eq('sort: oldest first, un-contacted before contacted', fu.sortFollowUps(rows).map((r) => r.id), ['b', 'a', 'd', 'c']);
  eq('input not mutated', rows.map((r) => r.id), ['c', 'a', 'b', 'd']);
  eq('counts', fu.countByGroup(rows, T), { overdue: 2, today: 1, upcoming: 1 });
  const m = wa.followUpMessage({ name: 'سارة', doctor: 'د. عبده', dayLabel: 'الخميس 2026-10-15' });
  ok('follow-up text has name, doctor, day', m.includes('سارة') && m.includes('د. عبده') && m.includes('2026-10-15'), m);
  ok('follow-up text is clean without optional parts', !/undefined|null/.test(wa.followUpMessage({ dayLabel: 'd' })));
  ok('follow-up text has no clinical words', !/تشخيص|علاج|دواء|حقن/.test(m));
  ok('follow-up wa link', wa.whatsappUrl('01012345678', m).startsWith('https://wa.me/201012345678?text='));
}

h('11. حقول الفحص الإلزامية (فحص جديد)');
{
  const full = { patient_id: 'p', exam_date: '2026-10-13', chief_complaint: 'زغللة', va_right: '6/6', va_left: '6/9', va_right_corrected: '6/6', va_left_corrected: '6/6', iop_right: '14', iop_left: '15', ref_od_sph: '-1.00', ref_os_cyl: '-0.50', anterior_segment: 'سليم', posterior_segment: 'سليم', treatment_plan: 'نظارة' };
  ok('كل الحقول → ينجح', models.validateExam(full, { requireClinical: true }).ok);
  ok('فحص فارغ إلا المريض والتاريخ → يفشل للجديد', !models.validateExam({ patient_id: 'p', exam_date: '2026-10-13' }, { requireClinical: true }).ok);
  ok('نفس الفحص الفارغ → يمر في التعديل (بدون الإلزام)', models.validateExam({ patient_id: 'p', exam_date: '2026-10-13' }).ok);
  const miss = (patch) => models.missingRequiredExamFields({ ...full, ...patch });
  eq('عين واحدة في UCVA لا تكفي', miss({ va_left: '' }), ['حدة الإبصار بدون نظارة (العينين)']);
  eq('عين واحدة في BCVA لا تكفي', miss({ va_right_corrected: ' ' }), ['حدة الإبصار مع النظارة (العينين)']);
  eq('عين واحدة في الضغط لا تكفي', miss({ iop_left: '' }), ['ضغط العين (العينين)']);
  eq('الانكسار مطلوب لكل عين', miss({ ref_od_sph: '', ref_od_cyl: '' }), ['الانكسار OD (SPH أو CYL)']);
  ok('SPH صفر (plano) يُحسب قيمة', miss({ ref_od_sph: '0' }).length === 0);
  eq('الجزء الأمامي', miss({ anterior_segment: '' }), ['الجزء الأمامي (العينين)']);
  eq('الجزء الخلفي', miss({ posterior_segment: '' }), ['الجزء الخلفي (العينين)']);
  eq('خطة العلاج', miss({ treatment_plan: '' }), ['خطة العلاج']);
  eq('الشكوى', miss({ chief_complaint: '  ' }), ['الشكوى الرئيسية']);
  // Real form: segments arrive as per-eye findings, not as text columns.
  const noSeg = { ...full, anterior_segment: '', posterior_segment: '' };
  const F = (eye, field) => ({ eye, field, value: 'طبيعية' });
  eq('بدون أي findings → الجزءان ناقصان', models.missingRequiredExamFields({ ...noSeg, findings: [] }), ['الجزء الأمامي (العينين)', 'الجزء الخلفي (العينين)']);
  eq('findings للعينين → مكتمل', models.missingRequiredExamFields({ ...noSeg, findings: [F('OD', 'lids'), F('OS', 'cornea'), F('OD', 'macula'), F('OS', 'disc')] }), []);
  eq('الأمامي لعين واحدة لا يكفي', models.missingRequiredExamFields({ ...noSeg, findings: [F('OD', 'lids'), F('OD', 'macula'), F('OS', 'disc')] }), ['الجزء الأمامي (العينين)']);
  eq('قيمة فارغة في finding لا تُحسب', models.missingRequiredExamFields({ ...noSeg, findings: [{ eye: 'OD', field: 'lids', value: ' ' }, F('OS', 'lids'), F('OD', 'macula'), F('OS', 'disc')] }), ['الجزء الأمامي (العينين)']);
  ok('الأمامي لا يُحسب خلفياً والعكس', models.missingRequiredExamFields({ ...noSeg, findings: [F('OD', 'lids'), F('OS', 'lids')] }).includes('الجزء الخلفي (العينين)'));
  const R = models.REF_OPTIONS;
  eq('SPH من +10 إلى -20', [R.sph[0], R.sph[R.sph.length - 1], R.sph.length], ['10.00', '-20.00', 121]);
  ok('SPH يحوي 0.00 و -1.25 و 1.25', ['0.00', '-1.25', '1.25'].every((x) => R.sph.includes(x)));
  eq('CYL من 0 إلى -6', [R.cyl[0], R.cyl[R.cyl.length - 1], R.cyl.length], ['0.00', '-6.00', 25]);
  eq('AXIS 5..180', [R.axis[0], R.axis[R.axis.length - 1], R.axis.length], ['5', '180', 36]);
  eq('ADD 0.75..3.50', [R.add[0], R.add[R.add.length - 1], R.add.length], ['0.75', '3.50', 12]);
  ok('لا قيمة بعلامة + (حقل number يرفضها)', Object.values(R).flat().every((x) => !x.startsWith('+')));
  const msg = models.validateExam({ patient_id: 'p', exam_date: '2026-10-13' }, { requireClinical: true }).errors[0];
  ok('الرسالة تسرد كل الناقص', msg.startsWith('أكمل الحقول التالية') && msg.includes('خطة العلاج') && msg.includes('الانكسار OS'), msg);
  ok('حقول اختيارية لا تُطلب', !['رؤية الألوان', 'Cover', 'Pinhole', 'ملاحظات'].some((x) => msg.includes(x)));
}

h('12. مواعيد مريض محذوف');
{
  const L = filters.isListedAppointment;
  ok('موعد عادي يظهر', L({ status: 'CONFIRMED', patient_id: 'p1', display_name: 'منى' }));
  ok('مكتمل لمريض موجود يظهر', L({ status: 'COMPLETED', patient_id: 'p1', display_name: 'منى' }));
  ok('مريض محذوف (id بلا اسم) يختفي', !L({ status: 'COMPLETED', patient_id: 'p1', display_name: null }));
  ok('اسم فارغ/مسافات يختفي', !L({ status: 'CONFIRMED', patient_id: 'p1', display_name: '  ' }));
  ok('زائر بلا ملف (guest) يظهر باسمه', L({ status: 'CONFIRMED', patient_id: null, display_name: 'زائر' }));
  ok('الملغي يختفي', !L({ status: 'CANCELLED', patient_id: 'p1', display_name: 'منى' }));
  ok('لم يحضر يختفي', !L({ status: 'NO_SHOW', patient_id: 'p1', display_name: 'منى' }));
}

h('13. مدفوعات مريض محذوف');
{
  eq('ثابت التسمية', ledger.DELETED_PATIENT_LABEL, 'مريض محذوف');
  const rows = [{ id: 'a', patient_id: 'gone', amount: 200, amount_paid: 200, discount: 0, status: 'paid', receipt_no: 'R-9', notes: null, paid_at: '2026-10-13T10:00:00Z', created_at: '2026-10-13T10:00:00Z', method: 'cash', service_id: null }];
  eq('البحث يجد باسم "مريض محذوف"', ledger.filterLedger(rows, 'محذوف', () => ledger.DELETED_PATIENT_LABEL).length, 1);
  ok('CSV يكتب التسمية لا الـ id', ledger.ledgerToCsv(rows, { patientName: () => ledger.DELETED_PATIENT_LABEL, serviceName: () => undefined, methodAr: (m) => m, statusAr: (x) => x, dateLabel: (d) => d.slice(0, 10) }).includes('مريض محذوف'));
}

console.log();
if (failures.length) {
  console.log('\x1b[31m✗ فشل ' + failures.length + ' من ' + (pass + failures.length) + '\x1b[0m');
  for (const f of failures) console.log(' -', f.name, '\n    ', f.detail);
  process.exit(1);
}
console.log('\x1b[32m✓ نجحت كل الاختبارات — ' + pass + ' تأكيداً\x1b[0m');
