#!/usr/bin/env bash
# =============================================================================
# Database-level tests for supabase/migrations/20261014000000_queue_calls_and_display.sql
# =============================================================================
# Runs against a THROW-AWAY PostgreSQL database that already has the project's
# migrations applied (baseline -> accounting -> ... -> queue_calls_and_display)
# and the workflow rows from iapp/sql/003_seed.sql. It creates its own test
# clinic/users/patients, and removes them at the end.
#
# NEVER point this at iapp-production. It refuses any database not named
# *_test, and it needs a direct Postgres connection (psql), not the API.
#
#   PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=iapp_test bash tests/db/queue_display.sh
# =============================================================================
set -uo pipefail

: "${PGDATABASE:?set PGDATABASE (must end with _test)}"
case "$PGDATABASE" in *_test) ;; *) echo "refusing: database '$PGDATABASE' is not a *_test database"; exit 2;; esac

PSQL=(psql -X -q -tA -v ON_ERROR_STOP=1)
PASS=0; FAIL=0; FAILS=()

ok()   { PASS=$((PASS+1)); }
bad()  { FAIL=$((FAIL+1)); FAILS+=("$1 :: $2"); }
eq()   { if [ "$2" = "$3" ]; then ok; else bad "$1" "expected [$3] got [$2]"; fi; }
has()  { if printf '%s' "$2" | grep -q -- "$3"; then ok; else bad "$1" "[$2] does not contain [$3]"; fi; }
hasnt(){ if printf '%s' "$2" | grep -q -- "$3"; then bad "$1" "[$2] unexpectedly contains [$3]"; else ok; fi; }
h()    { printf '\n\033[1m%s\033[0m\n' "$1"; }

# run SQL as superuser
su_sql()  { "${PSQL[@]}" -c "$1"; }
# run SQL as an authenticated app user (RLS applies). Output on stdout, errors on stderr merged.
as_user() {
  local uid="$1"; shift
  "${PSQL[@]}" <<SQL 2>&1
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$uid', true) \gset
$*
commit;
SQL
}
# run SQL as the anonymous role
as_anon() {
  "${PSQL[@]}" <<SQL 2>&1
begin;
set local role anon;
$*
commit;
SQL
}

# ── ids ────────────────────────────────────────────────────────────────────
ADMIN=00000000-0000-4000-8000-0000000000a1
DOC=00000000-0000-4000-8000-0000000000d1
DOC2=00000000-0000-4000-8000-0000000000d2
SEC=00000000-0000-4000-8000-0000000000e1
SEC2=00000000-0000-4000-8000-0000000000e2
CLINIC=00000000-0000-4000-8000-00000000c101
CLINIC2=00000000-0000-4000-8000-00000000c102
DOCTOR=00000000-0000-4000-8000-00000000d0c1
DOCTOR2=00000000-0000-4000-8000-00000000d0c2

cleanup() {
  su_sql "
    set session_replication_role = replica;
    delete from iapp.queue_calls where clinic_id in ('$CLINIC','$CLINIC2');
    delete from iapp.display_devices where clinic_id in ('$CLINIC','$CLINIC2');
    delete from iapp.appointment_status_history where appointment_id in (select id from iapp.appointments where clinic_id in ('$CLINIC','$CLINIC2'));
    delete from iapp.appointments where clinic_id in ('$CLINIC','$CLINIC2');
    delete from iapp.patients where patient_code like 'P-9%';
    delete from iapp.staff where profile_id in ('$SEC','$SEC2');
    delete from iapp.doctors where id in ('$DOCTOR','$DOCTOR2');
    delete from iapp.clinics where id in ('$CLINIC','$CLINIC2');
    delete from public.profiles where id in ('$ADMIN','$DOC','$DOC2','$SEC','$SEC2');
    delete from auth.users where id in ('$ADMIN','$DOC','$DOC2','$SEC','$SEC2');
  " >/dev/null 2>&1
}
trap cleanup EXIT
cleanup

# ── fixtures ───────────────────────────────────────────────────────────────
su_sql "
  insert into auth.users(id,email) values
    ('$ADMIN','admin@t'),('$DOC','doc@t'),('$DOC2','doc2@t'),('$SEC','sec@t'),('$SEC2','sec2@t');
  -- auth.users has an insert trigger that creates a 'patient' profile; set the real role afterwards.
  insert into public.profiles(id,role,full_name) values
    ('$ADMIN','admin','مدير'),('$DOC','doctor','د. عبدو'),('$DOC2','doctor','د. سارة'),
    ('$SEC','secretary','سكرتيرة ١'),('$SEC2','secretary','سكرتيرة ٢')
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;
  insert into iapp.clinics(id,code,name_ar) values
    ('$CLINIC','T1','عيادة الاختبار'),('$CLINIC2','T2','عيادة أخرى');
  insert into iapp.doctors(id,profile_id,full_name_ar,short_name) values
    ('$DOCTOR','$DOC','د. عبد الستار صقر','د. عبدو'),('$DOCTOR2','$DOC2','د. سارة أحمد','د. سارة');
  insert into iapp.staff(profile_id,clinic_id,full_name_ar) values
    ('$SEC','$CLINIC','سكرتيرة ١'),('$SEC2','$CLINIC2','سكرتيرة ٢');
" || { echo "fixture setup failed"; exit 1; }

# patients: name + phone + national id + notes that must NEVER reach the screen
for i in 1 2 3 4 5 6 7 8; do
  su_sql "insert into iapp.patients(id,patient_code,full_name,phone,national_id,notes,allergies,medical_history)
          values ('00000000-0000-4000-8000-0000000009$i$i','P-9000$i','مريض$i كامل الاسم','0101000000$i','2900101010100$i','ملاحظة سرية $i','حساسية سرية $i','تاريخ مرضي سري $i');"
done

pid() { echo "00000000-0000-4000-8000-0000000009$1$1"; }
aid() { echo "00000000-0000-4000-8000-0000000008$1$1"; }

# appointments for "today" in the clinic's own time zone, all CONFIRMED
TODAY=$(su_sql "select (now() at time zone 'Africa/Cairo')::date")
mk() { # n time doctor clinic
  su_sql "insert into iapp.appointments(id,patient_id,doctor_id,clinic_id,scheduled_date,scheduled_time,status,room)
          values ('$(aid $1)','$(pid $1)','$3','$4','$TODAY','$2','CONFIRMED','$5');" >/dev/null
}
mk 1 11:00 "$DOCTOR" "$CLINIC" "غرفة 1"
mk 2 12:00 "$DOCTOR" "$CLINIC" "غرفة 1"
mk 3 10:00 "$DOCTOR" "$CLINIC" "غرفة 1"
mk 4 13:00 "$DOCTOR" "$CLINIC" "غرفة 1"
mk 5 14:00 "$DOCTOR2" "$CLINIC" "غرفة 2"
mk 6 09:00 "$DOCTOR" "$CLINIC2" "غرفة 9"

# ── 1. reception moves patients to the waiting list (existing engine) ─────
h "1. الاستقبال ينقل المرضى إلى الانتظار (المحرك الحالي)"
for n in 1 2 3 4; do
  out=$(as_user "$SEC" "select status from iapp.mark_arrived('$(aid $n)');"); has "secretary arrives #$n" "$out" "ARRIVED"
done
for n in 1 2 3; do
  out=$(as_user "$SEC" "select status from iapp.mark_waiting('$(aid $n)');"); has "secretary waits #$n" "$out" "WAITING"
done
# #4 stays ARRIVED on purpose (arrived, not yet in the waiting room)
# controlled wait times: #2 and #3 waited 30 min (tie on minutes), #1 20 min, #4 5 min
su_sql "
 set session_replication_role = replica;
 update iapp.appointments set confirmed_at=now()-interval '60 min', arrived_at=now()-interval '30 min', waiting_at=now()-interval '29 min' where id in ('$(aid 2)','$(aid 3)');
 update iapp.appointments set confirmed_at=now()-interval '60 min', arrived_at=now()-interval '20 min', waiting_at=now()-interval '19 min' where id = '$(aid 1)';
 update iapp.appointments set confirmed_at=now()-interval '60 min', arrived_at=now()-interval '5 min' where id = '$(aid 4)';
" >/dev/null
# make #2 arrive strictly before #3 by a second so ticket numbers are deterministic
su_sql "set session_replication_role = replica; update iapp.appointments set arrived_at=arrived_at-interval '1 second' where id='$(aid 2)';" >/dev/null

# ── 2. permissions ─────────────────────────────────────────────────────────
h "2. الصلاحيات"
out=$(as_user "$SEC" "select * from iapp.call_next_patient('$CLINIC');"); has "secretary cannot call next (workflow says doctor/admin only)" "$out" "forbidden_transition"
out=$(as_user "$SEC" "select * from iapp.call_patient('$(aid 2)');");     has "secretary cannot call_patient either" "$out" "forbidden_transition"
out=$(as_user "$SEC" "select * from iapp.create_display_device('$CLINIC','شاشة');"); has "secretary cannot register a screen" "$out" "forbidden"
out=$(as_user "$SEC2" "select * from iapp.recall_patient('$(aid 2)');");  has "other-clinic secretary cannot recall" "$out" "forbidden_transition"
out=$(as_user "$DOC" "select * from iapp.call_next_patient('$CLINIC2');"); has "doctor ok but clinic2 has nobody waiting" "$out" "queue_empty"
out=$(as_anon "select * from iapp.call_next_patient('$CLINIC');");         has "anon cannot execute call_next" "$out" "permission denied"
out=$(as_anon "select count(*) from iapp.queue_calls;");                   has "anon cannot read queue_calls" "$out" "permission denied"
out=$(as_anon "select count(*) from iapp.display_devices;");               has "anon cannot read display_devices" "$out" "permission denied"
out=$(as_anon "select count(*) from iapp.appointments;");                  has "anon cannot read appointments" "$out" "permission denied"
out=$(as_anon "select iapp.display_snapshot('x');");                       has "anon cannot call the inner snapshot function" "$out" "permission denied"

# ── 3. screens: registration, token hygiene, privacy ──────────────────────
h "3. أجهزة العرض والخصوصية"
row=$(as_user "$ADMIN" "select device_id||'|'||token from iapp.create_display_device('$CLINIC','تلفزيون الانتظار');" | head -1)
DEV=${row%%|*}; TOKEN=${row##*|}
eq "token is 64 hex chars" "$(printf '%s' "$TOKEN" | grep -Ec '^[0-9a-f]{64}$')" "1"
eq "default is names hidden" "$(su_sql "select show_names from iapp.display_devices where id='$DEV'")" "f"
eq "token itself is not stored" "$(su_sql "select count(*) from iapp.display_devices where token_hash='$TOKEN'")" "0"
eq "only the sha256 is stored" "$(su_sql "select count(*) from iapp.display_devices where token_hash=encode(sha256(convert_to('$TOKEN','utf8')),'hex')")" "1"
out=$(as_user "$DOC" "select token_hash from iapp.display_devices;"); has "token_hash column not readable even by doctor" "$out" "permission denied"
out=$(as_user "$SEC" "select count(*) from iapp.display_devices;");     eq "secretary sees no device rows (RLS)" "$out" "0"

out=$(as_anon "select public.display_queue('not-a-real-token');");       has "bad token rejected" "$out" "invalid_display_token"
out=$(as_anon "select public.display_queue('');");                        has "empty token rejected" "$out" "invalid_display_token"
SNAP=$(as_anon "select public.display_queue('$TOKEN');")
eq "snapshot waiting_count (3 waiting + 1 arrived)" "$(printf '%s' "$SNAP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["waiting_count"])')" "4"
eq "snapshot show_names false" "$(printf '%s' "$SNAP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["show_names"])')" "False"
for secret in "مريض" "0101000" "2900101" "سرية" "ملاحظة" "P-900" "حساسية" "تاريخ" "'phone'" "national" "notes" "patient_id" "diagnos"; do
  hasnt "snapshot (names off) leaks nothing: $secret" "$SNAP" "$secret"
done
KEYS=$(printf '%s' "$SNAP" | python3 -c '
import sys,json
d=json.load(sys.stdin)
k=set(d.keys())
for r in d["waiting"]: k|={"waiting."+x for x in r}
for r in d["current"]: k|={"current."+x for x in r}
print(",".join(sorted(k)))')
eq "snapshot keys are exactly the whitelist" "$KEYS" "clinic_name,current,day,latest_call_id,server_time,show_names,waiting,waiting.doctor,waiting.name,waiting.ticket_no,waiting.wait_minutes,waiting_count"
out=$(as_anon "select public.display_queue('$TOKEN');" | python3 -c 'import sys,json;d=json.load(sys.stdin);print([w["ticket_no"] for w in d["waiting"]])')
# priority: #3 (30m, 10:00) → #2 (30m, 12:00) → #1 (20m) → #4 (5m);  their tickets are 2,1,3,4
eq "waiting order = clinic priority (longest wait, then earlier time)" "$out" "[2, 1, 3, 4]"
# tickets: arrival order is #2 (30m+1s), #3 (30m), #1 (20m), #4 (5m)  → 1:#2 2:#3 3:#1 4:#4
eq "ticket numbers follow arrival order (#2=1,#3=2,#1=3,#4=4)" \
   "$(su_sql "select string_agg(t.ticket_no::text, ',' order by t.ticket_no) from iapp.v_queue_tickets t where t.clinic_id='$CLINIC'")" "1,2,3,4"
eq "ticket of #2 is 1" "$(su_sql "select ticket_no from iapp.v_queue_tickets where appointment_id='$(aid 2)'")" "1"
eq "ticket of #1 is 3" "$(su_sql "select ticket_no from iapp.v_queue_tickets where appointment_id='$(aid 1)'")" "3"

# ── 4. call next ───────────────────────────────────────────────────────────
h "4. نداء المريض التالي"
REQ1=11111111-1111-4111-8111-111111111111
out=$(as_user "$DOC" "select appointment_id||'|'||kind||'|'||coalesce(room,'')||'|'||deduped from iapp.call_next_patient('$CLINIC','$DOCTOR',null,'$REQ1');")
eq "first call: #2 and #3 both waited 30 min → tie → earlier scheduled time (#3, 10:00)" "$out" "$(aid 3)|call|غرفة 1|false"
eq "called patient is IN_CLINIC" "$(su_sql "select status from iapp.appointments where id='$(aid 3)'")" "IN_CLINIC"
# retry of the same click must not call anyone else
out=$(as_user "$DOC" "select appointment_id||'|'||deduped from iapp.call_next_patient('$CLINIC','$DOCTOR',null,'$REQ1');")
eq "same request id → same patient, deduped=true" "$out" "$(aid 3)|true"
eq "exactly one IN_CLINIC after the retry" "$(su_sql "select count(*) from iapp.appointments where clinic_id='$CLINIC' and status='IN_CLINIC'")" "1"
eq "exactly one event so far" "$(su_sql "select count(*) from iapp.queue_calls where clinic_id='$CLINIC'")" "1"
eq "event records who called and in which role" "$(su_sql "select called_by||'|'||called_by_role||'|'||via from iapp.queue_calls where clinic_id='$CLINIC'")" "$DOC|doctor|next"

# the screen now shows the call; names still hidden
SNAP=$(as_anon "select public.display_queue('$TOKEN');")
eq "current[0] is ticket 2 (#3), room from appointment" \
  "$(printf '%s' "$SNAP" | python3 -c 'import sys,json;c=json.load(sys.stdin)["current"][0];print(c["ticket_no"],c["room"],c["doctor"],c["kind"],c["name"])')" "2 غرفة 1 د. عبدو call None"
eq "waiting_count dropped to 3" "$(printf '%s' "$SNAP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["waiting_count"])')" "3"
LATEST=$(printf '%s' "$SNAP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["latest_call_id"])')

# explicit room override
out=$(as_user "$DOC" "select appointment_id||'|'||coalesce(room,'') from iapp.call_next_patient('$CLINIC','$DOCTOR','غرفة الفحص 7');")
eq "next goes to #2, room override is used" "$out" "$(aid 2)|غرفة الفحص 7"
# ARRIVED patient (#4, never put in the waiting room) is reachable: ARRIVED→WAITING→IN_CLINIC
out=$(as_user "$DOC" "select appointment_id from iapp.call_next_patient('$CLINIC','$DOCTOR');"); eq "#1 next" "$out" "$(aid 1)"
out=$(as_user "$DOC" "select appointment_id from iapp.call_next_patient('$CLINIC','$DOCTOR');"); eq "ARRIVED #4 is called via the legal two-step" "$out" "$(aid 4)"
eq "history shows ARRIVED→WAITING→IN_CLINIC for #4" \
   "$(su_sql "select string_agg(coalesce(from_status::text,'-')||'>'||to_status::text, ',' order by id) from iapp.appointment_status_history where appointment_id='$(aid 4)'")" "->CONFIRMED,CONFIRMED>ARRIVED,ARRIVED>WAITING,WAITING>IN_CLINIC"
out=$(as_user "$DOC" "select * from iapp.call_next_patient('$CLINIC','$DOCTOR');"); has "empty queue for this doctor → queue_empty" "$out" "queue_empty"
out=$(as_user "$DOC2" "select count(*) from iapp.call_next_patient('$CLINIC','$DOCTOR2');"); has "doctor filter: other doctor's patient is separate (#5 never arrived)" "$out" "queue_empty"

# ── 5. no double call on the same patient ─────────────────────────────────
h "5. منع تكرار الاستدعاء"
out=$(as_user "$DOC" "select status from iapp.call_patient('$(aid 3)');"); eq "repeat call_patient on an already-called patient is a no-op (still IN_CLINIC)" "$out" "IN_CLINIC"
eq "…and it wrote NO second 'call' event (4 patients called → 4 events)" "$(su_sql "select count(*) from iapp.queue_calls where clinic_id='$CLINIC' and kind='call'")" "4"

# ── 6. re-call ─────────────────────────────────────────────────────────────
h "6. إعادة النداء"
RC1=22222222-2222-4222-8222-222222222221
sleep 2.2
out=$(as_user "$DOC" "select kind||'|'||deduped from iapp.recall_patient('$(aid 3)','$RC1');"); eq "recall writes a 'recall' event" "$out" "recall|false"
out=$(as_user "$DOC" "select kind||'|'||deduped from iapp.recall_patient('$(aid 3)','$RC1');"); eq "same request id → deduped" "$out" "recall|true"
out=$(as_user "$DOC" "select kind||'|'||deduped from iapp.recall_patient('$(aid 3)','22222222-2222-4222-8222-222222222222');"); eq "second device within 2s → deduped to the first" "$out" "recall|true"
eq "recall count = 1" "$(su_sql "select count(*) from iapp.queue_calls where appointment_id='$(aid 3)' and kind='recall'")" "1"
eq "recall did not change status" "$(su_sql "select status from iapp.appointments where id='$(aid 3)'")" "IN_CLINIC"
out=$(as_user "$SEC" "select * from iapp.recall_patient('$(aid 3)');"); has "secretary cannot recall" "$out" "forbidden_transition"
out=$(as_user "$DOC" "select * from iapp.recall_patient('$(aid 5)');"); has "cannot recall a patient who is not called" "$out" "not_found\|not_called"
SNAP=$(as_anon "select public.display_queue('$TOKEN');")
eq "latest_call_id advanced after recall" "$(printf '%s' "$SNAP" | python3 -c "import sys,json;print(json.load(sys.stdin)['latest_call_id'] > $LATEST)")" "True"
eq "current[0] for the re-called patient has kind=recall" "$(printf '%s' "$SNAP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["current"][0]["kind"])')" "recall"

# ── 7. cancel the call → back to waiting, keeps his place ─────────────────
h "7. إلغاء الاستدعاء وإرجاع المريض للانتظار"
before=$(su_sql "select arrived_at from iapp.appointments where id='$(aid 3)'")
out=$(as_user "$DOC" "select status from iapp.mark_waiting('$(aid 3)');"); has "IN_CLINIC → WAITING by doctor" "$out" "WAITING"
eq "arrived_at untouched (he keeps his place)" "$(su_sql "select arrived_at from iapp.appointments where id='$(aid 3)'")" "$before"
SNAP=$(as_anon "select public.display_queue('$TOKEN');")
eq "he leaves the 'current' list" "$(printf '%s' "$SNAP" | python3 -c 'import sys,json;print([c["ticket_no"] for c in json.load(sys.stdin)["current"]])')" "[4, 3, 1]"
eq "he is first again in the waiting list (longest wait)" "$(printf '%s' "$SNAP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["waiting"][0]["ticket_no"])')" "2"
# calling him again is a new call event
out=$(as_user "$DOC" "select appointment_id||'|'||kind from iapp.call_next_patient('$CLINIC','$DOCTOR');"); eq "he is called again as a fresh 'call'" "$out" "$(aid 3)|call"

# ── 8. the legacy path still produces the event (trigger) ─────────────────
h "8. المسار القديم (call_patient مباشرة) يُسجَّل أيضًا"
# #5 belongs to doctor 2 in clinic 1: arrive → wait (secretary) → call_patient (doctor, the old RPC)
as_user "$SEC" "select 1 from iapp.mark_arrived('$(aid 5)');" >/dev/null 2>&1
as_user "$SEC" "select 1 from iapp.mark_waiting('$(aid 5)');" >/dev/null 2>&1
out=$(as_user "$DOC2" "select status from iapp.call_patient('$(aid 5)');"); has "old RPC works unchanged" "$out" "IN_CLINIC"
eq "…and logged a 'call' event (via=direct)" "$(su_sql "select kind||'|'||via from iapp.queue_calls where appointment_id='$(aid 5)'")" "call|direct"

# ── 9. names ON: first word only ──────────────────────────────────────────
h "9. إظهار الأسماء (اختياري) — الاسم الأول فقط"
out=$(as_user "$ADMIN" "select iapp.set_display_device_names('$DEV', true);"); hasnt "admin can switch names on" "$out" "ERROR"
SNAP=$(as_anon "select public.display_queue('$TOKEN');")
eq "first word only" "$(printf '%s' "$SNAP" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["current"][0]["name"])')" "مريض5"
for secret in "كامل الاسم" "0101000" "2900101" "سرية" "ملاحظة" "P-900"; do hasnt "names ON still leaks nothing: $secret" "$SNAP" "$secret"; done
out=$(as_user "$SEC" "select iapp.set_display_device_names('$DEV', false);"); has "secretary cannot flip it" "$out" "forbidden"
as_user "$ADMIN" "select iapp.set_display_device_names('$DEV', false);" >/dev/null

# ── 10. revoke ────────────────────────────────────────────────────────────
h "10. إلغاء تسجيل الشاشة"
out=$(as_user "$DOC" "select iapp.revoke_display_device('$DEV');"); hasnt "doctor can revoke" "$out" "ERROR"
out=$(as_anon "select public.display_queue('$TOKEN');"); has "revoked token stops working immediately" "$out" "invalid_display_token"

# ── 11. clinic isolation ──────────────────────────────────────────────────
h "11. عزل العيادات"
row2=$(as_user "$ADMIN" "select device_id||'|'||token from iapp.create_display_device('$CLINIC2','شاشة ثانية');" | head -1); TOKEN2=${row2##*|}
SNAP2=$(as_anon "select public.display_queue('$TOKEN2');")
eq "screen of clinic 2 sees nothing of clinic 1" "$(printf '%s' "$SNAP2" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["waiting_count"],len(d["current"]),d["clinic_name"])')" "0 0 عيادة أخرى"

# ── 12. REAL concurrency: separate connections ────────────────────────────
h "12. التزامن الحقيقي (اتصالات منفصلة)"
# 6 patients waiting for one doctor, 8 simultaneous 'call next' presses with different request ids
for n in 7 8; do mk "$n" "1$n:00" "$DOCTOR" "$CLINIC" "غرفة 1"; done
# reset everything in clinic 1 to a clean slate of 6 waiting patients
su_sql "
 set session_replication_role = replica;
 delete from iapp.queue_calls where clinic_id='$CLINIC';
 update iapp.appointments set status='WAITING', confirmed_at=now()-interval '60 min', arrived_at=now()-interval '20 min', waiting_at=now()-interval '19 min',
        in_clinic_at=null, completed_at=null, cancelled_at=null where clinic_id='$CLINIC' and id in ('$(aid 1)','$(aid 2)','$(aid 3)','$(aid 4)','$(aid 5)');
 update iapp.appointments set status='WAITING', confirmed_at=now()-interval '60 min', arrived_at=now()-interval '10 min', waiting_at=now()-interval '9 min',
        in_clinic_at=null where id='$(aid 7)';
" || echo "RESET FAILED"
su_sql "update iapp.appointments set doctor_id='$DOCTOR' where id='$(aid 5)';" >/dev/null
WAITING_N=$(su_sql "select count(*) from iapp.appointments where clinic_id='$CLINIC' and scheduled_date='$TODAY' and status in ('ARRIVED','WAITING') and doctor_id='$DOCTOR'")
OUT=$(mktemp -d)
GO=$(python3 -c 'import time;print(time.time()+2.0)')
for i in 1 2 3 4 5 6 7 8; do
  (
    uid=$(printf '33333333-3333-4333-8333-3333333333%02d' "$i")
    "${PSQL[@]}" <<SQL > "$OUT/next_$i" 2>&1
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$DOC', true) \gset
select pg_sleep(greatest(0, $GO - extract(epoch from clock_timestamp())));
select appointment_id from iapp.call_next_patient('$CLINIC','$DOCTOR',null,'$uid');
commit;
SQL
  ) &
done
wait
CALLED=$(cat "$OUT"/next_* | grep -E '^[0-9a-f]{8}-' | sort)
UNIQ=$(printf '%s\n' "$CALLED" | sort -u | wc -l | tr -d ' ')
TOTAL=$(printf '%s\n' "$CALLED" | grep -c .)
eq "number of successful calls = number of waiting patients ($WAITING_N)" "$TOTAL" "$WAITING_N"
eq "no patient was called twice ($TOTAL calls, $UNIQ distinct)" "$UNIQ" "$TOTAL"
EMPTY=$(cat "$OUT"/next_* | grep -c queue_empty)
eq "the surplus presses got queue_empty, not a duplicate" "$EMPTY" "$((8 - WAITING_N))"
eq "event rows = calls (no duplicate events)" "$(su_sql "select count(*) from iapp.queue_calls where clinic_id='$CLINIC' and kind='call'")" "$TOTAL"
eq "nobody left in the queue" "$(su_sql "select count(*) from iapp.appointments where clinic_id='$CLINIC' and scheduled_date='$TODAY' and status in ('ARRIVED','WAITING') and doctor_id='$DOCTOR'")" "0"

# same request id from 4 devices at once → one call
su_sql "
 set session_replication_role = replica;
 update iapp.appointments set status='WAITING', in_clinic_at=null where id in ('$(aid 1)','$(aid 2)');
" >/dev/null
GO=$(python3 -c 'import time;print(time.time()+2.0)')
SAME=44444444-4444-4444-8444-444444444444
for i in 1 2 3 4; do
  (
    "${PSQL[@]}" <<SQL > "$OUT/same_$i" 2>&1
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$DOC', true) \gset
select pg_sleep(greatest(0, $GO - extract(epoch from clock_timestamp())));
select appointment_id||'|'||deduped from iapp.call_next_patient('$CLINIC','$DOCTOR',null,'$SAME');
commit;
SQL
  ) &
done
wait
eq "4 simultaneous presses with ONE request id → 1 event" "$(su_sql "select count(*) from iapp.queue_calls where request_id='$SAME'")" "1"
eq "…all four got the same patient" "$(cat "$OUT"/same_* | grep -E '\|' | cut -d'|' -f1 | sort -u | wc -l | tr -d ' ')" "1"
eq "…exactly one of them was the original (deduped=false)" "$(cat "$OUT"/same_* | grep -c '|false')" "1"
eq "…only one patient moved to IN_CLINIC" "$(su_sql "select count(*) from iapp.appointments where id in ('$(aid 1)','$(aid 2)') and status='IN_CLINIC'")" "1"

# 3 simultaneous legacy call_patient on the same appointment → one wins
su_sql "
 set session_replication_role = replica;
 update iapp.appointments set status='WAITING', in_clinic_at=null where id='$(aid 7)';
" >/dev/null
BEFORE=$(su_sql "select count(*) from iapp.queue_calls where appointment_id='$(aid 7)'")
GO=$(python3 -c 'import time;print(time.time()+2.0)')
for i in 1 2 3; do
  (
    "${PSQL[@]}" <<SQL > "$OUT/legacy_$i" 2>&1
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$DOC', true) \gset
select pg_sleep(greatest(0, $GO - extract(epoch from clock_timestamp())));
select status from iapp.call_patient('$(aid 7)');
commit;
SQL
  ) &
done
wait
# the existing engine makes a repeat call a harmless no-op (all three see IN_CLINIC, none errors) …
eq "3 simultaneous call_patient on one patient → no errors, all end IN_CLINIC" "$(cat "$OUT"/legacy_* | grep -c '^IN_CLINIC$')" "3"
# … and the screen must still hear exactly ONE call, which the trigger guarantees (it fires on the status change only)
eq "…but exactly ONE new call event was written" "$(( $(su_sql "select count(*) from iapp.queue_calls where appointment_id='$(aid 7)'") - BEFORE ))" "1"
rm -rf "$OUT"

# ── 13. append-only + untouched existing behaviour ────────────────────────
h "13. سجل النداءات للإضافة فقط + سلامة النظام الحالي"
out=$(su_sql "update iapp.queue_calls set room='x' where id=(select min(id) from iapp.queue_calls)" 2>&1); has "update blocked" "$out" "append-only"
out=$(su_sql "delete from iapp.queue_calls where id=(select min(id) from iapp.queue_calls)" 2>&1);          has "delete blocked" "$out" "append-only"
out=$(as_user "$SEC" "select count(*) from iapp.queue_calls;");  eq "secretary reads her own clinic's events only (RLS)" "$out" "$(su_sql "select count(*) from iapp.queue_calls where clinic_id='$CLINIC'")"
out=$(as_user "$SEC2" "select count(*) from iapp.queue_calls;"); eq "other clinic's secretary sees none of them" "$out" "0"
out=$(as_user "$SEC" "select count(*) from iapp.v_queue_tickets;"); eq "ticket view is RLS-scoped (security_invoker)" "$out" "$(su_sql "select count(*) from iapp.v_queue_tickets where clinic_id='$CLINIC'")"
# the complete → visit flow still works for the called patient
out=$(as_user "$DOC" "select status from iapp.complete_appointment('$(aid 7)');"); has "end of exam (complete_appointment) unchanged" "$out" "COMPLETED"
# INFORMATIONAL (not an assertion about this migration): iapp.transition() checks the caller's ROLE but not
# the caller's CLINIC, so a secretary of clinic 1 can move a clinic-2 appointment if she knows its id.
out=$(as_user "$SEC" "select status from iapp.cancel_appointment('$(aid 6)', 'سبب الاختبار');")
if printf '%s' "$out" | grep -q CANCELLED; then echo "  FINDING (pre-existing, unrelated to this migration): a clinic-1 secretary cancelled a clinic-2 appointment through iapp.cancel_appointment — iapp.transition has no clinic-scope check."; fi

echo
echo "============================================================"
if [ "$FAIL" -eq 0 ]; then printf '\033[32m✓ queue/display DB tests: %d assertions passed\033[0m\n' "$PASS"; exit 0
else printf '\033[31m✗ %d failed, %d passed\033[0m\n' "$FAIL" "$PASS"; printf '  - %s\n' "${FAILS[@]}"; exit 1; fi
