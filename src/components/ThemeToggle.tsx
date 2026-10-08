import { useState } from 'react';
import { Icon } from './ui/Icon';
import { applyTheme, readTheme, writeTheme, type Theme } from '../utils/theme';

const store = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => readTheme(store()));
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="iconbtn"
      aria-label={next === 'light' ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الداكن'}
      title={next === 'light' ? 'وضع فاتح' : 'وضع داكن'}
      onClick={() => {
        setTheme(next);
        writeTheme(store(), next);
        applyTheme(document, next);
      }}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
    </button>
  );
}
