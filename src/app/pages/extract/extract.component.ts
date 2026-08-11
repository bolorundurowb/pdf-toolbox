import { Component, OnDestroy, computed, signal } from '@angular/core';
import { PdfService } from '../../core/pdf.service';
import { PdfRenderService } from '../../core/pdf-render.service';
import { createRunner } from '../../core/runner';
import { ExtractImageFormat, InputFile, OperationResult, OutputFile, ProgressPayload } from '../../core/models';
import { formatBytes, pluralize } from '../../core/format';
import { pagesToRangeText, parseRanges, rangesToPages } from '../../core/page-ranges';
import { ProcessStatusComponent } from '../../shared/process-status.component';
import { PageGridComponent, PageTile } from '../../shared/page-grid.component';

/** What the selected pages get turned into. */
export type ExtractMode = 'text' | 'images' | 'pdf' | 'size';

/** Separates pages in the extracted text file, as the old Rust path did. */
const PAGE_BREAK = '\u000C';

@Component({
  selector: 'app-extract',
  imports: [ProcessStatusComponent, PageGridComponent],
  templateUrl: './extract.component.html',
})
export class ExtractComponent implements OnDestroy {
  readonly fmtBytes = formatBytes;
  readonly runner = createRunner();

  readonly file = signal<InputFile | null>(null);
  readonly tiles = signal<PageTile[]>([]);
  readonly mode = signal<ExtractMode>('text');
  readonly imageFormat = signal<ExtractImageFormat>('png');
  readonly dpi = signal(150);
  readonly dpis = [72, 150, 300];
  readonly maxSizeMb = signal(25);
  readonly outputName = signal('');

  readonly modes: { id: ExtractMode; label: string; hint: string; icon: string }[] = [
    { id: 'text', label: 'Text', hint: 'Save readable text to a .txt file', icon: 'article' },
    { id: 'images', label: 'Images', hint: 'Render each page to a PNG or JPG', icon: 'image' },
    { id: 'pdf', label: 'New PDF', hint: 'Keep the chosen pages as one PDF', icon: 'picture_as_pdf' },
    { id: 'size', label: 'Split by size', hint: 'Divide the whole file into parts', icon: 'data_usage' },
  ];

  /** Size-splitting works on the whole document, so page choice doesn't apply. */
  readonly usesSelection = computed(() => this.mode() !== 'size');
  readonly totalPages = computed(() => this.tiles().length);
  readonly selectedPages = computed(() => this.tiles().filter((t) => t.selected).map((t) => t.source));
  readonly selectedCount = computed(() => this.selectedPages().length);

  readonly canRun = computed(() => {
    if (!this.file()) return false;
    if (!this.usesSelection()) return this.maxSizeMb() > 0;
    return this.selectedCount() > 0;
  });

  readonly runLabel = computed(() => {
    switch (this.mode()) {
      case 'text': return 'Extract Text';
      case 'images': return 'Export Images';
      case 'pdf': return 'Save Pages as PDF';
      default: return 'Split File';
    }
  });

  readonly doneTitle = computed(() => {
    switch (this.mode()) {
      case 'text': return 'Text extracted';
      case 'images': return 'Pages exported';
      case 'pdf': return 'Pages saved';
      default: return 'PDF split';
    }
  });

  /** Reflects the current selection, and can be typed into to change it. */
  readonly rangeText = signal('');

  constructor(
    public readonly pdf: PdfService,
    private readonly renderer: PdfRenderService,
  ) {}

  setMode(m: ExtractMode): void {
    this.mode.set(m);
  }

  async choose(): Promise<void> {
    const paths = await this.pdf.pickPdfs(false);
    if (!paths.length) return;
    const [f] = await this.pdf.inspect(paths);
    if (!f) return;
    if (f.error) {
      this.runner.fail(f.error);
      return;
    }
    await this.clearFile();
    this.file.set(f);
    const n = f.pages ?? 0;
    this.tiles.set(
      Array.from({ length: n }, (_, i) => ({ key: i + 1, source: i + 1, rotate: 0, selected: true })),
    );
    this.syncRangeText();
  }

  async clearFile(): Promise<void> {
    const previous = this.file();
    this.file.set(null);
    this.tiles.set([]);
    this.rangeText.set('');
    if (previous) await this.renderer.dispose(previous.path);
  }

  /* ----------------------------- selection ------------------------------- */

  toggle(index: number): void {
    this.tiles.update((arr) => arr.map((t, i) => (i === index ? { ...t, selected: !t.selected } : t)));
    this.syncRangeText();
  }

  selectAll(on: boolean): void {
    this.tiles.update((arr) => arr.map((t) => ({ ...t, selected: on })));
    this.syncRangeText();
  }

  selectParity(remainder: 0 | 1): void {
    this.tiles.update((arr) => arr.map((t) => ({ ...t, selected: t.source % 2 === remainder })));
    this.syncRangeText();
  }

  invertSelection(): void {
    this.tiles.update((arr) => arr.map((t) => ({ ...t, selected: !t.selected })));
    this.syncRangeText();
  }

  /** Typing a range expression drives the checkboxes. */
  onRangeInput(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.rangeText.set(text);
    const wanted = new Set(rangesToPages(parseRanges(text, this.totalPages())));
    this.tiles.update((arr) => arr.map((t) => ({ ...t, selected: wanted.has(t.source) })));
  }

  private syncRangeText(): void {
    this.rangeText.set(pagesToRangeText(this.selectedPages()));
  }

  /* ------------------------------- running -------------------------------- */

  async run(): Promise<void> {
    const f = this.file();
    if (!f || !this.canRun()) return;
    const outDir = await this.pdf.defaultOutputDir();

    switch (this.mode()) {
      case 'text':
        await this.runner.run((op) => this.writeText(f, outDir, op));
        return;
      case 'images':
        await this.runner.run((op) => this.writeImages(f, outDir, op));
        return;
      case 'pdf':
        await this.runner.run((op) => this.pdf.splitPdf(f.path, {
          mode: 'extract', rangeText: this.rangeText(), maxSizeMb: this.maxSizeMb(),
          selectedPages: this.selectedPages(), outputName: this.outputName() || undefined,
        }, outDir, op));
        return;
      case 'size':
        await this.runner.run((op) => this.pdf.splitPdf(f.path, {
          mode: 'size', rangeText: '', maxSizeMb: this.maxSizeMb(),
          selectedPages: [], outputName: this.outputName() || undefined,
        }, outDir, op));
        return;
    }
  }

  /** Reads text page by page through pdf.js and writes a single .txt file. */
  private async writeText(f: InputFile, outDir: string, op: (p: ProgressPayload) => void): Promise<OperationResult> {
    const pages = this.selectedPages();
    const chunks: string[] = [];
    const skipped: number[] = [];

    for (const [i, page] of pages.entries()) {
      op({ processed: i, total: pages.length, message: `Reading page ${page}` });
      try {
        chunks.push(await this.renderer.pageText(f.path, page));
      } catch {
        // One unreadable page shouldn't cost the user the whole extraction.
        skipped.push(page);
        chunks.push(`[Page ${page} could not be read]`);
      }
    }

    if (skipped.length === pages.length) throw new Error('None of the selected pages could be read.');

    const text = chunks.map((c) => (c.endsWith('\n') ? c : `${c}\n`)).join(PAGE_BREAK);
    op({ processed: pages.length, total: pages.length, message: 'Writing text file…' });
    const written = await this.pdf.writeOutput(outDir, `${this.baseName(f)}.txt`, text);

    return { files: [{ ...written, badge: skippedBadge(skipped) }], outDir };
  }

  /** Renders each selected page at the chosen DPI and writes one image per page. */
  private async writeImages(f: InputFile, outDir: string, op: (p: ProgressPayload) => void): Promise<OperationResult> {
    const pages = this.selectedPages();
    const format = this.imageFormat();
    const files: OutputFile[] = [];
    const skipped: number[] = [];

    for (const [i, page] of pages.entries()) {
      op({ processed: i, total: pages.length, message: `Rendering page ${page}` });
      try {
        const bytes = await this.renderer.renderToBytes(f.path, page, this.dpi(), format);
        files.push(await this.pdf.writeOutput(outDir, `${this.baseName(f)}_page_${page}.${format}`, bytes));
      } catch {
        // Keep the pages that did render rather than discarding the whole run.
        skipped.push(page);
      }
    }

    if (files.length === 0) throw new Error('None of the selected pages could be rendered.');

    op({ processed: pages.length, total: pages.length, message: 'Done' });
    const badge = skippedBadge(skipped);
    return { files: badge ? [{ ...files[0], badge }, ...files.slice(1)] : files, outDir };
  }

  private baseName(f: InputFile): string {
    const custom = this.outputName().trim().replace(/\.(pdf|txt|png|jpe?g)$/i, '');
    if (custom) return custom;
    return f.name.replace(/\.pdf$/i, '') || 'Document';
  }

  summary(): string {
    if (!this.usesSelection()) return 'Whole document';
    return `${pluralize(this.selectedCount(), 'page')} of ${this.totalPages()}`;
  }

  async reset(): Promise<void> {
    this.runner.reset();
    await this.clearFile();
  }

  openResultFolder(): void {
    const r = this.runner.result();
    if (r) void this.pdf.openFolder(r.outDir);
  }

  ngOnDestroy(): void {
    const f = this.file();
    if (f) void this.renderer.dispose(f.path);
  }
}

/** Surfaces partial failures on the results panel instead of hiding them. */
function skippedBadge(skipped: readonly number[]): string | undefined {
  if (skipped.length === 0) return undefined;
  return `${skipped.length} page${skipped.length === 1 ? '' : 's'} skipped`;
}
