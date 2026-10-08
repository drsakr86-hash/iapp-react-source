import { useContext } from 'react';
import {
  ConfirmContext,
  type ConfirmContextValue,
} from '../contexts/confirm-context';

/**
 * Falls back to the browser's native dialogs when no <ConfirmProvider> is
 * mounted (the headless test harnesses render single components without the
 * full provider tree). In the real app the provider is always present.
 */
const NATIVE: ConfirmContextValue = {
  confirm: async ({ message }) => window.confirm(message),
  promptText: async ({ message, minLength = 1 }) => {
    const v = window.prompt(message);
    return v && v.trim().length >= minLength ? v.trim() : null;
  },
};

export function useConfirm(): ConfirmContextValue {
  return useContext(ConfirmContext) ?? NATIVE;
}
