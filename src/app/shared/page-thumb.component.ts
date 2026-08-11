import {
  Component, ElementRef, OnDestroy, computed, effect, inject, input, signal,
} from '@angular/core';
import { PdfRenderService } from '../core/pdf-render.service';

/**
 * One lazily-rendered PDF page thumbnail.
 *
 * Rendering only starts once the tile scrolls into view and is cancelled if it
 * scrolls back out, so opening a several-hundred-page document doesn't rasterise
 * every page up front.
 */
@Component({
  selector: 'app-page-thumb',
  template: `
    <div class="w-full h-full grid place-items-center overflow-hidden bg-white">
      @if (url(); as src) {
        <img [src]="src" [alt]="'Page ' + page()" draggable="false"
             class="transition-transform duration-150 shadow-sm"
             [style.max-width]="quarterTurn() ? '133.333%' : '100%'"
             [style.max-height]="quarterTurn() ? '75%' : '100%'"
             [style.transform]="'rotate(' + rotate() + 'deg)'" />
      } @else if (failed()) {
        <div class="text-center text-on-surface-variant">
          <span class="material-symbols-outlined icon-lg">broken_image</span>
          <div class="text-[10px] font-mono-sm mt-1">p{{ page() }}</div>
        </div>
      } @else {
        <div class="w-full h-full bg-surface-container animate-pulse grid place-items-center">
          <span class="text-[10px] font-mono-sm text-on-surface-variant">p{{ page() }}</span>
        </div>
      }
    </div>
  `,
})
export class PageThumbComponent implements OnDestroy {
  readonly path = input.required<string>();
  readonly page = input.required<number>();
  /** Rendered bitmap width in CSS pixels. */
  readonly width = input(180);
  /** UI rotation, applied as a transform rather than a re-render. */
  readonly rotate = input(0);

  protected readonly url = signal<string | null>(null);
  protected readonly failed = signal(false);
  protected readonly quarterTurn = computed(() => Math.abs(this.rotate()) % 180 === 90);

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly renderer = inject(PdfRenderService);
  private readonly visible = signal(false);
  private observer?: IntersectionObserver;
  private inFlight?: AbortController;

  constructor() {
    this.watchVisibility();

    effect(() => {
      const path = this.path();
      const page = this.page();
      const width = this.width();
      if (!this.visible()) return;
      void this.load(path, page, width);
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.inFlight?.abort();
  }

  private watchVisibility(): void {
    if (typeof IntersectionObserver === 'undefined') {
      this.visible.set(true);
      return;
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        const on = entries.some((e) => e.isIntersecting);
        this.visible.set(on);
        if (!on) this.inFlight?.abort();
      },
      // The grid lives inside a scrolling panel, so the margin has to be measured
      // against that panel — against the viewport it would have no effect, and
      // tiles would only start rendering once they were already on screen.
      { root: scrollParent(this.host.nativeElement), rootMargin: '300px' },
    );
    this.observer.observe(this.host.nativeElement);
  }

  private async load(path: string, page: number, width: number): Promise<void> {
    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;

    try {
      const thumb = await this.renderer.thumbnail(path, page, width, controller.signal);
      if (!controller.signal.aborted) {
        this.url.set(thumb.url);
        this.failed.set(false);
      }
    } catch {
      // A cancelled render is expected while scrolling; only a real failure
      // should surface the placeholder.
      if (!controller.signal.aborted) this.failed.set(true);
    }
  }
}

/** Nearest ancestor that scrolls, or null to fall back to the viewport. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
  }
  return null;
}
