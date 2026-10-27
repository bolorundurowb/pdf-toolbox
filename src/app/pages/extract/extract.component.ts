import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { PdfService } from '../../core/pdf.service';
import { PdfRenderService } from '../../core/pdf-render.service';
import { createRunner } from '../../core/runner';
import { ExtractImageFormat, InputFile, OperationResult, OutputFile, ProgressPayload } from '../../core/models';
import { formatBytes, pluralize } from '../../core/format';
import { pagesToRangeText, parseRanges, rangesToPages } from '../../core/page-ranges';
import { SettingsService } from '../../core/settings.service';
import { RecentInputsService } from '../../core/recent-inputs.service';
import { ProcessStatusComponent } from '../../shared/process-status.component';
import { DropOverlayComponent } from '../../shared/drop-overlay.component';
import { ToolPageComponent } from '../../shared/tool-page.component';
import { FileDropZoneComponent } from '../../shared/file-drop-zone.component';
import { PagePreviewComponent } from '../../shared/page-preview.component';
import { PDF_FILE, useFileDrop } from '../../core/file-drop';
import { PageGridComponent, PageTile } from '../../shared/page-grid.component';
import { useShortcuts } from '../../core/shortcuts';
import { outputBase, stemOf } from '../../core/output-names';
import { routerPaths } from '../../core/tool-nav';

/** What the selected pages get turned into, or how the file is divided. */
export type ExtractMode = 'text' | 'images' | 'pdf' | 'size' | 'every' | 'ranges' | 'bookmarks';

/** Separates pages in the extracted text file, as the old Rust path did. */
const PAGE_BREAK = '\u000C';

@Component({
  selector: 'app-extract',
  imports: [
    ProcessStatusComponent, PageGridComponent, DropOverlayComponent,
    ToolPageComponent, FileDropZoneComponent, PagePreviewComponent,
  ],
  templateUrl: './extract.component.html',
})
export class ExtractComponent implements OnInit, OnDestroy {
  readonly fmtBytes = formatBytes;
  readonly stemOf = stemOf;
  readonly runner = createRunner(() => void this.pdf.cancelJob());

  readonly file = signal<InputFile | null>(null);
  readonly tiles = signal<PageTile[]>([]);
  readonly previewIndex = signal<number | null>(null);
  readonly mode = signal<ExtractMode>('text');
  readonly imageFormat = signal<ExtractImageFormat>('png');
  readonly dpi = signal(150);
  readonly dpis = [72, 150, 300];
  readonly maxSizeMb = signal(25);
  readonly everyPages = signal(5);
  readonly outputName = signal('');
  /** The expression used by the "several files" mode. */
  readonly splitRangeText = signal('1-3, 8, 12-20');

  readonly modes: { id: ExtractMode; label: string; hint: string; icon: string }[] = [
    { id: 'text', label: 'Text', hint: 'Save readable text to a .txt file', icon: 'article' },
    { id: 'images', label: 'Images', hint: 'Render each page to a PNG or JPG', icon: 'image' },
    { id: 'pdf', label: 'New PDF', hint: 'Keep the chosen pages as one PDF', icon: 'picture_as_pdf' },
    { id: 'size', label: 'Split by size', hint: 'Divide the file into parts under a size', icon: 'data_usage' },
    { id: 'every', label: 'Every N pages', hint: 'A new file after every N pages', icon: 'auto_awesome_motion' },
    { id: 'ranges', label: 'Several ranges', hint: 'One file per range expression', icon: 'call_split' },
    { id: 'bookmarks', label: 'By bookmarks', hint: 'One file per chapter in the outline', icon: 'bookmarks' },
  ];

  /** Modes that work on the tiles the user picked. */
  readonly usesSelection = computed(() => ['text', 'images', 'pdf'].includes(this.mode()));
  readonly totalPages = computed(() => this.tiles().length);
  readonly selectedPages = computed(() => this.tiles().filter((t) => t.selected).map((t) => t.source));
  readonly selectedCount = computed(() => this.selectedPages().length);
  readonly extentForLabel = computed(() => pagesToRangeText(this.selectedPages()) || '—');

  readonly canRun = computed(() => {
    if (!this.file()) return false;
    switch (this.mode()) {
      case 'size': return this.maxSizeMb() > 0;
      case 'every': return this.everyPages() >= 1;
      case 'ranges': return parseRanges(this.splitRangeText(), this.totalPages()).length > 0;
      case 'bookmarks': return true;
      default: return this.selectedCount() > 0;
    }
  });

  readonly runLabel = computed(() => {
    switch (this.mode()) {
      case 'text': return 'Extract text';
      case 'images': return 'Export images';
      case 'pdf': return 'Save pages as PDF';
      case 'size': return 'Split by size';
      case 'every': return 'Split every N pages';
      case 'ranges': return 'Split at ranges';
      default: return 'Split by bookmarks';
    }
  });

  readonly doneTitle = computed(() => {
    switch (this.mode()) {
      case 'text': return 'Text extracted';
      case 'images': return 'Pages exported';
      case 'pdf': return 'Pages saved';
      case 'size':
      case 'every':
      case 'ranges':
      case 'bookmarks': return 'PDF split';
    }
  });

  /** A PDF dragged in from the OS opens it — only while no file is loaded, so a stray drop can't discard work. */
  readonly dropActive = useFileDrop({
    accept: PDF_FILE,
    onDrop: ([path]) => void this.runner.attempt(() => this.load(path)),
    enabled: () => this.runner.stage() === 'idle' && !this.file(),
  });

  /** Reflects the current tile selection, and can be typed into to change it. */
  readonly rangeText = signal('');

  constructor(
    public readonly pdf: PdfService,
    private readonly renderer: PdfRenderService,
    private readonly settings: SettingsService,
    private readonly recents: RecentInputsService,
  ) {
    useShortcuts({
      onOpen: () => { if (!this.file()) void this.choose(); },
      onRun: () => void this.run(),
      enabled: () => this.runner.stage() === 'idle',
      canRun: () => this.canRun(),
    });
  }

  async ngOnInit(): Promise<void> {
    const [path] = routerPaths().filter((p) => PDF_FILE.test(p));
    if (path) await this.runner.attempt(() => this.load(path));
  }

  setMode(m: ExtractMode): void {
    this.mode.set(m);
  }

  async choose(): Promise<void> {
    await this.runner.attempt(async () => {
      const [path] = await this.pdf.pickPdfs(false);
      if (path) await this.load(path);
    });
  }

  private async load(path: string): Promise<void> {
    const [f] = await this.pdf.inspect([path]);
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
    this.recents.remember([f]);
  }

  async clearFile(): Promise<void> {
    const previous = this.file();
    this.file.set(null);
    this.tiles.set([]);
    this.rangeText.set('');
    this.previewIndex.set(null);
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
    const outDir = await this.settings.resolveOutputDir();
    if (!outDir) return;

    const base = this.baseName(f);
    const conflict = await this.settings.resolveConflict(outDir, this.expectedNames(f, base));

    switch (this.mode()) {
      case 'text':
        await this.runner.run((op) => this.writeText(f, outDir, conflict, op));
        return;
      case 'images':
        await this.runner.run((op) => this.writeImages(f, outDir, conflict, op));
        return;
      case 'pdf':
        await this.runner.run((op) => this.pdf.splitPdf(f.path, {
          mode: 'extract', rangeText: this.rangeText(), maxSizeMb: this.maxSizeMb(),
          selectedPages: this.selectedPages(), outputName: this.outputName() || undefined,
          onConflict: conflict,
        }, outDir, op));
        return;
      case 'size':
        await this.runner.run((op) => this.pdf.splitPdf(f.path, {
          mode: 'size', rangeText: '', maxSizeMb: this.maxSizeMb(),
          selectedPages: [], outputName: this.outputName() || undefined, onConflict: conflict,
        }, outDir, op));
        return;
      case 'every':
        await this.runner.run((op) => this.pdf.splitPdf(f.path, {
          mode: 'every', rangeText: '', maxSizeMb: this.maxSizeMb(), everyPages: this.everyPages(),
          selectedPages: [], outputName: this.outputName() || undefined, onConflict: conflict,
        }, outDir, op));
        return;
      case 'ranges':
        await this.runner.run((op) => this.pdf.splitPdf(f.path, {
          mode: 'ranges', rangeText: this.splitRangeText(), maxSizeMb: this.maxSizeMb(),
          selectedPages: [], outputName: this.outputName() || undefined, onConflict: conflict,
        }, outDir, op));
        return;
      case 'bookmarks':
        await this.runner.run((op) => this.pdf.splitPdf(f.path, {
          mode: 'bookmarks', rangeText: '', maxSizeMb: this.maxSizeMb(),
          selectedPages: [], outputName: this.outputName() || undefined, onConflict: conflict,
        }, outDir, op));
        return;
    }
  }

  /** Best-effort list of the names the backend will write, for the ask policy. */
  private expectedNames(f: InputFile, base: string): string[] {
    switch (this.mode()) {
      case 'text':
        return [`${base} (text).txt`];
      case 'images':
        return this.selectedPages().map((page) => `${base} (page ${page}).${this.imageFormat()}`);
      case 'pdf':
        return [`${base} (${this.selectedCount() === 1 ? 'page' : 'pages'} ${this.extentForLabel()}).pdf`];
      case 'ranges':
        return parseRanges(this.splitRangeText(), f.pages ?? 0)
          .map(([a, b]) => `${base} (${a === b ? `page ${a}` : `pages ${a}-${b}`}).pdf`);
      case 'every': {
        const total = Math.ceil((f.pages ?? 0) / Math.max(1, this.everyPages()));
        return Array.from({ length: total }, (_, i) => `${base} (part ${i + 1} of ${total}).pdf`);
      }
      default:
        return [];
    }
  }

  /** Reads text page by page through pdf.js and writes a single .txt file. */
  private async writeText(
    f: InputFile,
    outDir: string,
    conflict: 'keep' | 'overwrite',
    op: (p: ProgressPayload) => void,
  ): Promise<OperationResult> {
    const pages = this.selectedPages();
    const chunks: string[] = [];
    const skipped: number[] = [];

    for (const [i, page] of pages.entries()) {
      if (this.runner.cancelled()) return { files: [], outDir, stopped: true };
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
    const written = await this.pdf.writeOutput(outDir, `${this.baseName(f)} (text).txt`, text, conflict);

    // Scanned, image-only PDFs have no text layer; say so rather than hand back
    // a silently empty file.
    const noText = chunks.every((c, i) => skipped.includes(pages[i]) || c.trim() === '');
    return { files: [{ ...written, badge: noText ? 'No text found (scanned?)' : skippedBadge(skipped) }], outDir };
  }

  /** Renders each selected page at the chosen DPI and writes one image per page. */
  private async writeImages(
    f: InputFile,
    outDir: string,
    conflict: 'keep' | 'overwrite',
    op: (p: ProgressPayload) => void,
  ): Promise<OperationResult> {
    const pages = this.selectedPages();
    const format = this.imageFormat();
    const files: OutputFile[] = [];
    const skipped: number[] = [];

    for (const [i, page] of pages.entries()) {
      if (this.runner.cancelled()) return { files, outDir, stopped: true };
      op({ processed: i, total: pages.length, message: `Rendering page ${page}` });
      try {
        const bytes = await this.renderer.renderToBytes(f.path, page, this.dpi(), format);
        files.push(await this.pdf.writeOutput(outDir, `${this.baseName(f)} (page ${page}).${format}`, bytes, conflict));
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
    return outputBase(this.outputName(), stemOf(f.name) || 'Document', /\.(pdf|txt|png|jpe?g)$/i);
  }

  summary(): string {
    switch (this.mode()) {
      case 'size': return `Whole document · max ${this.maxSizeMb()} MB per part`;
      case 'every': return `Whole document · a file every ${pluralize(this.everyPages(), 'page')}`;
      case 'ranges': return this.splitRangeText() || 'Enter ranges';
      case 'bookmarks': return 'One file per bookmark';
      default: return `${pluralize(this.selectedCount(), 'page')} of ${this.totalPages()}`;
    }
  }

  async reset(): Promise<void> {
    this.runner.reset();
    await this.clearFile();
  }

  openResultFolder(): void {
    const r = this.runner.result();
    if (r?.outDir) void this.pdf.openFolder(r.outDir);
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
