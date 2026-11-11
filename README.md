# I APP — React frontend (Phase 11.5)

Parallel React implementation of the I APP clinic system. The legacy
applications at `/iapp/` and `/iapp/v2/` remain the production system and the
emergency fallback; this app deploys alongside them at `/iapp/app/`.

**The backend is authoritative.** Business rules, RLS and appointment state
live in PostgreSQL (schema `iapp`); AI secrets live in Supabase Edge Function
secrets. Schema changes are reviewed SQL files under `supabase/migrations/`.

## Setup

```bash
cp .env.example .env      # same live Supabase project as the legacy apps
npm install
npm run dev
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Typecheck + production build + Pages 404 fallback |
| `npm run typecheck` | TypeScript only |
| `npm run lint` | oxlint |
| `npm test` | All jsdom test suites |
| `npm run test:db` | Database suite (local PostgreSQL only) |

## Database types

`src/types/database.types.ts` is generated from the live project. After any
migration, regenerate it (read-only, creates no migration):

```bash
npx supabase login
npx supabase gen types typescript \
  --project-id vkkjatrawzpmdhfloens \
  --schema iapp,public \
  > src/types/database.types.ts
```

The waiting-room objects (`queue_calls`, `display_devices`, `v_queue_tickets`
and their functions) were added to that file by hand on 2026-10-14 and have not
been regenerated since.

## Database changes

`supabase/migrations/` holds reviewed SQL files. They are applied by hand
(Supabase SQL Editor) — nothing in this repository applies them automatically.
Apply a migration BEFORE publishing a build that depends on it.
`supabase/optional/` holds scripts that change data or scheduling and need an
explicit decision; they are never part of a release.

## Tests

`npm test` runs every jsdom suite (smoke, medical, accounting, reception,
drafts, display, examsave) with no database. `npm run test:db` runs the
waiting-room/permissions suite against a local PostgreSQL whose name ends in
`_test` (it refuses anything else); it is not part of CI.

## Publishing

Only from `main`: `bash deploy-to-pages.sh ../iapp/app --push`, then merge the
PR it opens in `drsakr86-hash/iapp`. `app/build-info.txt` records the source
commit; the published site matches the source when that SHA is `main`'s.
GitHub Pages serves only real files: a public deep link needs its own
`<path>/index.html` (see `scripts/pages-fallback.mjs`, used for `/display/`).

## Rules this project holds to

- Components call services; services call Supabase. No Supabase queries in components.
- Route guards are UX. RLS is the security boundary.
- No secret may be added to `.env` — anything `VITE_`-prefixed ships in the bundle.
- Never use `toISOString()` for a date: use `todayLocal()` from `utils/date.ts`.
- CSS uses logical properties only, so RTL keeps working.
