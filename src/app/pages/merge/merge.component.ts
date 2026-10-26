import { Component, OnInit, computed, signal } from '@angular/core';
import { PdfService } from '../../core/pdf.service';
import { createRunner } from '../../core/runner';
import { InputFile } from '../../core/models';
import { formatBytes, pluralize } from '../../core/format';
import { SettingsService } from '../../core/settings.service';
import { RecentInputsService } from '../../core/recent-inputs.service';
import { ProcessStatusComponent } from '../../shared/process-status.component';
import { DropOverlayComponent } from '../../shared/drop-overlay.component';
import { ToolPageComponent } from '../../shared/tool-page.component';
import { FileDropZoneComponent } from '../../shared/file-drop-zone.component';
import { PageThumbComponent } from '../../shared/page-thumb.component';
import { PDF_FILE, useFileDrop } from '../../core/file-drop';
import { useShortcuts } from '../../core/shortcuts';
import { mergeSuggestion, outputBase } from '../../core/output-names';
import { routerPaths } from '../../core/tool-nav';
import { parseRanges, rangesToPages } from '../../core/page-ranges';
import { ReorderEvent, ReorderItemDirective, applyReorder } from '../../shared/reorder.directive';

/**
 * A queued file. The synthetic `key` exists because the same PDF may legitimately
 * be added twice, and tracking `@for` by path would then collide.
 */
interface MergeItem extends InputFile {
  key: number;
  /** Optional page range for this input; empty means every page. */
  range: string;
}

/**
 * Merges several PDFs into one.
 *
 * Splitting used to share this page behind a tab that was easy to miss — it now
 * lives on the Extract page, where page selection already happens.
 */
@Component({
  selector: 'app-merge',
  imports: [
    ProcessStatusComponent, ReorderItemDirective, DropOverlayComponent,
    ToolPageComponent, FileDropZoneComponent, PageThumbComponent,
  ],
  templateUrl: './merge.component.html',
})
export class MergeComponent implements OnInit {
  readonly fmtBytes = formatBytes;
  readonly runner = createRunner(() => void this.pdf.cancelJob());

  readonly files = signal<MergeItem[]>([]);
  readonly optimize = signal(false);
  readonly outputName = signal('');
  private nextKey = 1;

  /** Accepts PDFs dragged in from the OS, which the dropzone always promised. */
  readonly dropActive = useFileDrop({
    accept: PDF_FILE,
    onDrop: (paths) => void this.ingestFrom(paths),
    enabled: () => this.runner.stage() === 'idle',
  });

  readonly okFiles = computed(() => this.files().filter((f) => !f.error));
  readonly totalSize = computed(() => this.okFiles().reduce((a, f) => a + f.size, 0));
  readonly totalPages = computed(() => this.okFiles().reduce((a, f) => a + this.pagesFor(f).length, 0));
  readonly canRun = computed(() => this.okFiles().length >= 2);
  readonly suggestedName = computed(() => mergeSuggestion(this.okFiles()));

  constructor(
    public readonly pdf: PdfService,
    private readonly settings: SettingsService,
    private readonly recents: RecentInputsService,
  ) {
    useShortcuts({
      onOpen: () => void this.addFiles(),
      onRun: () => void this.process(),
      enabled: () => this.runner.stage() === 'idle',
      canRun: () => this.canRun(),
    });
  }

  async ngOnInit(): Promise<void> {
    const paths = routerPaths().filter((path) => PDF_FILE.test(path));
    if (paths.length > 0) await this.ingestFrom(paths);
  }

  async addFiles(): Promise<void> {
    await this.runner.attempt(async () => this.ingest(await this.pdf.pickPdfs(true)));
  }

  private async ingestFrom(paths: string[]): Promise<void> {
    await this.runner.attempt(() => this.ingest(paths));
  }

  private async ingest(paths: string[]): Promise<void> {
    if (!paths.length) return;
    const inspected = await this.pdf.inspect(paths);
    const added = inspected
      .filter((f) => f.kind === 'pdf')
      .map((f) => ({ ...f, key: this.nextKey++, range: '' }));
    this.files.update((cur) => [...cur, ...added]);
    this.recents.remember(added);
  }

  remove(i: number): void {
    this.files.update((cur) => cur.filter((_, x) => x !== i));
  }

  clearAll(): void {
    if (this.files().length > 0 && !window.confirm('Remove all files from this list?')) return;
    this.files.set([]);
  }

  onReorder(event: ReorderEvent): void {
    this.files.update((cur) => applyReorder(cur, event));
  }

  setRange(i: number, value: string): void {
    this.files.update((cur) => cur.map((f, x) => (x === i ? { ...f, range: value } : f)));
  }

  /** Page numbers this row will contribute, honouring its range text. */
  pagesFor(f: MergeItem): number[] {
    const count = f.pages ?? 0;
    const text = f.range.trim();
    if (!text) return Array.from({ length: count }, (_, i) => i + 1);
    return rangesToPages(parseRanges(text, count));
  }

  fileMeta(f: MergeItem): string {
    const chosen = this.pagesFor(f).length;
    const pages = f.pages != null ? pluralize(f.pages, 'page') : '— pages';
    const selection = f.range.trim() ? `${chosen} selected · ` : '';
    return `${selection}${pages} • ${formatBytes(f.size)}`;
  }

  async process(): Promise<void> {
    if (!this.canRun()) return;
    const outDir = await this.settings.resolveOutputDir();
    if (!outDir) return;
    const base = outputBase(this.outputName(), this.suggestedName());
    const conflict = await this.settings.resolveConflict(outDir, [`${base}.pdf`]);
    const paths = this.okFiles().map((f) => f.path);
    await this.runner.run((op) =>
      this.pdf.mergePdfs(
        paths,
        {
          optimize: this.optimize(),
          outputName: this.outputName() || undefined,
          pageRanges: this.okFiles().map((f) => f.range.trim()),
          onConflict: conflict,
        },
        outDir, op,
      ),
    );
  }

  reset(): void {
    this.runner.reset();
    this.files.set([]);
    this.outputName.set('');
    this.optimize.set(false);
  }

  openResultFolder(): void {
    const r = this.runner.result();
    if (r?.outDir) void this.pdf.openFolder(r.outDir);
  }
}
