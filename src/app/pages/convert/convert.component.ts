import { Component, OnDestroy, computed, signal } from '@angular/core';
import { PdfService } from '../../core/pdf.service';
import { PdfRenderService } from '../../core/pdf-render.service';
import { createRunner } from '../../core/runner';
import { InputFile, OperationResult, ProgressPayload } from '../../core/models';
import { formatBytes } from '../../core/format';
import { buildDocx, DocxBlock } from '../../core/docx';
import { pageToParagraphs } from '../../core/pdf-text';
import { ProcessStatusComponent } from '../../shared/process-status.component';
import { DropOverlayComponent } from '../../shared/drop-overlay.component';
import { PDF_FILE, useFileDrop } from '../../core/file-drop';

/**
 * Converts a PDF to an editable Word document (.docx). Text is read locally
 * through pdf.js and laid out as paragraphs, with a page break between each
 * source page. Scanned, image-only PDFs yield little or no text — same caveat
 * as the Extract → Text tool.
 */
@Component({
  selector: 'app-convert',
  imports: [ProcessStatusComponent, DropOverlayComponent],
  templateUrl: './convert.component.html',
})
export class ConvertComponent implements OnDestroy {
  readonly fmtBytes = formatBytes;
  readonly runner = createRunner();

  readonly file = signal<InputFile | null>(null);

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
  ) {}

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
  }

  async clearFile(): Promise<void> {
    const previous = this.file();
    this.file.set(null);
    if (previous) await this.renderer.dispose(previous.path);
  }

  async run(): Promise<void> {
    const f = this.file();
    if (!f || !this.canRun()) return;
    const outDir = await this.pdf.defaultOutputDir();
    await this.runner.run((op) => this.convert(f, outDir, op));
  }

  private async convert(f: InputFile, outDir: string, op: (p: ProgressPayload) => void): Promise<OperationResult> {
    const total = f.pages ?? 0;
    if (total === 0) throw new Error('This PDF has no pages to convert.');

    const blocks: DocxBlock[] = [];
    const skipped: number[] = [];
    let textParagraphs = 0;

    for (let page = 1; page <= total; page++) {
      op({ processed: page - 1, total, message: `Reading page ${page}` });
      if (page > 1) blocks.push({ type: 'pageBreak' });
      try {
        const items = await this.renderer.pageTextItems(f.path, page);
        for (const paragraph of pageToParagraphs(items)) {
          blocks.push({ type: 'paragraph', text: paragraph });
          if (paragraph.trim()) textParagraphs++;
        }
      } catch {
        // One unreadable page shouldn't cost the user the whole conversion.
        skipped.push(page);
        blocks.push({ type: 'paragraph', text: `[Page ${page} could not be read]` });
      }
    }

    if (skipped.length === total) throw new Error('None of the pages could be read.');

    op({ processed: total, total, message: 'Writing Word document…' });
    const bytes = buildDocx(blocks, this.baseName(f));
    const written = await this.pdf.writeOutput(outDir, `${this.baseName(f)}.docx`, bytes);

    // Scanned, image-only PDFs have no text layer; say so rather than hand back
    // a silently empty document.
    const noText = textParagraphs === 0;
    return { files: [{ ...written, badge: noText ? 'No text found (scanned?)' : skippedBadge(skipped) }], outDir };
  }

  private baseName(f: InputFile): string {
    return f.name.replace(/\.pdf$/i, '') || 'Document';
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
