import { Component, OnDestroy, computed, signal } from '@angular/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { PdfService } from '../../core/pdf.service';
import { createRunner } from '../../core/runner';
import { InputFile } from '../../core/models';
import { formatBytes, pluralize } from '../../core/format';
import { ProcessStatusComponent } from '../../shared/process-status.component';
import { ReorderEvent, ReorderItemDirective, applyReorder } from '../../shared/reorder.directive';

/**
 * A queued file. The synthetic `key` exists because the same PDF may legitimately
 * be added twice, and tracking `@for` by path would then collide.
 */
interface MergeItem extends InputFile {
  key: number;
}

/**
 * Merges several PDFs into one.
 *
 * Splitting used to share this page behind a tab that was easy to miss — it now
 * lives on the Extract page, where page selection already happens.
 */
@Component({
  selector: 'app-merge',
  imports: [ProcessStatusComponent, ReorderItemDirective],
  templateUrl: './merge.component.html',
})
export class MergeComponent implements OnDestroy {
  readonly fmtBytes = formatBytes;
  readonly runner = createRunner();

  readonly files = signal<MergeItem[]>([]);
  readonly optimize = signal(false);
  readonly outputName = signal('');
  readonly dropActive = signal(false);

  private unlistenDrop?: UnlistenFn;
  private nextKey = 1;

  readonly okFiles = computed(() => this.files().filter((f) => !f.error));
  readonly totalSize = computed(() => this.okFiles().reduce((a, f) => a + f.size, 0));
  readonly totalPages = computed(() => this.okFiles().reduce((a, f) => a + (f.pages ?? 0), 0));
  readonly canRun = computed(() => this.okFiles().length >= 2);

  constructor(public readonly pdf: PdfService) {
    void this.listenForFileDrops();
  }

  /** Accepts PDFs dragged in from the OS, which the dropzone always promised. */
  private async listenForFileDrops(): Promise<void> {
    try {
      this.unlistenDrop = await getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === 'enter' || payload.type === 'over') {
          this.dropActive.set(true);
        } else if (payload.type === 'leave') {
          this.dropActive.set(false);
        } else {
          this.dropActive.set(false);
          void this.ingest(payload.paths.filter((p) => /\.pdf$/i.test(p)));
        }
      });
    } catch {
      // Outside the Tauri shell (e.g. `ng serve` in a browser) there is no
      // native drag-and-drop; the click-to-browse path still works.
    }
  }

  async addFiles(): Promise<void> {
    await this.ingest(await this.pdf.pickPdfs(true));
  }

  private async ingest(paths: string[]): Promise<void> {
    if (!paths.length) return;
    const inspected = await this.pdf.inspect(paths);
    const added = inspected
      .filter((f) => f.kind === 'pdf')
      .map((f) => ({ ...f, key: this.nextKey++ }));
    this.files.update((cur) => [...cur, ...added]);
  }

  remove(i: number): void {
    this.files.update((cur) => cur.filter((_, x) => x !== i));
  }

  clearAll(): void {
    this.files.set([]);
  }

  onReorder(event: ReorderEvent): void {
    this.files.update((cur) => applyReorder(cur, event));
  }

  fileMeta(f: InputFile): string {
    return `${f.pages != null ? pluralize(f.pages, 'page') : '— pages'} • ${formatBytes(f.size)}`;
  }

  async process(): Promise<void> {
    if (!this.canRun()) return;
    const outDir = await this.pdf.defaultOutputDir();
    const paths = this.okFiles().map((f) => f.path);
    await this.runner.run((op) =>
      this.pdf.mergePdfs(paths, { optimize: this.optimize(), outputName: this.outputName() || undefined }, outDir, op),
    );
  }

  reset(): void {
    this.runner.reset();
    this.files.set([]);
  }

  openResultFolder(): void {
    const r = this.runner.result();
    if (r) void this.pdf.openFolder(r.outDir);
  }

  ngOnDestroy(): void {
    this.unlistenDrop?.();
  }
}
