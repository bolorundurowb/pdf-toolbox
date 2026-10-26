import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { PdfService } from '../../core/pdf.service';
import { PdfRenderService } from '../../core/pdf-render.service';
import { createRunner } from '../../core/runner';
import { InputFile, OperationResult, ProgressPayload } from '../../core/models';
import { formatBytes } from '../../core/format';
import { buildDocx, DocxBlock } from '../../core/docx';
import { pageToParagraphs } from '../../core/pdf-text';
import { SettingsService } from '../../core/settings.service';
import { RecentInputsService } from '../../core/recent-inputs.service';
import { ProcessStatusComponent } from '../../shared/process-status.component';
import { DropOverlayComponent } from '../../shared/drop-overlay.component';
import { ToolPageComponent } from '../../shared/tool-page.component';
import { FileDropZoneComponent } from '../../shared/file-drop-zone.component';
import { PDF_FILE, useFileDrop } from '../../core/file-drop';
import { useShortcuts } from '../../core/shortcuts';
import { outputBase, stemOf } from '../../core/output-names';
import { routerPaths } from '../../core/tool-nav';

/**
 * Converts a PDF to an editable Word document (.docx). Text is read locally
 * through pdf.js and laid out as paragraphs and headings, with a page break
 * between each source page. A page with no text is embedded as a picture, so
 * scanned pages stay visible in Word.
 */
@Component({
  selector: 'app-convert',
  imports: [ProcessStatusComponent, DropOverlayComponent, ToolPageComponent, FileDropZoneComponent],
  templateUrl: './convert.component.html',
})
export class ConvertComponent implements OnInit, OnDestroy {
  readonly fmtBytes = formatBytes;
  readonly stemOf = stemOf;
  readonly runner = createRunner(() => void this.pdf.cancelJob());

  readonly file = signal<InputFile | null>(null);
  readonly outputName = signal('');

  /** A PDF dragged in from the OS opens it — only while no file is loaded, so a stray drop can't discard work. */
  readonly dropActive = useFileDrop({
    accept: PDF_FILE,
    onDrop: ([path]) => void this.runner.attempt(() => this.load(path)),
    enabled: () => this.runner.stage() === 'idle' && !this.file(),
  });

  readonly canRun = computed(() => !!this.file() && !this.file()!.error);

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
    this.recents.remember([f]);
  }

  async clearFile(): Promise<void> {
    const previous = this.file();
    this.file.set(null);
    if (previous) await this.renderer.dispose(previous.path);
  }

  async run(): Promise<void> {
    const f = this.file();
    if (!f || !this.canRun()) return;
    const outDir = await this.settings.resolveOutputDir();
    if (!outDir) return;
    const base = outputBase(this.outputName(), stemOf(f.name) || 'Document');
    const conflict = await this.settings.resolveConflict(outDir, [`${base} (Word).docx`]);
    await this.runner.run((op) => this.convert(f, outDir, base, conflict, op));
  }

  private async convert(
    f: InputFile,
    outDir: string,
    base: string,
    conflict: 'keep' | 'overwrite',
    op: (p: ProgressPayload) => void,
  ): Promise<OperationResult> {
    const total = f.pages ?? 0;
    if (total === 0) throw new Error('This PDF has no pages to convert.');

    const blocks: DocxBlock[] = [];
    const skipped: number[] = [];
    let textParagraphs = 0;
    let pictures = 0;

    for (let page = 1; page <= total; page++) {
      if (this.runner.cancelled()) return { files: [], outDir, stopped: true };
      op({ processed: page - 1, total, message: `Reading page ${page}` });
      if (page > 1) blocks.push({ type: 'pageBreak' });

      let pageText = '';
      try {
        const items = await this.renderer.pageTextItems(f.path, page);
        const pageBlocks = pageToParagraphs(items);
        pageText = pageBlocks.map((block) => block.text).join(' ').trim();
        for (const block of pageBlocks) {
          if (block.heading) {
            blocks.push({ type: 'heading', text: block.text, level: block.level });
            if (block.text.trim()) textParagraphs++;
          } else {
            blocks.push({ type: 'paragraph', text: block.text });
            if (block.text.trim()) textParagraphs++;
          }
        }
      } catch {
        // One unreadable page shouldn't cost the user the whole conversion.
        skipped.push(page);
      }

      if (!pageText) {
        // Scanned or image-only page: embed a picture so it stays visible.
        try {
          const bytes = await this.renderer.renderToBytes(f.path, page, 120, 'png');
          const size = pngSize(bytes);
          if (size) {
            blocks.push({ type: 'image', data: bytes, width: size.width, height: size.height });
            pictures++;
          }
        } catch {
          if (!skipped.includes(page)) skipped.push(page);
        }
      }
    }

    if (skipped.length === total) throw new Error('None of the pages could be read.');

    op({ processed: total, total, message: 'Writing Word document…' });
    const bytes = buildDocx(blocks, base);
    const written = await this.pdf.writeOutput(outDir, `${base} (Word).docx`, bytes, conflict);

    // Scanned, image-only PDFs have no text layer; say so rather than hand back
    // a silently empty document.
    const noText = textParagraphs === 0 && pictures === 0;
    const badge = pictures > 0
      ? `${pictures} page${pictures === 1 ? '' : 's'} as pictures`
      : (noText ? 'No text found (scanned?)' : skippedBadge(skipped));
    return { files: [{ ...written, badge }], outDir };
  }

  async reset(): Promise<void> {
    this.runner.reset();
    this.outputName.set('');
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

/** Reads the pixel size from a PNG's IHDR chunk. */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, i) => bytes[i] === value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Surfaces partial failures on the results panel instead of hiding them. */
function skippedBadge(skipped: readonly number[]): string | undefined {
  if (skipped.length === 0) return undefined;
  return `${skipped.length} page${skipped.length === 1 ? '' : 's'} skipped`;
}
