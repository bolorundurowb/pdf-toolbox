import { Component, HostListener, computed, signal } from '@angular/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { PdfService } from '../../core/pdf.service';
import { createRunner } from '../../core/runner';
import { ImageOrientation, ImagePageSize, InputFile } from '../../core/models';
import { formatBytes, pluralize } from '../../core/format';
import { ProcessStatusComponent } from '../../shared/process-status.component';
import { DropOverlayComponent } from '../../shared/drop-overlay.component';
import { IMAGE_FILE, useFileDrop } from '../../core/file-drop';
import { ReorderEvent, ReorderItemDirective, applyReorder } from '../../shared/reorder.directive';

/**
 * A queued image. The synthetic `key` keeps `@for` tracking unique when the same
 * image is added twice (e.g. to repeat a page), which tracking by path would not.
 */
interface ImageItem extends InputFile {
  key: number;
}

@Component({
  selector: 'app-images',
  imports: [ProcessStatusComponent, ReorderItemDirective, DropOverlayComponent],
  templateUrl: './images.component.html',
})
export class ImagesComponent {
  readonly fmtBytes = formatBytes;
  readonly runner = createRunner();

  readonly files = signal<ImageItem[]>([]);
  private nextKey = 1;

  /** Images dragged in from the OS — the dropzone has always promised this. */
  readonly dropActive = useFileDrop({
    accept: IMAGE_FILE,
    onDrop: (paths) => void this.runner.attempt(() => this.ingest(paths)),
    enabled: () => this.runner.stage() === 'idle',
  });

  /** Number of grid columns currently visible. Kept in sync with the responsive
   *  Tailwind breakpoints so Ctrl/Cmd + up/down move a full row. */
  readonly columns = signal(3);

  // Options
  readonly pageSize = signal<ImagePageSize>('a4');
  readonly orientation = signal<ImageOrientation>('auto');
  readonly margin = signal(20); // px→pt approximate
  readonly quality = signal(85);

  readonly pageSizes: { id: ImagePageSize; label: string; hint: string }[] = [
    { id: 'a4', label: 'A4', hint: '210 × 297 mm' },
    { id: 'letter', label: 'Letter', hint: '8.5 × 11.0 in' },
    { id: 'fit', label: 'Fit to Image', hint: 'Dynamic dimensions' },
  ];
  readonly orientations: ImageOrientation[] = ['auto', 'portrait', 'landscape'];
  readonly margins = [
    { v: 0, label: 'None (0px)' },
    { v: 20, label: 'Small (20px)' },
    { v: 40, label: 'Medium (40px)' },
    { v: 60, label: 'Large (60px)' },
  ];

  readonly okFiles = computed(() => this.files().filter((f) => !f.error));
  readonly totalSize = computed(() => this.okFiles().reduce((a, f) => a + f.size, 0));
  readonly heading = computed(() => `Uploaded Images (${this.files().length})`);
  readonly canRun = computed(() => this.okFiles().length > 0);

  constructor(public readonly pdf: PdfService) {
    this.syncColumns();
  }

  thumb(path: string): string {
    return convertFileSrc(path);
  }

  async addFiles(): Promise<void> {
    await this.runner.attempt(async () => this.ingest(await this.pdf.pickImages(true)));
  }

  private async ingest(paths: string[]): Promise<void> {
    if (!paths.length) return;
    const inspected = await this.pdf.inspect(paths);
    const added = inspected
      .filter((f) => f.kind === 'image')
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

  @HostListener('window:resize')
  private syncColumns(): void {
    const w = window.innerWidth;
    this.columns.set(w >= 1024 ? 3 : w >= 640 ? 2 : 1);
  }

  metaOf(f: InputFile): string {
    return f.width && f.height ? `${f.width} × ${f.height}` : '';
  }

  summaryText(): string {
    return `${pluralize(this.okFiles().length, 'image')} · ${formatBytes(this.totalSize())}`;
  }

  async convert(): Promise<void> {
    if (!this.canRun()) return;
    const outDir = await this.pdf.defaultOutputDir();
    const paths = this.okFiles().map((f) => f.path);
    await this.runner.run((op) =>
      this.pdf.imagesToPdf(
        paths,
        { pageSize: this.pageSize(), orientation: this.orientation(), margin: this.margin(), quality: this.quality() },
        outDir, op,
      ),
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
