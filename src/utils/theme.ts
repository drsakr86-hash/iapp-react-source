/** Light/dark theme preference. Dark is the brand default; light is opt-in. */
export type Theme = 'dark' | 'light';
export const THEME_KEY = 'iapp:theme';

interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export function readTheme(storage: KV | null): Theme {
  try {
    return storage?.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function writeTheme(storage: KV | null, t: Theme): void {
  try {
    storage?.setItem(THEME_KEY, t);
  } catch {
    /* private mode — preference just won't persist */
  }
}

export const THEME_COLOR: Record<Theme, string> = { dark: '#0A0F1E', light: '#F4F7FB' };

export function applyTheme(doc: Document, t: Theme): void {
  if (t === 'light') doc.documentElement.setAttribute('data-theme', 'light');
  else doc.documentElement.removeAttribute('data-theme');
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[t]);
}
