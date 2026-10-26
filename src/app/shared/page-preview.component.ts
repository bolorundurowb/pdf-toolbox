import { Component, HostListener, input, output } from '@angular/core';
import { PageThumbComponent } from './page-thumb.component';

/** Large single-page preview, opened from a page grid tile. */
@Component({
  selector: 'app-page-preview',
  imports: [PageThumbComponent],
  template: `
    <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-6 animate-fade-in"
         (click)="close.emit()">
      <div class="bg-surface rounded-2xl shadow-2xl p-4 max-w-[min(92vw,64rem)] max-h-[92vh] flex flex-col gap-3"
           role="dialog" aria-modal="true" aria-label="Page preview" (click)="$event.stopPropagation()">
        <div class="flex items-center justify-between gap-4 px-1">
          <p class="text-body-md font-medium text-on-surface">Page {{ page() }}</p>
          <button type="button" autofocus (click)="close.emit()" aria-label="Close preview" title="Close"
                  class="w-8 h-8 grid place-items-center rounded-lg text-on-surface-variant hover:bg-surface-container">
            <span aria-hidden="true" class="material-symbols-outlined icon-sm">close</span>
          </button>
        </div>
        <div class="min-h-0 overflow-auto custom-scrollbar rounded-lg bg-white">
          <app-page-thumb class="block w-[min(80vw,48rem)]" [path]="path()" [page]="page()" [rotate]="rotate()" [width]="900" />
        </div>
      </div>
    </div>
  `,
})
export class PagePreviewComponent {
  readonly path = input.required<string>();
  readonly page = input.required<number>();
  readonly rotate = input(0);
  readonly close = output<void>();

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.close.emit();
  }
}
