import { Component, input } from '@angular/core';

/**
 * The common shell for every tool page: title, description, a scrolling body
 * with an options column, and a footer action bar.
 *
 * Projected slots: default body, `[tool-options]`, `[tool-summary]`,
 * `[tool-actions]`.
 */
@Component({
  selector: 'app-tool-page',
  template: `
    <div class="flex h-full min-h-0 flex-col">
      <header class="shrink-0 px-6 pt-6 pb-4">
        <h1 class="text-headline-lg text-on-surface">{{ title() }}</h1>
        @if (description()) {
          <p class="text-body-md text-on-surface-variant mt-1">{{ description() }}</p>
        }
      </header>

      <div class="flex-1 min-h-0 flex flex-col @[880px]:flex-row gap-6 px-6 overflow-y-auto custom-scrollbar">
        <div class="flex-1 min-w-0 flex flex-col gap-6 pb-6">
          <ng-content />
        </div>
        <aside class="w-full @[880px]:w-80 shrink-0 flex flex-col gap-6 pb-6">
          <ng-content select="[tool-options]" />
        </aside>
      </div>

      <footer class="shrink-0 border-t border-outline-variant bg-surface-container-low px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0 text-body-md text-on-surface-variant">
          <ng-content select="[tool-summary]" />
        </div>
        <div class="flex flex-wrap items-center justify-end gap-3">
          <ng-content select="[tool-actions]" />
        </div>
      </footer>
    </div>
  `,
})
export class ToolPageComponent {
  readonly title = input.required<string>();
  readonly description = input('');
}
