import { Component, input, output } from '@angular/core';

/**
 * The one dashed file area used by every tool. Keyboard reachable as a button:
 * Enter and Space open the file chooser, just like a click.
 */
@Component({
  selector: 'app-file-drop-zone',
  template: `
    <div
      role="button"
      tabindex="0"
      (click)="choose.emit()"
      (keydown.enter)="activate($event)"
      (keydown.space)="activate($event)"
      class="rounded-xl border-2 border-dashed transition-colors cursor-pointer group flex flex-col items-center justify-center text-center"
      [class]="active()
        ? 'border-primary bg-primary/5'
        : 'border-outline-variant hover:border-primary/60 hover:bg-primary/5'"
      [class.p-6]="compact()"
      [class.p-10]="!compact()"
    >
      <div class="bg-primary/10 text-primary rounded-full flex items-center justify-center group-hover:scale-110 transition-transform"
           [class.w-12]="compact()" [class.h-12]="compact()" [class.mb-3]="compact()"
           [class.w-16]="!compact()" [class.h-16]="!compact()" [class.mb-4]="!compact()">
        <span aria-hidden="true" class="material-symbols-outlined" [class.icon-lg]="compact()" [class.icon-2xl]="!compact()">{{ icon() }}</span>
      </div>
      <p class="text-headline-md text-on-surface">{{ title() }}</p>
      <p class="text-body-md text-on-surface-variant mt-1">{{ hint() }}</p>
      <span class="mt-4 bg-primary text-on-primary px-5 py-2 rounded-lg font-label-md">Choose files</span>
    </div>
  `,
})
export class FileDropZoneComponent {
  readonly title = input('Drag and drop files here');
  readonly hint = input('or choose files from your computer');
  readonly icon = input('cloud_upload');
  readonly active = input(false);
  readonly compact = input(false);
  readonly choose = output<void>();

  protected activate(event: Event): void {
    event.preventDefault();
    this.choose.emit();
  }
}
