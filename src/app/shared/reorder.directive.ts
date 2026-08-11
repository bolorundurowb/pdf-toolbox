import { Directive, ElementRef, inject, input, output, signal } from '@angular/core';

export interface ReorderEvent {
  from: number;
  to: number;
}

/**
 * A private drag type. Checking for it lets the directive ignore drags that
 * didn't come from a sibling item — notably files dragged in from the OS.
 */
const REORDER_MIME = 'application/x-pdf-toolbox-reorder';

type Side = 'before' | 'after';

/**
 * Drag-to-reorder for a list or grid of items.
 *
 * Apply to each item with its index. The critical detail is the
 * `dataTransfer.setData` call in `dragstart`: without it WebKit (the Tauri
 * webview on macOS) and Firefox refuse to start the drag at all, which is why
 * reordering silently did nothing before.
 *
 * Also provides a drop indicator and keyboard reordering (Ctrl/Cmd + arrows),
 * neither of which the previous hand-rolled handlers had.
 */
@Directive({
  selector: '[appReorderItem]',
  host: {
    '[attr.draggable]': 'disabled() ? null : "true"',
    // Focusability is left to the host component: a disabled (non-draggable) item
    // may still need to be focusable for other reasons, as select-mode tiles are.
    '[attr.aria-grabbed]': 'dragging() ? "true" : null',
    '[class.opacity-40]': 'dragging()',
    '[class.reorder-drop-before]': 'side() === "before"',
    '[class.reorder-drop-after]': 'side() === "after"',
    '[class.reorder-list]': 'axis() === "list"',
    '(dragstart)': 'onDragStart($event)',
    '(dragend)': 'onDragEnd()',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'onDragLeave($event)',
    '(drop)': 'onDrop($event)',
    '(keydown)': 'onKeyDown($event)',
  },
})
export class ReorderItemDirective {
  /** 0-based position of this item in the collection. */
  readonly index = input.required<number>({ alias: 'appReorderItem' });
  /** Grids move by rows as well as columns; lists only need left/right. */
  readonly axis = input<'grid' | 'list'>('list', { alias: 'appReorderAxis' });
  /** Items per row, used for the vertical keyboard shortcuts in grid mode. */
  readonly columns = input(1, { alias: 'appReorderColumns' });
  readonly total = input(0, { alias: 'appReorderTotal' });
  readonly disabled = input(false, { alias: 'appReorderDisabled' });

  readonly reorder = output<ReorderEvent>({ alias: 'appReorder' });

  protected readonly dragging = signal(false);
  protected readonly side = signal<Side | null>(null);

  private readonly host = inject(ElementRef<HTMLElement>);

  protected onDragStart(e: DragEvent): void {
    if (this.disabled() || !e.dataTransfer) return;
    // Both types are set: the private one identifies the drag as ours, the
    // text/plain fallback is what some engines require to begin a drag.
    e.dataTransfer.setData(REORDER_MIME, String(this.index()));
    // A text/plain entry is what some engines need to begin a drag at all. Use the
    // visible label rather than the index so an accidental drop onto a text input
    // pastes something meaningful instead of a bare number.
    e.dataTransfer.setData('text/plain', this.host.nativeElement.textContent?.trim() ?? '');
    e.dataTransfer.effectAllowed = 'move';
    this.dragging.set(true);
  }

  protected onDragEnd(): void {
    this.dragging.set(false);
    this.side.set(null);
  }

  protected onDragOver(e: DragEvent): void {
    if (this.disabled() || !this.isOurs(e)) return;
    // Without preventDefault the element is not a valid drop target.
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    this.side.set(this.sideOf(e));
  }

  protected onDragLeave(e: DragEvent): void {
    // Ignore the leave events fired when crossing into a child element.
    const to = e.relatedTarget as Node | null;
    if (to && this.host.nativeElement.contains(to)) return;
    this.side.set(null);
  }

  protected onDrop(e: DragEvent): void {
    if (this.disabled() || !this.isOurs(e)) return;
    e.preventDefault();
    e.stopPropagation();

    const side = this.sideOf(e);
    this.side.set(null);
    this.dragging.set(false);

    const raw = e.dataTransfer?.getData(REORDER_MIME) ?? '';
    const from = Number.parseInt(raw, 10);
    if (!Number.isInteger(from)) return;

    // Dropping after an item means landing on the following slot, except when
    // the item is being moved forwards — removing it first shifts the target.
    let to = side === 'after' ? this.index() + 1 : this.index();
    if (from < to) to -= 1;
    if (from === to) return;

    this.reorder.emit({ from, to });
  }

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

  private isOurs(e: DragEvent): boolean {
    return !!e.dataTransfer?.types.includes(REORDER_MIME);
  }

  private sideOf(e: DragEvent): Side {
    const box = this.host.nativeElement.getBoundingClientRect();
    return this.axis() === 'grid'
      ? (e.clientX < box.left + box.width / 2 ? 'before' : 'after')
      : (e.clientY < box.top + box.height / 2 ? 'before' : 'after');
  }
}

/** Applies a `{ from, to }` move to a copy of `items`. */
export function applyReorder<T>(items: readonly T[], { from, to }: ReorderEvent): T[] {
  if (from === to || from < 0 || from >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(Math.min(Math.max(0, to), next.length), 0, moved);
  return next;
}
