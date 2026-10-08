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
const { wa, filters } = dom.window.__iappReception;

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

console.log();
if (failures.length) {
  console.log('\x1b[31m✗ فشل ' + failures.length + ' من ' + (pass + failures.length) + '\x1b[0m');
  for (const f of failures) console.log(' -', f.name, '\n    ', f.detail);
  process.exit(1);
}
console.log('\x1b[32m✓ نجحت كل الاختبارات — ' + pass + ' تأكيداً\x1b[0m');
