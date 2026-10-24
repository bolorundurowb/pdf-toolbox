import { Directive, ElementRef, OnDestroy, inject, input, output, signal } from '@angular/core';

export interface ReorderEvent {
  from: number;
  to: number;
}

type Side = 'before' | 'after';

/** Pixels the pointer must travel before a press turns into a drag. */
const DRAG_THRESHOLD = 5;
/** Distance from a scroll container's edge at which auto-scroll kicks in. */
const EDGE = 48;
const MAX_SCROLL_STEP = 18;
/** Presses on these never start a drag, so buttons inside a tile keep working. */
const INTERACTIVE = 'button, a, input, select, textarea, label, [contenteditable="true"]';

/** Host element → directive, so hit-testing under the pointer finds its item. */
const registry = new WeakMap<Element, ReorderItemDirective>();

/**
 * Drag-to-reorder for a list or grid of items.
 *
 * Built on pointer events rather than HTML5 drag-and-drop on purpose: on Windows,
 * Tauri's native file-drop handler (`dragDropEnabled`, on by default and needed
 * for dropping files in from the OS) replaces WebView2's drop handler, so HTML5
 * `dragover`/`drop` events never reach the page and reordering silently did
 * nothing. Pointer events are unaffected, behave the same on every platform, and
 * leave OS file drops working.
 *
 * Also provides a drop indicator, a floating preview, edge auto-scroll, Escape
 * to cancel, and keyboard reordering (Ctrl/Cmd + arrows).
 */
@Directive({
  selector: '[appReorderItem]',
  host: {
    'data-reorder-item': '',
    '[attr.aria-roledescription]': 'disabled() ? null : "sortable item"',
    '[class.opacity-40]': 'dragging()',
    '[class.select-none]': '!disabled()',
    '[style.touch-action]': 'disabled() ? null : "none"',
    '[class.reorder-drop-before]': 'side() === "before"',
    '[class.reorder-drop-after]': 'side() === "after"',
    '[class.reorder-list]': 'axis() === "list"',
    '(pointerdown)': 'onPointerDown($event)',
    '(keydown)': 'onKeyDown($event)',
  },
})
export class ReorderItemDirective implements OnDestroy {
  /** 0-based position of this item in the collection. */
  readonly index = input.required<number>({ alias: 'appReorderItem' });
  /** Grids move by rows as well as columns; lists only need up/down. */
  readonly axis = input<'grid' | 'list'>('list', { alias: 'appReorderAxis' });
  /** Items per row, used for the vertical keyboard shortcuts in grid mode. */
  readonly columns = input(1, { alias: 'appReorderColumns' });
  readonly total = input(0, { alias: 'appReorderTotal' });
  readonly disabled = input(false, { alias: 'appReorderDisabled' });

  readonly reorder = output<ReorderEvent>({ alias: 'appReorder' });

  protected readonly dragging = signal(false);
  /** Set on the item currently under the pointer, to draw the drop caret. */
  readonly side = signal<Side | null>(null);

  private readonly host: HTMLElement = inject(ElementRef<HTMLElement>).nativeElement;

  // State for a drag started on this item.
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private active = false;
  private ghost: HTMLElement | null = null;
  private ghostOffsetX = 0;
  private ghostOffsetY = 0;
  private target: ReorderItemDirective | null = null;
  private scroller: HTMLElement | null = null;
  private frame = 0;

  constructor() {
    registry.set(this.host, this);
  }

  ngOnDestroy(): void {
    this.finish(false);
    registry.delete(this.host);
  }

  /* -------------------------------- pointer -------------------------------- */

  protected onPointerDown(e: PointerEvent): void {
    if (this.disabled() || e.button !== 0 || this.pointerId !== null) return;
    const origin = e.target as Element | null;
    const interactive = origin?.closest(INTERACTIVE);
    if (interactive && this.host.contains(interactive) && interactive !== this.host) return;

    this.pointerId = e.pointerId;
    this.startX = this.lastX = e.clientX;
    this.startY = this.lastY = e.clientY;
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
    window.addEventListener('keydown', this.onEscape, true);
    window.addEventListener('blur', this.onCancel);
  }

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.lastX = e.clientX;
    this.lastY = e.clientY;

    if (!this.active) {
      if (Math.hypot(e.clientX - this.startX, e.clientY - this.startY) < DRAG_THRESHOLD) return;
      this.begin();
    }
    e.preventDefault();
    this.moveGhost();
    this.track();
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.finish(true);
  };

  private readonly onCancel = (): void => this.finish(false);

  private readonly onEscape = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.active) return;
    e.preventDefault();
    e.stopPropagation();
    this.finish(false);
  };

  private begin(): void {
    this.active = true;
    this.dragging.set(true);
    // Keep receiving the pointer even if it leaves the window mid-drag, so the
    // release is never lost and the drag can't get stuck.
    try {
      if (this.pointerId !== null) this.host.setPointerCapture(this.pointerId);
    } catch {
      // Synthetic or already-released pointers can't be captured; harmless.
    }
    this.scroller = scrollParent(this.host);
    window.getSelection()?.removeAllRanges();
    document.body.classList.add('reordering');
    this.createGhost();
    this.frame = requestAnimationFrame(this.tick);
  }

  /** Auto-scrolls the nearest scroll container while the pointer hugs its edge. */
  private readonly tick = (): void => {
    if (!this.active) return;
    const el = this.scroller;
    if (el) {
      const box = el.getBoundingClientRect();
      let step = 0;
      if (this.lastY < box.top + EDGE) step = -Math.ceil(((box.top + EDGE - this.lastY) / EDGE) * MAX_SCROLL_STEP);
      else if (this.lastY > box.bottom - EDGE) step = Math.ceil(((this.lastY - (box.bottom - EDGE)) / EDGE) * MAX_SCROLL_STEP);
      if (step !== 0) {
        el.scrollTop += step;
        this.track();
      }
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  /** Finds the sibling item under the pointer and marks which side we'd land on. */
  private track(): void {
    const container = this.host.parentElement;
    if (!container) return;

    const hit = document.elementFromPoint(this.lastX, this.lastY)?.closest('[data-reorder-item]');
    const candidate = hit ? registry.get(hit) : undefined;

    let next: ReorderItemDirective | null = this.target;
    if (candidate && candidate.host.parentElement === container && !candidate.disabled()) {
      next = candidate;
    } else if (!within(container.getBoundingClientRect(), this.lastX, this.lastY)) {
      // Gaps between tiles keep the last target so the caret doesn't flicker;
      // only leaving the list altogether clears it.
      next = null;
    }

    if (next !== this.target) this.target?.side.set(null);
    this.target = next;
    if (next && next !== this) next.side.set(next.sideAt(this.lastX, this.lastY));
  }

  private finish(commit: boolean): void {
    if (this.pointerId === null) return;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onCancel);
    window.removeEventListener('keydown', this.onEscape, true);
    window.removeEventListener('blur', this.onCancel);
    try {
      if (this.host.hasPointerCapture(this.pointerId)) this.host.releasePointerCapture(this.pointerId);
    } catch {
      // Nothing to release.
    }
    this.pointerId = null;

    if (!this.active) return;
    // Auto-scroll may have moved the list since the last pointer move, so
    // re-check what is under the pointer before deciding where to drop.
    if (commit) this.track();
    this.active = false;
    cancelAnimationFrame(this.frame);
    this.dragging.set(false);
    document.body.classList.remove('reordering');
    this.ghost?.remove();
    this.ghost = null;

    const target = this.target;
    const side = target?.side() ?? null;
    target?.side.set(null);
    this.target = null;

    // The release would otherwise click whatever sits under the pointer.
    swallowNextClick();

    if (!commit || !target || target === this || !side) return;
    const from = this.index();
    // Dropping after an item means landing on the following slot, except when
    // the item is moved forwards — removing it first shifts the target down.
    let to = side === 'after' ? target.index() + 1 : target.index();
    if (from < to) to -= 1;
    if (from !== to) this.reorder.emit({ from, to });
  }

  /* --------------------------------- ghost --------------------------------- */

  private createGhost(): void {
    const box = this.host.getBoundingClientRect();
    const ghost = this.host.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('data-reorder-item');
    ghost.removeAttribute('id');
    ghost.classList.remove('opacity-40', 'reorder-drop-before', 'reorder-drop-after');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.tabIndex = -1;
    Object.assign(ghost.style, {
      position: 'fixed',
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      margin: '0',
      pointerEvents: 'none',
      zIndex: '9999',
      opacity: '0.9',
      boxShadow: '0 12px 32px -8px rgba(0, 0, 0, 0.25)',
      transition: 'none',
      willChange: 'transform',
    } satisfies Partial<CSSStyleDeclaration>);
    this.ghostOffsetX = this.startX - box.left;
    this.ghostOffsetY = this.startY - box.top;
    document.body.appendChild(ghost);
    this.ghost = ghost;
    this.moveGhost();
  }

  private moveGhost(): void {
    if (!this.ghost) return;
    const box = this.host.getBoundingClientRect();
    const dx = this.lastX - this.ghostOffsetX - parseFloat(this.ghost.style.left);
    const dy = this.lastY - this.ghostOffsetY - parseFloat(this.ghost.style.top);
    // Keep the ghost's size in step with the source in case the layout reflows.
    this.ghost.style.width = `${box.width}px`;
    this.ghost.style.transform = `translate(${dx}px, ${dy}px) rotate(1deg)`;
  }

  /* ------------------------------- keyboard -------------------------------- */

  protected onKeyDown(e: KeyboardEvent): void {
    if (this.disabled() || !(e.ctrlKey || e.metaKey)) return;

    const step = this.stepFor(e.key);
    if (step === 0) return;

    const from = this.index();
    const to = Math.min(Math.max(0, from + step), Math.max(0, this.total() - 1));
    if (to === from) return;

    e.preventDefault();
    // `@for` tracks by a stable key, so the moved element is reused and keeps
    // focus by itself. Moving focus manually here would race change detection and
    // land on the wrong tile.
    this.reorder.emit({ from, to });
  }

  private stepFor(key: string): number {
    const grid = this.axis() === 'grid';
    const cols = Math.max(1, this.columns());
    switch (key) {
      // A vertical list has no meaningful left/right, so only up/down move rows.
      case 'ArrowLeft':
        return grid ? -1 : 0;
      case 'ArrowRight':
        return grid ? 1 : 0;
      case 'ArrowUp':
        return grid ? -cols : -1;
      case 'ArrowDown':
        return grid ? cols : 1;
      default:
        return 0;
    }
  }

  private sideAt(x: number, y: number): Side {
    const box = this.host.getBoundingClientRect();
    return this.axis() === 'grid'
      ? (x < box.left + box.width / 2 ? 'before' : 'after')
      : (y < box.top + box.height / 2 ? 'before' : 'after');
  }
}

function within(box: DOMRect, x: number, y: number): boolean {
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

/** Nearest ancestor that scrolls vertically, if any. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** Cancels the click a browser fires after a drag ends on a clickable element. */
function swallowNextClick(): void {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  // If no click follows (pointer released elsewhere), don't eat a later one.
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
}

/** Applies a `{ from, to }` move to a copy of `items`. */
export function applyReorder<T>(items: readonly T[], { from, to }: ReorderEvent): T[] {
  if (from === to || from < 0 || from >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(Math.min(Math.max(0, to), next.length), 0, moved);
  return next;
}
