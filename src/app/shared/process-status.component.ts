import { Component, input, output } from '@angular/core';
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

  readonly fmtBytes = formatBytes;

  /** Outputs aren't all PDFs — text, images and Word files come out of Extract and Convert. */
  iconFor(name: string): string {
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    if (ext === 'txt') return 'article';
    if (ext === 'docx') return 'description';
    if (['png', 'jpg', 'jpeg'].includes(ext)) return 'image';
    return 'picture_as_pdf';
  }
}
