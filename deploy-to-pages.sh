#!/usr/bin/env bash
# =============================================================================
#  deploy-to-pages.sh
# =============================================================================
#  ينشر ناتج البناء (dist) إلى مجلد GitHub Pages.
#
#  سبب الصفحة الفاضية: المنشور حالياً هو الكود المصدر، وفيه
#      <script type="module" src="/src/main.tsx">
#  والمتصفح لا يشغّل ملفات .tsx. الذي يُنشر يجب أن يكون محتويات dist
#  بعد البناء، وفيها index.html يشير إلى assets/*.js حقيقية.
#
#  الاستعمال — من داخل مجلد المشروع (حيث package.json):
#      bash deploy-to-pages.sh ../iapp/app
#      bash deploy-to-pages.sh ../iapp/app --push
#
#  الوسيط الأول = مجلد النشر داخل مستودع الصفحات.
# =============================================================================

set -euo pipefail

RED=$'\e[31m'; GRN=$'\e[32m'; YEL=$'\e[33m'; BLD=$'\e[1m'; OFF=$'\e[0m'
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$GRN" "$OFF" "$*"; }
warn() { printf '%s!%s %s\n' "$YEL" "$OFF" "$*"; }
die()  { printf '%s✗ %s%s\n' "$RED" "$*" "$OFF" >&2; exit 1; }
rule() { printf '%s\n' "------------------------------------------------------------"; }

TARGET="${1:-}"
DO_PUSH="${2:-}"
[ -n "$TARGET" ] || die "حدّد مجلد النشر:  bash deploy-to-pages.sh ../iapp/app"

[ -f package.json ] || die "شغّل السكربت من داخل مجلد المشروع (حيث package.json)"
grep -q '"iapp-react"' package.json || die "package.json ليس لمشروع iapp-react"

NPM=npm
command -v npm >/dev/null 2>&1 || NPM=npm.cmd
command -v "$NPM" >/dev/null 2>&1 || die "npm غير موجود — ثبّت nodejs أولاً:  pkg install nodejs"

# ---------------------------------------------------------------------------
# 1) التحقق من .env — القيم تُحقن داخل ملف البناء وقت البناء، لا وقت التشغيل.
#    البناء بقيم .env.example ينتج تطبيقاً يفتح ولا يتصل بقاعدة البيانات،
#    وهو عطل صامت: الشاشة تظهر ثم تفشل كل عملية.
# ---------------------------------------------------------------------------
rule; say "${BLD}فحص الإعداد${OFF}"; rule

[ -f .env ] || die "لا يوجد .env — أنشئه بقيم مشروعك الحقيقية قبل البناء"

URL="$(grep -E '^VITE_SUPABASE_URL=' .env | head -1 | cut -d= -f2- || true)"
KEY="$(grep -E '^VITE_SUPABASE_PUBLISHABLE_KEY=' .env | head -1 | cut -d= -f2- || true)"

[ -n "$URL" ] || die "VITE_SUPABASE_URL غير موجود في .env"
[ -n "$KEY" ] || die "VITE_SUPABASE_PUBLISHABLE_KEY غير موجود في .env"

case "$URL" in
  *YOUR_PROJECT_REF*|*your-project*|*example.supabase.co*)
    die "VITE_SUPABASE_URL ما زال قيمة وهمية من .env.example — ضع رابط مشروعك الحقيقي" ;;
esac
case "$KEY" in
  *YOUR_*|*your-*|*placeholder*)
    die "VITE_SUPABASE_PUBLISHABLE_KEY ما زال قيمة وهمية — ضع مفتاح publishable الحقيقي" ;;
esac
ok "‎.env يحمل قيماً حقيقية"

# ---------------------------------------------------------------------------
# 2) base في vite.config يجب أن يطابق مسار الموقع، وإلا حُمّلت الملفات من
#    مسار خاطئ وظهرت صفحة بيضاء رغم صحة البناء.
# ---------------------------------------------------------------------------
BASE="$(grep -oE "base:[[:space:]]*['\"][^'\"]*['\"]" vite.config.ts | head -1 | sed "s/.*['\"]\\(.*\\)['\"].*/\\1/" || true)"
[ -n "$BASE" ] || die "تعذّر قراءة base من vite.config.ts"
say "   base في vite.config.ts = $BASE"

BASENAME="$(grep -oE 'basename="[^"]*"' src/app/App.tsx | head -1 | cut -d'"' -f2 || true)"
say "   basename في App.tsx      = $BASENAME"

EXPECT="${BASE%/}"
if [ "$BASENAME" != "$EXPECT" ]; then
  die "عدم تطابق: base=$BASE بينما basename=$BASENAME — يجب أن يكونا نفس المسار"
fi
ok "‎base و basename متطابقان"

# تحذير إن كان مسار النشر لا يوافق base
TARGET_TAIL="$(printf '%s' "$TARGET" | sed 's#/*$##')"
case "$EXPECT" in
  */"$(basename "$TARGET_TAIL")") ok "مجلد النشر يوافق base" ;;
  *) warn "مجلد النشر '$TARGET_TAIL' قد لا يوافق base='$BASE' — تأكد من رابط الموقع" ;;
esac

# ---------------------------------------------------------------------------
# 3) البناء
# ---------------------------------------------------------------------------
rule; say "${BLD}البناء${OFF}"; rule
[ -d node_modules ] || "$NPM" install --no-audit --no-fund
"$NPM" run build || die "فشل البناء — لم يُنشر شيء"

# ---------------------------------------------------------------------------
# 4) التحقق من الناتج قبل نشره. هذا هو الفحص الذي كان غائباً:
#    ملف مصدر يمر بصمت، وملف مبني يجب أن يشير إلى assets حقيقية.
# ---------------------------------------------------------------------------
rule; say "${BLD}فحص ناتج البناء${OFF}"; rule

[ -f dist/index.html ] || die "dist/index.html غير موجود"

if grep -q 'src="/src/main.tsx"' dist/index.html; then
  die "dist/index.html ما زال يشير إلى /src/main.tsx — البناء لم ينتج ملفاً صالحاً"
fi
ok "لا يشير إلى ملفات مصدر"

grep -q 'assets/.*\.js' dist/index.html || die "dist/index.html لا يشير إلى أي ملف JS مبني"
ok "يشير إلى assets مبنية"

grep -q "$BASE" dist/index.html || warn "مسار base غير ظاهر في dist/index.html — راجع الإعداد"
N_ASSETS="$(ls dist/assets 2>/dev/null | wc -l | tr -d ' ')"
[ "$N_ASSETS" -gt 0 ] || die "مجلد dist/assets فارغ"
ok "عدد ملفات assets: $N_ASSETS"

# ---------------------------------------------------------------------------
# 5) النشر. المجلد الهدف يُفرَّغ من ناتج بناء سابق فقط — لا نحذف .git ولا
#    أي ملف خارج ما ينتجه البناء.
# ---------------------------------------------------------------------------
rule; say "${BLD}النشر إلى $TARGET${OFF}"; rule
[ -d "$TARGET" ] || die "المجلد '$TARGET' غير موجود — استنسخ مستودع الصفحات أولاً"

if [ -n "$(ls -A "$TARGET" 2>/dev/null | grep -v '^\.git$' || true)" ]; then
  STAMP="$(date +%Y%m%d-%H%M%S)"
  BK="$TARGET/../.pages-backup-$STAMP"
  mkdir -p "$BK"
  (cd "$TARGET" && tar -cf - --exclude=.git . ) | (cd "$BK" && tar -xf -)
  ok "نسخة احتياطية للمحتوى القديم في $BK"

  find "$TARGET" -mindepth 1 -maxdepth 1 -not -name '.git' -exec rm -rf {} +
  ok "فُرِّغ المجلد الهدف (‎.git محفوظ)"
fi

(cd dist && tar -cf - . ) | (cd "$TARGET" && tar -xf -)

# GitHub Pages يمرّر الموقع على Jekyll، وهو يتجاهل المجلدات والملفات التي
# تبدأ بشرطة سفلية. الملف .nojekyll يعطّل ذلك. الاسم يجب أن يبدأ بنقطة —
# ملف باسم nojekyll.txt لا يفعل شيئاً.
: > "$TARGET/.nojekyll"
ok "أُنشئ ‎.nojekyll"

say ""
ok "نُشر $(find "$TARGET" -type f -not -path '*/.git/*' | wc -l | tr -d ' ') ملفاً."

# ---------------------------------------------------------------------------
# 6) git — نطبع الأوامر ولا ندفع تلقائياً إلا بطلب صريح.
# ---------------------------------------------------------------------------
rule
if [ "$DO_PUSH" = "--push" ]; then
  REPO="$(cd "$TARGET" && git rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$REPO" ] || die "مجلد النشر ليس داخل مستودع git"
  cd "$REPO"
  git add -A
  git commit -m "deploy: publish built app to Pages" || warn "لا جديد للالتزام"
  git push
  ok "تم الدفع."
else
  say "${BLD}الخطوة الأخيرة — نفّذها بنفسك:${OFF}"
  say "  cd $TARGET"
  say "  git add -A"
  say "  git commit -m \"deploy: publish built app\""
  say "  git push"
  say ""
  say "أو أعد التشغيل مع --push لتنفيذها تلقائياً."
fi
rule
