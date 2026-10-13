/* -------------------------------------------------------------------------
 * display service — the PUBLIC waiting-room screen's only data source.
 * -------------------------------------------------------------------------
 * A screen has no user account. It holds a long random token (given once when
 * a doctor/admin registers the screen under «شاشات الانتظار») and calls ONE
 * read-only function, public.display_queue(token). Nothing else is reachable
 * with that token: no tables, no other function.
 *
 * The token is kept in this device's localStorage. It is read from the URL
 * once (?t=…) and then removed from the address bar, so it does not linger in
 * a screenshot or in the browser history of the TV.
 * ---------------------------------------------------------------------- */

import { publicSchema } from './supabase';
import { parseSnapshot, type DisplaySnapshot } from '../utils/queueDisplay';

const TOKEN_KEY = 'iapp:display-token';

export function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode / blocked storage: the screen then works until it is reloaded */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Take ?t=… from the URL (and strip it), else fall back to the stored token. */
export function resolveToken(): string | null {
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('t');
    if (fromUrl && /^[0-9a-f]{64}$/i.test(fromUrl.trim())) {
      storeToken(fromUrl.trim());
      url.searchParams.delete('t');
      window.history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
      return fromUrl.trim();
    }
  } catch {
    /* fall through to storage */
  }
  return readStoredToken();
}

export type DisplayErrorKind = 'invalid' | 'network' | 'other';

export class DisplayError extends Error {
  kind: DisplayErrorKind;
  constructor(kind: DisplayErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** One poll. Throws DisplayError('invalid') when the screen is not registered / was revoked. */
export async function fetchSnapshot(token: string): Promise<DisplaySnapshot> {
  /* A request that hangs must not freeze the screen: give up after 8 s so the
     poll loop can back off and the connection indicator can react. */
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8000);
  let res;
  try {
    res = await publicSchema().rpc('display_queue', { p_token: token }).abortSignal(ctrl.signal);
  } catch (e) {
    throw new DisplayError('network', e instanceof Error ? e.message : 'network');
  } finally {
    clearTimeout(timeout);
  }
  const { data, error } = res;
  if (error) {
    const m = String(error.message ?? '');
    const code = String((error as { code?: string }).code ?? '');
    if (code === '28000' || /invalid_display_token/i.test(m)) {
      throw new DisplayError('invalid', 'invalid_display_token');
    }
    if (/fetch|network|timeout|failed/i.test(m) || code === '') {
      throw new DisplayError('network', m);
    }
    throw new DisplayError('other', m);
  }
  const snapshot = parseSnapshot(data);
  if (!snapshot) throw new DisplayError('other', 'unexpected response');
  return snapshot;
}
