/**
 * Waiting-room screen + patient calling — pure logic, announcer, view and the
 * full page against a fake network. No database (see tests/db/queue_display.sh
 * for the database side).
 * Run: npm run display
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const dir = path.dirname(fileURLToPath(import.meta.url));
const bundle = fs.readFileSync(path.join(dir, 'dist-display/display.js'), 'utf8');

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
    await sleep(20);
  }
  return !!fn();
};

const TOKEN = 'ab'.repeat(32);
const BASE = 'https://drsakr86-hash.github.io/iapp/app/display';

/** A fresh jsdom page with a scriptable fake network, speech and audio. */
function makePage({ url = `${BASE}?t=${TOKEN}`, storage = {}, session = {}, speech = true } = {}) {
  const dom = new JSDOM('<!doctype html><html lang="ar" dir="rtl"><body><div id="root"></div></body></html>', {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.matchMedia ??= () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);
  for (const [k, v] of Object.entries(session)) window.sessionStorage.setItem(k, v);

  const net = {
    requests: [],
    mode: 'ok', // ok | down | invalid | hang
    snapshot: null,
    transitions: [],
    rpc: {},
  };
  window.fetch = async (input, init = {}) => {
    const u = typeof input === 'string' ? input : input.url;
    const headers = Object.fromEntries(new Headers(init.headers || (typeof input !== 'string' ? input.headers : {})).entries());
    const body = init.body ? String(init.body) : null;
    net.requests.push({ url: u, method: init.method || 'GET', headers, body });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (u.includes('/rpc/display_queue')) {
      if (net.mode === 'down') throw new TypeError('Failed to fetch');
      if (net.mode === 'hang') return new Promise(() => {});
      if (net.mode === 'invalid') return json({ code: '28000', message: 'invalid_display_token', details: null, hint: null }, 400);
      return json(net.snapshot);
    }
    if (u.includes('/appointment_transitions')) return json(net.transitions);
    const m = u.match(/\/rpc\/(call_next_patient|recall_patient)/);
    if (m) {
      const r = net.rpc[m[1]];
      return r ? json(r.body, r.status ?? 200) : json([], 200);
    }
    return json([], 200);
  };

  const spoken = [];
  const audio = { created: 0, oscillators: 0 };
  if (speech) {
    window.SpeechSynthesisUtterance = class {
      constructor(t) { this.text = t; }
    };
    window.speechSynthesis = {
      getVoices: () => [{ lang: 'ar-EG', name: 'Arabic' }],
      speak(u) { spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 5); },
    };
  }
  window.AudioContext = class {
    constructor() { audio.created++; this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    resume() { return Promise.resolve(); }
    createOscillator() { audio.oscillators++; return { frequency: {}, connect: (x) => ({ connect() {} }), start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect() {} }) }; }
  };
  window.MessageChannel ??= MessageChannel; // React's scheduler
  window.eval(bundle);
  return { dom, window, net, spoken, audio, api: window.__iappDisplay, doc: window.document, root: window.document.getElementById('root') };
}

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
function snap({ calls = [], waiting = [], showNames = false, latest } = {}) {
  return {
    server_time: iso(),
    clinic_name: 'عيادة صقر',
    day: '2026-10-14',
    show_names: showNames,
    latest_call_id: latest ?? calls.reduce((m, c) => Math.max(m, c.call_id), 0),
    current: calls,
    waiting,
    waiting_count: waiting.length,
  };
}
const call = (id, ticket, extra = {}) => ({ call_id: id, kind: 'call', ticket_no: ticket, name: null, doctor: 'د. عبدو', room: '1', called_at: iso(-1000), ...extra });
const wait = (ticket, extra = {}) => ({ ticket_no: ticket, name: null, doctor: 'د. عبدو', wait_minutes: 5, ...extra });

/* ---------------------------------------------------------------- 1. logic */
{
  const p = makePage();
  const { qd, filters } = p.api;

  h('1. المنطق — القائمة البيضاء للخصوصية');
  const leaky = {
    server_time: iso(), clinic_name: 'ع', day: '2026-10-14', show_names: false, latest_call_id: 3,
    phone: '01012345678', national_id: '29001011234567', diagnosis: 'glaucoma',
    current: [{ call_id: 3, kind: 'call', ticket_no: 2, name: 'أحمد علي محمود', doctor: 'د', room: '1', called_at: iso(), phone: '0100', diagnosis: 'x', national_id: '1' }],
    waiting: [{ ticket_no: 4, name: 'سارة', doctor: 'د', wait_minutes: 3, phone: '0111', national_id: '2', notes: 'سري' }],
    waiting_count: 1,
  };
  const s = qd.parseSnapshot(leaky);
  const dump = JSON.stringify(s);
  ok('لا هاتف/هوية/تشخيص في الناتج', !/0100|0111|0101234|2900101|glaucoma|diagnosis|national|phone|سري/.test(dump), dump);
  eq('الأسماء تُحذف عند show_names=false', [s.current[0].name, s.waiting[0].name], [null, null]);
  const s2 = qd.parseSnapshot({ ...leaky, show_names: true });
  eq('الأسماء تظهر عند show_names=true', [s2.current[0].name, s2.waiting[0].name], ['أحمد علي محمود', 'سارة']);
  eq('غير snapshot → null', [qd.parseSnapshot(null), qd.parseSnapshot('x'), qd.parseSnapshot([]), qd.parseSnapshot({})], [null, null, null, null]);
  eq('صف بلا رقم يُتجاهل', qd.parseSnapshot({ server_time: iso(), current: [{ call_id: 1 }], waiting: [{}] }).current.length, 0);

  h('2. المنطق — النداء يُعلن مرة واحدة');
  const a = qd.parseSnapshot(snap({ calls: [call(5, 1)] }));
  eq('أول لقطة بعد التحميل: لا إعلان', qd.newAnnouncements(a, null).length, 0);
  eq('نداء جديد (id أكبر) يُعلن', qd.newAnnouncements(a, 4).map((c) => c.call_id), [5]);
  eq('نفس الـid لا يُعلن ثانية', qd.newAnnouncements(a, 5).length, 0);
  const two = qd.parseSnapshot(snap({ calls: [call(8, 3), call(7, 2)] }));
  eq('نداءان في استعلام واحد بالترتيب', qd.newAnnouncements(two, 6).map((c) => c.call_id), [7, 8]);
  const old = qd.parseSnapshot(snap({ calls: [call(9, 4, { called_at: iso(-600000) })] }));
  eq('نداء أقدم من 90 ث (بوقت الخادم) يُتجاهل', qd.newAnnouncements(old, 8).length, 0);
  eq('highestCallId', qd.highestCallId(qd.parseSnapshot(snap({ calls: [call(3, 1)], latest: 11 }))), 11);

  h('3. المنطق — النص المنطوق والاتصال');
  eq('رقم + غرفة + طبيب', qd.speechText(call(1, 7)), 'رقم 7، تفضّل بالدخول إلى غرفة 1 عند د. عبدو');
  eq('مع اسم', qd.speechText(call(1, 7, { name: 'أحمد' })), 'أحمد، رقم 7، تفضّل بالدخول إلى غرفة 1 عند د. عبدو');
  ok('نداء مكرر يُذكر', qd.speechText(call(1, 7, { kind: 'recall' })).startsWith('نداء مكرر'));
  eq('بلا غرفة ولا طبيب', qd.speechText(call(1, 7, { room: null, doctor: null })), 'رقم 7، تفضّل بالدخول');
  eq('roomLabel', [qd.roomLabel('1'), qd.roomLabel('٣'), qd.roomLabel('غرفة الفحص'), qd.roomLabel(null)], ['غرفة 1', 'غرفة ٣', 'غرفة الفحص', null]);
  eq('waitLabel', [qd.waitLabel(null), qd.waitLabel(0), qd.waitLabel(12), qd.waitLabel(75)], ['', '', '12 د', '1 س 15 د']);
  const now = 1_000_000;
  eq('connected', qd.connectionState({ invalid: false, lastOkMs: now - 1000, nowMs: now, failures: 0 }), 'connected');
  eq('reconnecting', qd.connectionState({ invalid: false, lastOkMs: now - 5000, nowMs: now, failures: 2 }), 'reconnecting');
  eq('offline', qd.connectionState({ invalid: false, lastOkMs: now - 60000, nowMs: now, failures: 5 }), 'offline');
  eq('offline قبل أول نجاح', qd.connectionState({ invalid: false, lastOkMs: null, nowMs: now, failures: 1 }), 'offline');
  eq('invalid يغلب', qd.connectionState({ invalid: true, lastOkMs: now, nowMs: now, failures: 0 }), 'invalid');
  eq('nextPollDelay', [0, 1, 2, 3, 9].map((f) => qd.nextPollDelay(f)), [3000, 6000, 12000, 15000, 15000]);
  eq('nextPollDelay قاعدة مخصّصة', qd.nextPollDelay(0, 100), 100);

  h('4. الأولوية — نفس ترتيب «التالي»');
  const rows = [
    { id: 'a', status: 'WAITING', scheduled_time: '10:30:00', wait_minutes: 5 },
    { id: 'b', status: 'ARRIVED', scheduled_time: '10:00:00', wait_minutes: 20 },
    { id: 'c', status: 'WAITING', scheduled_time: '09:00:00', wait_minutes: 20 },
    { id: 'd', status: 'IN_CLINIC', scheduled_time: '08:00:00', wait_minutes: 50 },
    { id: 'e', status: 'CONFIRMED', scheduled_time: '07:00:00', wait_minutes: null },
    { id: 'f', status: 'WAITING', scheduled_time: null, wait_minutes: null },
  ];
  const ordered = filters.orderWaitingQueue(rows).map((r) => r.id);
  eq('الأطول انتظارًا ثم الأبكر موعدًا', ordered, ['c', 'b', 'a', 'f']);
  eq('الأول = pickNextInQueue', ordered[0], filters.pickNextInQueue(rows).id);
  p.window.close();
}

/* ------------------------------------------------------------- 2. announcer */
{
  h('5. المُعلِن الصوتي');
  const mk = (speech = true, ctx = true) => {
    const log = { spoken: [], osc: 0 };
    const Utt = class { constructor(t) { this.text = t; } };
    const sp = { getVoices: () => [{ lang: 'en-US' }, { lang: 'ar-SA' }], speak(u) { log.spoken.push({ t: u.text, lang: u.lang }); setTimeout(() => u.onend && u.onend(), 2); } };
    const Ctx = class {
      constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; }
      resume() { this.state = 'running'; return Promise.resolve(); }
      createOscillator() { log.osc++; return { frequency: {}, connect: () => ({ connect() {} }), start() {}, stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect() {} }) }; }
    };
    const p = makePage();
    return { log, an: p.api.announce.createAnnouncer({ speech: speech ? sp : null, Utterance: speech ? Utt : null, AudioContext: ctx ? Ctx : null }), p };
  };
  const { an, log, p } = mk();
  await an.say('قبل التفعيل');
  eq('لا صوت قبل التفعيل (بوابة المتصفح)', log.spoken.length, 0);
  eq('enable يرجع true', await an.enable(), true);
  await an.say('رقم 1');
  eq('بعد التفعيل: نطق + نغمة', [log.spoken.length, log.osc], [1, 2]);
  eq('صوت عربي مُختار', log.spoken[0].lang, 'ar-SA');
  await Promise.all([an.say('أ'), an.say('ب')]);
  eq('النداءات تُنطق بالتتابع بالترتيب', log.spoken.slice(1).map((x) => x.t), ['أ', 'ب']);
  await an.test();
  ok('زر الاختبار ينطق', log.spoken.length === 4);
  p.window.close();

  const ns = mk(false, false);
  eq('بدون دعم: support', ns.an.support, { speech: false, chime: false });
  await ns.an.enable();
  let threw = false;
  try { await ns.an.say('x'); } catch { threw = true; }
  ok('بدون دعم لا استثناء (النداء المرئي يستمر)', !threw);
  ns.p.window.close();
}

/* ------------------------------------------------------------------ 3. view */
{
  h('6. العرض (RTL / خصوصية)');
  const p = makePage();
  const { qd } = p.api;
  const base = {
    connection: 'connected', lastUpdate: '10:00:00', alertCall: null, soundEnabled: false, speechSupported: true,
    clock: '10:00:00', idle: false, canFullscreen: true, onEnableSound() {}, onTestSound() {}, onReplay() {}, onFullscreen() {},
  };
  const waiting = Array.from({ length: 15 }, (_, i) => wait(i + 3));
  const html = p.api.renderView({ ...base, snapshot: qd.parseSnapshot(snap({ calls: [call(4, 2)], waiting })) });
  ok('RTL + عربي', /dir="rtl"/.test(html) && /lang="ar"/.test(html));
  ok('النداء الحالي كبير بالرقم', /display__now-number">2</.test(html));
  ok('الغرفة والطبيب', html.includes('غرفة 1') && html.includes('د. عبدو'));
  ok('عدد الانتظار', html.includes('(15)'));
  ok('حد 12 + «آخرون»', (html.match(/display__item"/g) || []).length === 12 && html.includes('+ 3 آخرون'));
  ok('اسم غير ظاهر بالافتراضي', !/display__now-name/.test(html));
  const named = p.api.renderView({ ...base, snapshot: qd.parseSnapshot(snap({ calls: [call(4, 2, { name: 'أحمد' })], showNames: true })) });
  ok('الاسم الأول يظهر عند التفعيل', /display__now-name">أحمد</.test(named));
  ok('زر تفعيل الصوت قبل التفعيل', html.includes('تفعيل الصوت'));
  const off = p.api.renderView({ ...base, connection: 'offline', snapshot: qd.parseSnapshot(snap()) });
  ok('إشعار انقطاع الاتصال + آخر تحديث', off.includes('role="alert"') && off.includes('10:00:00') && off.includes('غير متصل'));
  const nospeech = p.api.renderView({ ...base, speechSupported: false, snapshot: qd.parseSnapshot(snap()) });
  ok('تنبيه عدم دعم النطق', nospeech.includes('النطق الصوتي غير مدعوم'));
  const inv = p.api.renderView({ ...base, connection: 'invalid', snapshot: null });
  ok('شاشة غير مسجّلة', inv.includes('غير مسجّلة'));
  const alert = p.api.renderView({ ...base, alertCall: call(9, 5), snapshot: qd.parseSnapshot(snap({ calls: [call(9, 5)] })) });
  ok('تنبيه بصري لنداء جديد', alert.includes('نداء جديد') && alert.includes('display__now--alert'));
  p.window.close();
}

/* ------------------------------------------------------------------- 4. page */
const POLL = 120;
const mount = (p) => p.api.mount(p.root, { pollBaseMs: POLL });
const text = (p) => p.root.textContent || '';
const rpcCount = (p) => p.net.requests.filter((r) => r.url.includes('/rpc/display_queue')).length;

h('7. الصفحة — لا رمز: لا طلبات');
{
  const p = makePage({ url: BASE });
  mount(p);
  await sleep(500);
  ok('شاشة «غير مسجّلة»', text(p).includes('غير مسجّلة'));
  eq('صفر طلبات شبكة', p.net.requests.length, 0);
  p.window.close();
}

h('8. الصفحة — التحميل الأول، التحديث، الإعلان مرة واحدة');
{
  const p = makePage();
  p.net.snapshot = snap({ calls: [call(5, 1)], waiting: [wait(2), wait(3)] });
  mount(p);
  ok('تظهر القائمة', await waitFor(() => text(p).includes('عيادة صقر')));
  ok('الرمز أُزيل من الرابط', !p.window.location.href.includes(TOKEN) && !p.window.location.search.includes('t='), p.window.location.href);
  eq('الرمز حُفظ على الجهاز', p.window.localStorage.getItem('iapp:display-token'), TOKEN);
  const req = p.net.requests.find((r) => r.url.includes('/rpc/display_queue'));
  eq('POST إلى display_queue', req.method, 'POST');
  eq('الجسم: الرمز فقط', JSON.parse(req.body), { p_token: TOKEN });
  eq('Content-Profile: public', req.headers['content-profile'], 'public');
  ok('مفتاح عام فقط ولا جلسة مستخدم', !!req.headers.apikey && !/service_role|sb_secret/.test(JSON.stringify(req.headers)));
  await p.api.queueSvc; // no-op: keeps bundle referenced
  await sleep(POLL * 3);
  ok('تحديث تلقائي (عدة استطلاعات)', rpcCount(p) >= 3, String(rpcCount(p)));
  p.window.document.querySelector('button.display__btn--primary')?.click();
  await sleep(100);
  eq('أول لقطة بلا نطق (حتى مع نداء قائم)', p.spoken.length, 0);

  // new call arrives
  p.net.snapshot = snap({ calls: [call(6, 2), call(5, 1)], waiting: [wait(3)] });
  ok('نداء جديد يُنطق', await waitFor(() => p.spoken.length === 1));
  ok('النص: رقم 2 + غرفة + طبيب', p.spoken[0] === 'رقم 2، تفضّل بالدخول إلى غرفة 1 عند د. عبدو', p.spoken[0]);
  ok('تنبيه بصري ظهر', await waitFor(() => text(p).includes('نداء جديد')));
  await sleep(POLL * 5);
  eq('لا تكرار مع استمرار الاستطلاع', p.spoken.length, 1);

  // recall = new event id
  p.net.snapshot = snap({ calls: [call(7, 2, { kind: 'recall' }), call(5, 1)], waiting: [wait(3)] });
  ok('إعادة النداء تُنطق مرة', await waitFor(() => p.spoken.length === 2));
  ok('تحمل «نداء مكرر»', p.spoken[1].startsWith('نداء مكرر'), p.spoken[1]);
  await sleep(POLL * 4);
  eq('لا تكرار بعد إعادة النداء', p.spoken.length, 2);

  // reload: same sessionStorage, new page
  const session = {};
  for (let i = 0; i < p.window.sessionStorage.length; i++) { const k = p.window.sessionStorage.key(i); session[k] = p.window.sessionStorage.getItem(k); }
  const storage = { 'iapp:display-token': TOKEN };
  p.window.close();
  const r = makePage({ url: BASE, storage, session });
  r.net.snapshot = snap({ calls: [call(7, 2, { kind: 'recall' }), call(5, 1)], waiting: [wait(3)] });
  mount(r);
  await waitFor(() => text(r).includes('عيادة صقر'));
  r.window.document.querySelector('button.display__btn--primary')?.click();
  await sleep(POLL * 4);
  eq('إعادة تحميل الصفحة لا تعيد النطق', r.spoken.length, 0);
  ok('الرمز المخزَّن يكفي بعد التحميل', rpcCount(r) >= 1);
  r.window.close();
}

h('9. الصفحة — نداء قديم ولقطة فيها تسريب');
{
  const p = makePage();
  p.net.snapshot = snap({ calls: [call(5, 1)] });
  mount(p);
  await waitFor(() => text(p).includes('عيادة صقر'));
  p.window.document.querySelector('button.display__btn--primary')?.click();
  await sleep(100);
  p.net.snapshot = snap({ calls: [call(6, 2, { called_at: iso(-10 * 60000) })] });
  await sleep(POLL * 4);
  eq('نداء عمره 10 دقائق لا يُنطق', p.spoken.length, 0);
  const leaky = snap({ calls: [call(7, 3)], waiting: [wait(4, { phone: '01099998888', national_id: '29001011234567' })] });
  leaky.phone = '01011112222';
  leaky.current[0].diagnosis = 'glaucoma';
  p.net.snapshot = leaky;
  await sleep(POLL * 4);
  const html = p.root.innerHTML;
  ok('لا حقل غير مسموح يصل إلى الـDOM', !/0109999|0101111|2900101|glaucoma/.test(html), 'leak');
  p.window.close();
}

h('10. الصفحة — انقطاع الاتصال ثم العودة');
{
  const p = makePage();
  p.net.snapshot = snap({ calls: [call(5, 1)], waiting: [wait(2)] });
  mount(p);
  await waitFor(() => text(p).includes('متصل'));
  p.window.document.querySelector('button.display__btn--primary')?.click();
  await sleep(100);
  p.net.mode = 'down';
  ok('تظهر حالة انقطاع', await waitFor(() => /جارٍ إعادة الاتصال|غير متصل/.test(text(p)), 6000));
  ok('القائمة الأخيرة تبقى ظاهرة', text(p).includes('عيادة صقر'));
  const during = rpcCount(p);
  await sleep(POLL * 6);
  ok('يعيد المحاولة مع تباعد (لا إغراق)', rpcCount(p) - during <= 6, String(rpcCount(p) - during));
  ok('إشعار الانقطاع بعد المهلة', await waitFor(() => p.root.querySelector('[role="alert"]'), 6000));
  p.net.snapshot = snap({ calls: [call(6, 2)], waiting: [wait(3)] });
  p.net.mode = 'ok';
  ok('يعود تلقائيًا', await waitFor(() => /متصل/.test(text(p)) && !/جارٍ إعادة الاتصال/.test(text(p)), 8000));
  ok('النداء الذي فات أثناء الانقطاع يُنطق مرة', await waitFor(() => p.spoken.length === 1, 3000));
  p.window.close();
}

h('11. الصفحة — رمز ملغى');
{
  const p = makePage();
  p.net.mode = 'invalid';
  mount(p);
  ok('تظهر «غير مسجّلة»', await waitFor(() => text(p).includes('غير مسجّلة')));
  const n = rpcCount(p);
  await sleep(POLL * 6);
  eq('يتوقف عن الاستطلاع', rpcCount(p), n);
  eq('الرمز المخزَّن يُمسح', p.window.localStorage.getItem('iapp:display-token'), null);
  p.window.close();
}

h('12. الصفحة — بدون دعم النطق');
{
  const p = makePage({ speech: false });
  p.net.snapshot = snap({ calls: [call(5, 1)] });
  mount(p);
  await waitFor(() => text(p).includes('عيادة صقر'));
  ok('تنبيه عدم الدعم', text(p).includes('غير مدعوم'));
  p.net.snapshot = snap({ calls: [call(6, 2)] });
  ok('النداء المرئي يعمل', await waitFor(() => text(p).includes('نداء جديد')));
  p.window.close();
}

/* --------------------------------------------------------- 5. staff service */
h('13. خدمة النداء (للموظفين)');
{
  const p = makePage();
  const q = p.api.queueSvc;
  const tr = (to, roles) => ({ from_status: 'WAITING', to_status: 'IN_CLINIC', allowed_roles: roles });
  p.net.transitions = [tr(0, ['doctor', 'admin']), { from_status: 'ARRIVED', to_status: 'WAITING', allowed_roles: ['secretary'] }];
  eq('الطبيب يستطيع النداء', await q.canCall('doctor'), true);
  eq('السكرتارية لا (حسب جدول الانتقالات)', await q.canCall('secretary'), false);
  p.net.transitions = [tr(0, '{doctor,admin,secretary}')];
  eq('الصيغة النصية {a,b} تُقرأ', await q.canCall('secretary'), true);
  eq('دور مجهول', await q.canCall('x'), false);
  p.net.transitions = [{ from_status: 'WAITING', to_status: 'IN_CLINIC', allowed_roles: ['secretary'] }];
  const failing = makePage();
  failing.window.fetch = async () => { throw new TypeError('Failed to fetch'); };
  eq('فشل قراءة القواعد → لا نداء (آمن)', await failing.api.queueSvc.canCall('doctor'), false);

  const id1 = q.newRequestId();
  ok('request id بصيغة UUID', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id1) && id1 !== q.newRequestId());

  const row = { call_id: 12, appointment_id: 'ap-1', kind: 'call', room: '2', called_at: iso(), deduped: false };
  p.net.rpc.call_next_patient = { body: [row] };
  const r = await q.callNext({ clinicId: 'cl-1', doctorId: 'dr-1', room: '2', requestId: id1 });
  eq('نتيجة callNext', [r.callId, r.appointmentId, r.kind, r.deduped], [12, 'ap-1', 'call', false]);
  const req = p.net.requests.find((x) => x.url.includes('/rpc/call_next_patient'));
  eq('جسم الطلب يحمل request id', [JSON.parse(req.body).p_request_id, JSON.parse(req.body).p_clinic_id], [id1, 'cl-1']);

  p.net.rpc.call_next_patient = { status: 400, body: { code: 'P0002', message: 'queue_empty', details: null, hint: null } };
  let msg = '';
  try { await q.callNext({ clinicId: 'cl-1', requestId: q.newRequestId() }); } catch (e) { msg = e.message; }
  ok('queue_empty بالعربية', msg.includes('لا يوجد مرضى في الانتظار'), msg);

  p.net.rpc.recall_patient = { body: [{ ...row, kind: 'recall' }] };
  const rc = await q.recall('ap-1', q.newRequestId());
  eq('recall', rc.kind, 'recall');
  p.net.rpc.recall_patient = { status: 400, body: { code: 'P0001', message: 'not_called', details: null, hint: null } };
  msg = '';
  try { await q.recall('ap-2', q.newRequestId()); } catch (e) { msg = e.message; }
  ok('not_called بالعربية', msg.length > 0 && !/not_called/.test(msg), msg);
  p.window.close();
  failing.window.close();
}

console.log(`\n${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log('  ✗', f.name, '—', f.detail ?? '');
process.exit(failures.length ? 1 : 0);
