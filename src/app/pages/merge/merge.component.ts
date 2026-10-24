import { Component, computed, signal } from '@angular/core';
import { PdfService } from '../../core/pdf.service';
import { createRunner } from '../../core/runner';
import { InputFile } from '../../core/models';
import { formatBytes, pluralize } from '../../core/format';
import { ProcessStatusComponent } from '../../shared/process-status.component';
import { DropOverlayComponent } from '../../shared/drop-overlay.component';
import { PDF_FILE, useFileDrop } from '../../core/file-drop';
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
  imports: [ProcessStatusComponent, ReorderItemDirective, DropOverlayComponent],
  templateUrl: './merge.component.html',
})
export class MergeComponent {
  readonly fmtBytes = formatBytes;
  readonly runner = createRunner();

  readonly files = signal<MergeItem[]>([]);
  readonly optimize = signal(false);
  readonly outputName = signal('');
  private nextKey = 1;

  /** Accepts PDFs dragged in from the OS, which the dropzone always promised. */
  readonly dropActive = useFileDrop({
    accept: PDF_FILE,
    onDrop: (paths) => void this.runner.attempt(() => this.ingest(paths)),
    enabled: () => this.runner.stage() === 'idle',
  });

  readonly okFiles = computed(() => this.files().filter((f) => !f.error));
  readonly totalSize = computed(() => this.okFiles().reduce((a, f) => a + f.size, 0));
  readonly totalPages = computed(() => this.okFiles().reduce((a, f) => a + (f.pages ?? 0), 0));
  readonly canRun = computed(() => this.okFiles().length >= 2);

  constructor(public readonly pdf: PdfService) {}

  async addFiles(): Promise<void> {
    await this.runner.attempt(async () => this.ingest(await this.pdf.pickPdfs(true)));
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
}
