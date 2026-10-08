import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps keyboard focus inside a dialog while it is open and gives it back to
 * whatever opened it on close. Without this, Tab walks into the page behind
 * the dialog and a screen-reader/keyboard user loses their place.
 * Focus lands on `[data-autofocus]` if present, else the first focusable
 * element, else the container itself.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const opener = document.activeElement as HTMLElement | null;

    /* "Visible" = not inside a [hidden] subtree. (offsetParent/getClientRects are
       unreliable here: null for position:fixed boxes and absent in jsdom.) */
    const items = () =>
      Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[hidden]'));

    if (!root.contains(document.activeElement)) {
      const first = root.querySelector<HTMLElement>('[data-autofocus]') ?? items()[0];
      if (first) first.focus();
      else {
        root.setAttribute('tabindex', '-1');
        root.focus();
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = items();
      if (!list.length) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const cur = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (cur === first || !root.contains(cur))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (cur === last || !root.contains(cur))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [ref, active]);
}
