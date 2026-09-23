/* -------------------------------------------------------------------------
 * The single Supabase client for the whole application.
 * -------------------------------------------------------------------------
 * Configuration mirrors v2/iapp-core.js exactly. Each option was chosen for
 * a reason in the legacy app; changing any of them here changes behaviour
 * the existing backend depends on:
 *
 *   db.schema: 'iapp'      — application tables live in the iapp schema, not
 *                            public. public.profiles is reached explicitly
 *                            via .schema('public').
 *   persistSession         — session survives reload; required for the
 *                            session-restoration requirement.
 *   autoRefreshToken       — long clinic sessions must not expire mid-visit.
 *   detectSessionInUrl:false — no magic-link/OAuth callback flow is in use;
 *                            leaving it on makes the client parse and strip
 *                            URL fragments the router owns.
 *
 * Nothing else in the app may call createClient. One client means one
 * session, one Realtime socket, and one place to swap in generated types.
 * ---------------------------------------------------------------------- */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';
import { env } from '../utils/env';

export const supabase: SupabaseClient<Database, 'iapp'> = createClient<Database, 'iapp'>(
  env.supabaseUrl,
  env.supabasePublishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    db: { schema: 'iapp' },
  },
);

/** public schema accessor — used only for profiles. */
export const publicSchema = () => supabase.schema('public');

/**
 * Realtime channels do not inherit the session token when the client was
 * created before login — RLS then drops every event silently while the
 * channel still reports SUBSCRIBED. The legacy app hit this and fixed it by
 * calling setAuth before subscribing (appointment-service.js). Any code that
 * opens a channel must call this first. Wired up in Step 8.
 */
export async function primeRealtimeAuth(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) supabase.realtime.setAuth(token);
}

/* -------------------------------------------------------------------------
 * Row shape helpers — deliberately in one place.
 * -------------------------------------------------------------------------
 * `database.types.ts` now holds the real generated schema, and every COLS
 * constant is a `const`-asserted string literal (not built with `+`, which
 * widens to `string` and blinds the compiler — see clinics.ts for why).
 * With both of those true, `.select(COLS)` is inferred by supabase-js down
 * to the exact row shape, so these no longer *cast* — they only default a
 * possibly-null result and let TypeScript check `data` against `T`
 * structurally. If a call site's declared `T` doesn't actually match what
 * the query returns, this is now a compile error at that call site instead
 * of a silently wrong runtime value — that is the point of removing the
 * `as` casts, not an incidental effect.
 * ---------------------------------------------------------------------- */

export function rows<T>(data: T[] | null): T[] {
  return data ?? [];
}

export function one<T>(data: T): T {
  return data;
}

export function maybe<T>(data: T | null): T | null {
  return data ?? null;
}
