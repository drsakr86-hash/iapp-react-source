/**
 * Draft store: round-trip, expiry, per-user scoping, corrupt data, quota
 * failure, wipe on sign-out, Arabic relative time. Pure logic.
 * Run: npm run drafts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const dir = path.dirname(fileURLToPath(import.meta.url));
const bundle = fs.readFileSync(path.join(dir, 'dist-drafts/drafts.js'), 'utf8');

let pass = 0;
const failures = [];
const ok = (name, cond, detail) => (cond ? pass++ : failures.push({ name, detail }));
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const h = (t) => console.log('\x1b[1m' + t + '\x1b[0m');

const dom = new JSDOM('<!doctype html><html><body><div id="p1"></div><div id="p2"></div><div id="p3"></div><div id="t1"></div><div id="t2"></div><div id="m1"></div><div id="x1"></div></body></html>', { runScripts: 'dangerously', url: 'http://localhost/' });
dom.window.eval(bundle);
const api = dom.window.__iappDrafts;
const { store } = api;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const doc = dom.window.document;
const setValue = (el, v) => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, v);
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
};

/** Minimal in-memory Storage. */
function mem() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    _m: m,
  };
}
const HOUR = 3600_000;
const NOW = 1_800_000_000_000;

h('1. حفظ واسترجاع');
{
  const s = mem();
  const k = store.draftKey('user-1', 'exam', 'p1', 'v1');
  eq('key shape', k, 'iapp:draft:user-1:exam:p1:v1');
  ok('write ok', store.writeDraft(s, k, { f: { a: '1' }, n: [1, 2] }, NOW));
  const d = store.readDraft(s, k, NOW + 5 * 60_000);
  eq('round trip value', d.v, { f: { a: '1' }, n: [1, 2] });
  eq('timestamp kept', d.t, NOW);
  eq('missing key → null', store.readDraft(s, 'nope', NOW), null);
}

h('2. انتهاء الصلاحية (12 ساعة)');
{
  const s = mem();
  const k = store.draftKey('u', 'x');
  store.writeDraft(s, k, 'v', NOW);
  ok('fresh at 11h59', store.readDraft(s, k, NOW + 11.99 * HOUR) !== null);
  eq('expired at 12h01 → null', store.readDraft(s, k, NOW + 12.02 * HOUR), null);
  eq('expired draft is removed from storage', s.getItem(k), null);
  store.writeDraft(s, k, 'v', NOW + 10 * HOUR); // timestamp in the future relative to NOW
  eq('timestamp far in the future is rejected (clock skew)', store.readDraft(s, k, NOW), null);
}

h('3. عزل المستخدمين');
{
  const s = mem();
  store.writeDraft(s, store.draftKey('doctor-A', 'exam', 'p1'), 'A-data', NOW);
  eq('other user does not see it', store.readDraft(s, store.draftKey('doctor-B', 'exam', 'p1'), NOW), null);
  eq('different patient does not see it', store.readDraft(s, store.draftKey('doctor-A', 'exam', 'p2'), NOW), null);
  ok('anon key is distinct', store.draftKey(null, 'x') !== store.draftKey('doctor-A', 'x'));
}

h('4. بيانات تالفة / تخزين غير متاح');
{
  const s = mem();
  s.setItem('iapp:draft:u:bad', '{not json');
  eq('corrupt JSON → null', store.readDraft(s, 'iapp:draft:u:bad', NOW), null);
  eq('corrupt entry removed', s.getItem('iapp:draft:u:bad'), null);
  s.setItem('iapp:draft:u:shape', JSON.stringify({ hello: 1 }));
  eq('wrong shape → null', store.readDraft(s, 'iapp:draft:u:shape', NOW), null);
  const full = { ...mem(), setItem() { throw new Error('QuotaExceededError'); } };
  eq('quota error → false, no throw', store.writeDraft(full, 'k', 1, NOW), false);
  eq('null storage: write/read/clear are safe', [store.writeDraft(null, 'k', 1, NOW), store.readDraft(null, 'k', NOW), store.clearAllDrafts(null)], [false, null, 0]);
}

h('5. المسح عند تسجيل الخروج');
{
  const s = mem();
  store.writeDraft(s, store.draftKey('a', 'exam', '1'), 1, NOW);
  store.writeDraft(s, store.draftKey('b', 'rx-med', '2'), 2, NOW);
  s.setItem('unrelated:key', 'keep me');
  s.setItem('sb-token', 'keep me too');
  eq('removed count', store.clearAllDrafts(s), 2);
  eq('only drafts removed', [...s._m.keys()].sort(), ['sb-token', 'unrelated:key']);
  const k = store.draftKey('a', 'x');
  store.writeDraft(s, k, 1, NOW);
  store.clearDraft(s, k);
  eq('clearDraft removes one', s.getItem(k), null);
}

h('6. الوقت النسبي بالعربية');
{
  const m = 60_000;
  eq('now', store.agoAr(NOW, NOW + 20_000), 'منذ لحظات');
  eq('1 min', store.agoAr(NOW, NOW + 1 * m), 'منذ دقيقة');
  eq('2 min', store.agoAr(NOW, NOW + 2 * m), 'منذ دقيقتين');
  eq('5 min', store.agoAr(NOW, NOW + 5 * m), 'منذ 5 دقائق');
  eq('30 min', store.agoAr(NOW, NOW + 30 * m), 'منذ 30 دقيقة');
  eq('1 h', store.agoAr(NOW, NOW + 60 * m), 'منذ ساعة');
  eq('2 h', store.agoAr(NOW, NOW + 120 * m), 'منذ ساعتين');
  eq('5 h', store.agoAr(NOW, NOW + 300 * m), 'منذ 5 ساعات');
  eq('11 h', store.agoAr(NOW, NOW + 660 * m), 'منذ 11 ساعة');
  eq('negative clamps', store.agoAr(NOW + 5 * m, NOW), 'منذ لحظات');
}

h('7. المسودة داخل الواجهة (hook حقيقي)');
{
  const ls = dom.window.localStorage;
  ls.clear();
  const scope = ['probe', 'p1'];
  const key = store.draftKey(null, ...scope);

  api.mountProbe('p1', scope);
  await sleep(100);
  eq('fresh form: no banner', doc.querySelector('#p1 .draftbanner'), null);
  eq('fresh form: nothing stored before typing', ls.getItem(key), null);

  setValue(doc.querySelector('#p1 #probe-input'), 'IOP 14/16');
  await sleep(150);
  eq('debounce: not stored yet at 150ms', ls.getItem(key), null);
  await sleep(600);
  const saved = JSON.parse(ls.getItem(key) ?? 'null');
  eq('stored after debounce', saved && saved.v, { text: 'IOP 14/16' });

  // "reload": mount a second instance with the same scope
  api.mountProbe('p2', scope);
  await sleep(100);
  eq('restored value shown', doc.querySelector('#p2 #probe-input').value, 'IOP 14/16');
  ok('restore banner shown', !!doc.querySelector('#p2 .draftbanner'));
  ok('banner says how old', /منذ/.test(doc.querySelector('#p2 .draftbanner').textContent));

  // another patient's form must stay clean
  api.mountProbe('p3', ['probe', 'other-patient']);
  await sleep(100);
  eq('other scope is empty', doc.querySelector('#p3 #probe-input').value, '');
  eq('other scope has no banner', doc.querySelector('#p3 .draftbanner'), null);

  // discard
  Array.from(doc.querySelectorAll('#p2 .draftbanner button'))[0].click();
  await sleep(100);
  eq('discard clears the field', doc.querySelector('#p2 #probe-input').value, '');
  eq('discard removes stored draft', ls.getItem(key), null);
  eq('discard hides banner', doc.querySelector('#p2 .draftbanner'), null);

  // clear() after save stops later writes
  setValue(doc.querySelector('#p1 #probe-input'), 'typed then saved');
  doc.querySelector('#p1 #probe-save').click();
  await sleep(700);
  eq('after save(): nothing re-written', ls.getItem(key), null);
}

h('8. التبويبات وشريط المريض');
{
  api.mountTabs('t1', 'بنسلين');
  await sleep(100);
  const tabs = Array.from(doc.querySelectorAll('#t1 [role=tab]'));
  eq('two tabs', tabs.length, 2);
  eq('first selected', tabs[0].getAttribute('aria-selected'), 'true');
  eq('badge rendered', doc.querySelector('#t1 .tabs__badge').textContent, '3');
  ok('allergy alert shown with text', doc.querySelector('#t1 .patientbar__alert')?.textContent.includes('بنسلين'));
  ok('visit-open tag shown', doc.querySelector('#t1 .patientbar').textContent.includes('زيارة مفتوحة'));
  eq('panel b hidden', doc.getElementById('t-panel-b').hidden, true);

  setValue(doc.querySelector('#t1 #keep'), 'half-typed');
  tabs[1].click();
  await sleep(100);
  eq('panel b visible after click', doc.getElementById('t-panel-b').hidden, false);
  eq('panel a hidden but still mounted', doc.getElementById('t-panel-a').hidden, true);
  eq('typed text survives tab switch', doc.querySelector('#t1 #keep').value, 'half-typed');

  api.mountTabs('t2', null);
  await sleep(100);
  eq('no allergy text → no alert (absence is not "no allergies")', doc.querySelector('#t2 .patientbar__alert'), null);
  api.mountTabs('t2', '   ');
}


h('9. محاصرة التركيز في النوافذ (focus trap)');
{
  api.mountModal('m1');
  await sleep(50);
  const opener = doc.getElementById('opener');
  opener.focus();
  opener.click();
  await sleep(100);
  const first = doc.getElementById('m-first');
  const last = doc.getElementById('m-last');
  const closeX = doc.querySelector('#m1 .modal__x');
  ok('focus moves into the dialog on open', doc.querySelector('#m1 .modal__box').contains(doc.activeElement), doc.activeElement && doc.activeElement.outerHTML);
  const tab = (shift = false) => doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }));
  // order inside the dialog: close ✕, input, last
  closeX.focus();
  last.focus();
  tab(false);
  ok('Tab from the last element wraps to the first', doc.activeElement === closeX);
  tab(true);
  ok('Shift+Tab from the first wraps to the last', doc.activeElement === last);
  doc.getElementById('outside').focus();
  tab(false);
  ok('if focus escaped, Tab pulls it back inside', doc.querySelector('#m1 .modal__box').contains(doc.activeElement));
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(100);
  eq('Escape closes', doc.querySelector('#m1 .modal'), null);
  ok('focus returns to the opener', doc.activeElement === opener);
}

h('10. مكونات الواجهة الجديدة');
{
  let retried = 0, tiled = 0;
  api.mountMisc('x1', () => retried++, () => tiled++);
  await sleep(100);
  const svg = doc.querySelector('#x1 svg');
  ok('icon renders an svg with paths', svg && svg.querySelectorAll('rect,path').length > 0 && svg.getAttribute('aria-hidden') === 'true');
  eq('skeleton rows', doc.querySelectorAll('#x1 .skeleton').length, 2);
  ok('skeleton is announced as status', doc.querySelector('#x1 [role=status]'));
  ok('error state has alert role and message', doc.querySelector('#x1 [role=alert]').textContent.includes('تعذّر التحميل'));
  Array.from(doc.querySelectorAll('#x1 .errorstate button'))[0].click();
  eq('retry button calls back', retried, 1);
  const tiles = doc.querySelectorAll('#x1 .stat');
  eq('clickable tile is a button with aria-pressed', [tiles[0].tagName, tiles[0].getAttribute('aria-pressed')], ['BUTTON', 'true']);
  eq('plain tile is not a button', tiles[1].tagName, 'DIV');
  tiles[0].click();
  eq('tile click calls back', tiled, 1);
}


console.log();
if (failures.length) {
  console.log('\x1b[31m✗ فشل ' + failures.length + ' من ' + (pass + failures.length) + '\x1b[0m');
  for (const f of failures) console.log(' -', f.name, '\n    ', f.detail);
  process.exit(1);
}
console.log('\x1b[32m✓ نجحت كل الاختبارات — ' + pass + ' تأكيداً\x1b[0m');
