/** Context object and types — kept separate from the provider for Fast Refresh. */
import { createContext } from 'react';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive (delete, cancel, stop). */
  danger?: boolean;
}

export interface PromptOptions {
  title?: string;
  message: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Minimum trimmed length before the confirm button is enabled. */
  minLength?: number;
  danger?: boolean;
}

export interface ConfirmContextValue {
  /** Resolves true when the user confirms, false on cancel / Escape / backdrop. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Resolves the trimmed text, or null on cancel. */
  promptText: (opts: PromptOptions) => Promise<string | null>;
}

export const ConfirmContext = createContext<ConfirmContextValue | null>(null);
