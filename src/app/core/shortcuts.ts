import { DestroyRef, inject } from '@angular/core';

export interface ShortcutOptions {
  /** Ctrl/Cmd+O — the page's add or choose action. */
  onOpen?: () => void;
  /** Ctrl/Cmd+Enter — the page's primary action. */
  onRun?: () => void;
  /** Only while the tool is idle. */
  enabled: () => boolean;
  /** The primary action must be enabled, not merely present. */
  canRun?: () => boolean;
}

/**
 * Registers one window-level key listener per page for the two app shortcuts.
 * Keystrokes inside an input, textarea, select or contenteditable are left
 * alone, as are combinations with other modifiers.
 */
export function useShortcuts(options: ShortcutOptions): void {
  const handler = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    if (!options.enabled()) return;

    const target = event.target as HTMLElement | null;
    if (target && isTypingTarget(target)) return;

    if (event.key.toLowerCase() === 'o' && options.onOpen) {
      event.preventDefault();
      options.onOpen();
      return;
    }
    if (event.key === 'Enter' && options.onRun) {
      if (options.canRun && !options.canRun()) return;
      event.preventDefault();
      options.onRun();
    }
  };

  window.addEventListener('keydown', handler);
  inject(DestroyRef).onDestroy(() => window.removeEventListener('keydown', handler));
}

function isTypingTarget(target: HTMLElement): boolean {
  const tag = target.tagName;
  return tag === 'INPUT'
    || tag === 'TEXTAREA'
    || tag === 'SELECT'
    || target.isContentEditable;
}
