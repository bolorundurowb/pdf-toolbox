import { Component, input } from '@angular/core';

/** Full-panel hint shown while files from the OS are dragged over the window. */
@Component({
  selector: 'app-drop-overlay',
  template: `
    @if (active()) {
      <div class="fixed inset-4 z-50 rounded-3xl border-4 border-dashed border-primary bg-primary/10 backdrop-blur-sm grid place-items-center pointer-events-none animate-fade-in"
           role="status" aria-live="polite">
        <div class="text-center">
          <span class="material-symbols-outlined text-primary icon-4xl">download</span>
          <p class="text-headline-md text-primary mt-2">{{ label() }}</p>
        </div>
      </div>
    }
  `,
})
export class DropOverlayComponent {
  readonly active = input(false);
  readonly label = input('Drop files to add');
}
