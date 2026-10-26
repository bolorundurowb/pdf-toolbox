import { DestroyRef, Signal, inject, signal } from '@angular/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { UnlistenFn } from '@tauri-apps/api/event';

export interface FileDropOptions {
  /** Which dropped paths this page can use (matched against the file name). */
  accept: RegExp;
  /** Receives the accepted paths, in the order they were dropped. */
  onDrop: (paths: string[]) => void;
  /** Drops are ignored while this returns false (e.g. mid-operation). */
  enabled?: () => boolean;
}

/**
 * Accepts files dragged in from the OS.
 *
 * Tauri delivers OS drops through its own webview event rather than HTML5 drag
 * events, so each page subscribes here. Must be called in an injection context
 * (a constructor or field initialiser); the listener is removed on destroy.
 *
 * Returns a signal that is true while acceptable files hover over the window,
 * for showing a drop overlay.
 */
export function useFileDrop({ accept, onDrop, enabled = () => true }: FileDropOptions): Signal<boolean> {
  const active = signal(false);
  let unlisten: UnlistenFn | undefined;
  let destroyed = false;

  inject(DestroyRef).onDestroy(() => {
    destroyed = true;
    unlisten?.();
  });

  const matches = (paths: string[]) => paths.filter((p) => accept.test(p));

  try {
    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        switch (payload.type) {
          case 'enter':
            active.set(enabled() && matches(payload.paths).length > 0);
            break;
          case 'over':
            break;
          case 'leave':
            active.set(false);
            break;
          case 'drop': {
            active.set(false);
            const accepted = matches(payload.paths);
            if (enabled() && accepted.length > 0) onDrop(accepted);
            break;
          }
        }
      })
      .then((fn) => {
        if (destroyed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Outside the Tauri shell (e.g. `ng serve` in a browser) there is no
        // native drag-and-drop; click-to-browse still works.
      });
  } catch {
    // Same as above: no Tauri webview available.
  }

  return active.asReadonly();
}

export const PDF_FILE = /\.pdf$/i;
export const IMAGE_FILE = /\.(jpe?g|png|gif|bmp|tiff?|webp|heic|heif)$/i;
