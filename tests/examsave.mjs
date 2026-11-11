/**
 * Examination save — a partial save must never look like a full one, must keep
 * the draft, and a retry must finish the SAME exam without duplicating
 * anything. Fake network; no database.
 * Run: npm run examsave
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const dir = path.dirname(fileURLToPath(import.meta.url));
const bundle = fs.readFileSync(path.join(dir, 'dist-examsave/examsave.js'), 'utf8');

let pass = 0;
const failures = [];
const ok = (name, cond, detail) => (cond ? pass++ : failures.push({ name, detail }));
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const h = (t) => console.log('\n\x1b[1m' + t + '\x1b[0m');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(15);
  }
  return !!fn();
};

const PID = '11111111-1111-4111-8111-111111111111';
const VID = '22222222-2222-4222-8222-222222222222';
const EXAM_ID = '33333333-3333-4333-8333-333333333333';

function makePage(storage = {}) {
  const dom = new JSDOM('<!doctype html><html lang="ar" dir="rtl"><body><div id="root"></div></body></html>', {
    url: 'https://drsakr86-hash.github.io/iapp/app/doctor',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.matchMedia ??= () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  window.MessageChannel ??= MessageChannel;
  for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);

  /* A tiny stateful fake of the tables the exam touches. */
  const net = {
    log: [], // {table, method, body}
    fail: {}, // table -> 'insert' | 'select' | true
    rows: { examinations: [], iop_measurements: [], refractions: [], diagnoses: [], follow_ups: [], exam_findings: [] },
  };
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const boom = () => json({ code: 'XX000', message: 'simulated failure', details: null, hint: null }, 500);
  window.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    const table = u.pathname.split('/').pop();
    const body = init.body ? JSON.parse(String(init.body)) : null;
    net.log.push({ table, method, body, query: u.search });
    if (!(table in net.rows)) return json([]);
    const f = net.fail[table];
    if (method === 'POST') {
      if (f === true || f === 'insert') return boom();
      const list = Array.isArray(body) ? body : [body];
      const made = list.map((r) => ({ id: table === 'examinations' ? EXAM_ID : 'r' + net.rows[table].length + Math.random(), deleted_at: null, ...r }));
      net.rows[table].push(...made);
      return table === 'examinations' ? json(made[0], 201) : json(null, 201);
    }
    if (method === 'GET') {
      if (f === true || f === 'select') return boom();
      const examFilter = u.searchParams.get('examination_id');
      const ids = examFilter ? examFilter.replace(/^eq\./, '').replace(/^in\.\(/, '').replace(/\)$/, '').split(',').map((x) => x.replace(/"/g, '')) : null;
      return json(net.rows[table].filter((r) => !ids || ids.includes(r.examination_id)));
    }
    return json([]); // PATCH (findings soft-delete)
  };
  window.eval(bundle);
  return { window, net, api: window.__iappExam, root: window.document.getElementById('root') };
}

const count = (p, table, method = 'POST') => p.net.log.filter((r) => r.table === table && r.method === method).length;

const data = () => ({
  patient_id: PID,
  visit_id: VID,
  exam_date: '2026-11-11',
  chief_complaint: 'ضعف نظر',
  va_right: '6/12', va_left: '6/9', va_right_corrected: '6/6', va_left_corrected: '6/6',
  iop_right: '15', iop_left: '16', iop_method: 'Goldmann',
  ref_od_sph: '-1.00', ref_os_sph: '-0.75',
  anterior_segment: 'طبيعي', posterior_segment: 'طبيعي',
  treatment_plan: 'متابعة',
  diagnosis_text: 'قصر نظر', diagnosis_eye: 'OU',
  follow_up_date: '2026-12-11', follow_up_reason: 'متابعة',
  findings: [],
});

/* ------------------------------------------------------------ service */
h('1. الخدمة — حفظ كامل');
{
  const p = makePage();
  const r = await p.api.svc.createFull(data());
  eq('لا تحذيرات ولا أجزاء فاشلة', [r.warnings.length, r.failed.length], [0, 0]);
  eq('فحص واحد + قياسا ضغط + انكساران + تشخيص + متابعة',
    ['examinations', 'iop_measurements', 'refractions', 'diagnoses', 'follow_ups'].map((t) => p.net.rows[t].length), [1, 2, 2, 1, 1]);
  eq('لا استعلامات تحقق إضافية في الحفظ الأول', count(p, 'iop_measurements', 'GET'), 0);
  p.window.close();
}

h('2. الخدمة — فشل الضغط والتشخيص ثم إعادة المحاولة');
{
  const p = makePage();
  p.net.fail = { iop_measurements: 'insert', diagnoses: 'insert' };
  const r = await p.api.svc.createFull(data());
  eq('الأجزاء الفاشلة محدّدة', r.failed.slice().sort(), ['diagnosis', 'iop']);
  eq('تحذيران', r.warnings.length, 2);
  eq('الباقي حُفظ', [p.net.rows.refractions.length, p.net.rows.follow_ups.length], [2, 1]);

  p.net.fail = {};
  const r2 = await p.api.svc.retryParts(EXAM_ID, data(), r.failed);
  eq('إعادة المحاولة تُكمل', r2.failed, []);
  eq('لا فحص ثانٍ', p.net.rows.examinations.length, 1);
  eq('لا تكرار للانكسار أو المتابعة', [p.net.rows.refractions.length, p.net.rows.follow_ups.length], [2, 1]);
  eq('ضغط وتشخيص محفوظان الآن على نفس الفحص',
    [p.net.rows.iop_measurements.length, p.net.rows.diagnoses.length, p.net.rows.iop_measurements.every((x) => x.examination_id === EXAM_ID)], [2, 1, true]);

  // pressing retry again (e.g. the first response was lost) must not duplicate
  const r3 = await p.api.svc.retryParts(EXAM_ID, data(), ['iop', 'diagnosis', 'refraction', 'follow_up']);
  eq('إعادة ثانية لا تكرر شيئًا', [r3.failed.length, p.net.rows.iop_measurements.length, p.net.rows.diagnoses.length, p.net.rows.refractions.length, p.net.rows.follow_ups.length], [0, 2, 1, 2, 1]);
  p.window.close();
}

h('3. الخدمة — عين واحدة محفوظة، وتعذّر التحقق');
{
  const p = makePage();
  p.net.rows.iop_measurements.push({ id: 'x', examination_id: EXAM_ID, eye: 'OD', value_mmhg: 15, deleted_at: null });
  const r = await p.api.svc.retryParts(EXAM_ID, data(), ['iop']);
  eq('تُضاف العين الناقصة فقط', [r.failed.length, p.net.rows.iop_measurements.map((x) => x.eye).sort()], [0, ['OD', 'OS']]);

  p.net.fail = { iop_measurements: 'select' };
  const before = p.net.rows.iop_measurements.length;
  const r2 = await p.api.svc.retryParts(EXAM_ID, data(), ['iop']);
  eq('تعذّر معرفة المحفوظ → فشل بلا إدراج أعمى', [r2.failed, p.net.rows.iop_measurements.length], [['iop'], before]);
  p.window.close();
}

h('4. الخدمة — قراءة الضغط الفاشلة لا تبدو «غير مسجَّل»');
{
  const p = makePage();
  p.net.rows.examinations.push({ id: EXAM_ID, patient_id: PID, exam_date: '2026-11-11', deleted_at: null });
  p.net.fail = { iop_measurements: 'select' };
  const list = await p.api.svc.listByPatient(PID);
  eq('علامة تعذّر التحميل', [list.length, list[0]._iop_unavailable, list[0]._iop_od], [1, true, null]);
  p.net.fail = {};
  p.net.rows.iop_measurements.push(
    { examination_id: EXAM_ID, eye: 'OD', value_mmhg: 14, measured_at: '2026-11-11T09:00:00Z', deleted_at: null },
    { examination_id: EXAM_ID, eye: 'OD', value_mmhg: 22, measured_at: '2026-11-11T11:00:00Z', deleted_at: null },
  );
  const l2 = await p.api.svc.listByPatient(PID);
  eq('الأحدث لكل عين، وبلا علامة خطأ', [l2[0]._iop_od.value_mmhg, l2[0]._iop_unavailable], [22, false]);
  const q = p.net.log.filter((r) => r.table === 'iop_measurements' && r.method === 'GET').pop();
  ok('الاستعلام يستبعد المحذوف (deleted_at=is.null)', /deleted_at=is\.null/.test(q.query), q.query);
  p.window.close();
}

/* --------------------------------------------------------------- form */
h('5. النموذج — حفظ جزئي لا يُغلق ولا يمسح المسودة، وإعادة المحاولة تُكمل');
{
  const d = data();
  const f = {};
  for (const [k, v] of Object.entries(d)) if (typeof v === 'string' && !['patient_id', 'visit_id'].includes(k)) f[k] = v;
  const findings = { lids: { OD: 'طبيعية', OS: 'طبيعية' }, disc: { OD: 'طبيعي', OS: 'طبيعي' } };
  const boot = makePage();
  const key = boot.api.store.draftKey(null, 'exam', PID, VID);
  boot.window.close();

  const p = makePage({ [key]: JSON.stringify({ v: { f: { ...f, iop_time: '', ref_od_cyl: '', ref_od_axis: '', ref_od_add: '', ref_os_cyl: '', ref_os_axis: '', ref_os_add: '', va_right_ph: '', va_left_ph: '', color_vision: '', contrast_sensitivity: '', cover_test: '', notes: '' }, findings }, t: Date.now() }) });
  const cb = { saved: 0, closed: 0 };
  let root = p.api.mount(p.root, PID, VID, cb);
  const btn = (re) => [...p.window.document.querySelectorAll('button')].find((b) => re.test(b.textContent || ''));
  ok('النموذج ظهر بزر «حفظ الفحص»', await waitFor(() => btn(/^حفظ الفحص$/)));

  p.net.fail = { iop_measurements: 'insert' };
  btn(/^حفظ الفحص$/).click();
  ok('يظهر تنبيه ثابت بما لم يُحفظ', await waitFor(() => /الفحص حُفظ، لكن هذه الأجزاء لم تُحفظ/.test(p.window.document.body.textContent)), p.window.document.body.textContent.slice(-400));
  ok('يذكر ضغط العين', /ضغط العين لم يُحفظ/.test(p.window.document.body.textContent));
  eq('النموذج لم يُغلق', [cb.saved, cb.closed], [0, 0]);
  ok('الزر صار «إعادة حفظ الأجزاء الناقصة»', !!btn(/إعادة حفظ الأجزاء الناقصة/) && !btn(/^حفظ الفحص$/));
  ok('لا يُعرض «ابدأ من جديد» أثناء النقص', !btn(/ابدأ من جديد|تجاهل|حذف المسودة/));
  eq('فحص واحد أُنشئ', count(p, 'examinations'), 1);

  // close and reopen inside the debounce window: the pending state must survive
  root.unmount();
  const saved = JSON.parse(p.window.localStorage.getItem(key) || 'null');
  eq('المسودة باقية ومعها علامة النقص', [saved?.v?.partial?.examId, saved?.v?.partial?.failed], [EXAM_ID, ['iop']]);
  eq('وقيم الضغط المكتوبة باقية', [saved?.v?.f?.iop_right, saved?.v?.f?.iop_left], ['15', '16']);

  root = p.api.mount(p.root, PID, VID, cb);
  ok('بعد إعادة الفتح: ما زال في وضع الإكمال', await waitFor(() => btn(/إعادة حفظ الأجزاء الناقصة/)));

  p.net.fail = {};
  btn(/إعادة حفظ الأجزاء الناقصة/).click();
  ok('يُغلق بعد اكتمال الحفظ', await waitFor(() => cb.saved === 1));
  eq('لم يُنشأ فحص ثانٍ', [count(p, 'examinations'), p.net.rows.examinations.length], [1, 1]);
  eq('الضغط محفوظ مرة واحدة لكل عين', p.net.rows.iop_measurements.map((x) => x.eye).sort(), ['OD', 'OS']);
  eq('الانكسار والتشخيص والمتابعة بلا تكرار', [p.net.rows.refractions.length, p.net.rows.diagnoses.length, p.net.rows.follow_ups.length], [2, 1, 1]);
  eq('المسودة مُسحت بعد الاكتمال', p.window.localStorage.getItem(key), null);
  p.window.close();
}

h('6. النموذج — حفظ كامل يُغلق مباشرة');
{
  const d = data();
  const f = {};
  for (const [k, v] of Object.entries(d)) if (typeof v === 'string' && !['patient_id', 'visit_id'].includes(k)) f[k] = v;
  const boot = makePage();
  const key = boot.api.store.draftKey(null, 'exam', PID, VID);
  boot.window.close();
  const p = makePage({ [key]: JSON.stringify({ v: { f, findings: { lids: { OD: 'طبيعية', OS: 'طبيعية' }, disc: { OD: 'طبيعي', OS: 'طبيعي' } } }, t: Date.now() }) });
  const cb = { saved: 0, closed: 0 };
  p.api.mount(p.root, PID, VID, cb);
  const btn = (re) => [...p.window.document.querySelectorAll('button')].find((b) => re.test(b.textContent || ''));
  await waitFor(() => btn(/^حفظ الفحص$/));
  btn(/^حفظ الفحص$/).click();
  ok('أُغلق', await waitFor(() => cb.saved === 1));
  ok('بلا تنبيه نقص', !/لم تُحفظ/.test(p.window.document.body.textContent));
  eq('المسودة مُسحت', p.window.localStorage.getItem(key), null);
  p.window.close();
}

console.log(`\n${pass} passed, ${failures.length} failed`);
for (const x of failures) console.log('  ✗', x.name, '—', typeof x.detail === 'string' ? x.detail : JSON.stringify(x.detail ?? ''));
process.exit(failures.length ? 1 : 0);
