import { Component, computed, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { OperationResult } from '../core/models';
import { formatBytes } from '../core/format';

/** Shared processing / done / error panel used by every tool page. */
@Component({
  selector: 'app-process-status',
  templateUrl: './process-status.component.html',
})
export class ProcessStatusComponent {
  readonly stage = input.required<'processing' | 'done' | 'error'>();
  readonly progress = input(0);
  readonly message = input('');
  readonly result = input<OperationResult | null>(null);
  readonly error = input<string | null>(null);
  readonly doneTitle = input('Done');
  readonly icon = input('picture_as_pdf');

  readonly reset = output<void>();
  /** Returns to the form from the error panel, keeping the user's inputs. */
  readonly back = output<void>();
  readonly openFolder = output<void>();
  readonly openFile = output<string>();
  readonly cancel = output<void>();

  private readonly router = inject(Router);

  readonly fmtBytes = formatBytes;

  readonly stopped = computed(() => this.result()?.stopped === true);
  readonly savedCount = computed(() => this.result()?.files.length ?? 0);

  /** Outputs aren't all PDFs — text, images and Word files come out of Extract and Convert. */
  iconFor(name: string): string {
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    if (ext === 'txt') return 'article';
    if (ext === 'docx') return 'description';
    if (['png', 'jpg', 'jpeg'].includes(ext)) return 'image';
    return 'picture_as_pdf';
  }

  isPdf(name: string): boolean {
    return name.toLowerCase().endsWith('.pdf');
  }

  /** Tools that can take a PDF as their input. */
  readonly handoffTools: { route: string; label: string }[] = [
    { route: '/compress', label: 'Compress' },
    { route: '/organize', label: 'Organise' },
    { route: '/extract', label: 'Extract' },
    { route: '/convert', label: 'Convert' },
    { route: '/security', label: 'Security' },
    { route: '/metadata', label: 'Metadata' },
  ];

  protected chooseTool(event: Event, path: string): void {
    const select = event.target as HTMLSelectElement;
    const route = select.value;
    select.value = '';
    if (route) void this.router.navigate([route], { state: { paths: [path] } });
  }
}
