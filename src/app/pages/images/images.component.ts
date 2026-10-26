import { Component, OnInit, computed, signal } from '@angular/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { PdfService } from '../../core/pdf.service';
import { createRunner } from '../../core/runner';
import { ImageOrientation, ImagePageSize, InputFile } from '../../core/models';
import { formatBytes, pluralize } from '../../core/format';
import { SettingsService } from '../../core/settings.service';
import { RecentInputsService } from '../../core/recent-inputs.service';
import { ProcessStatusComponent } from '../../shared/process-status.component';
import { DropOverlayComponent } from '../../shared/drop-overlay.component';
import { ToolPageComponent } from '../../shared/tool-page.component';
import { FileDropZoneComponent } from '../../shared/file-drop-zone.component';
import { IMAGE_FILE, useFileDrop } from '../../core/file-drop';
import { useShortcuts } from '../../core/shortcuts';
import { imagesSuggestion, outputBase } from '../../core/output-names';
import { routerPaths } from '../../core/tool-nav';
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
  imports: [
    ProcessStatusComponent, ReorderItemDirective, DropOverlayComponent,
    ToolPageComponent, FileDropZoneComponent,
  ],
  templateUrl: './images.component.html',
})
export class ImagesComponent implements OnInit {
  readonly fmtBytes = formatBytes;
  readonly runner = createRunner(() => void this.pdf.cancelJob());

  readonly files = signal<ImageItem[]>([]);
  private nextKey = 1;

  /** Images dragged in from the OS — the dropzone has always promised this. */
  readonly dropActive = useFileDrop({
    accept: IMAGE_FILE,
    onDrop: (paths) => void this.ingestFrom(paths),
    enabled: () => this.runner.stage() === 'idle',
  });

  /** Number of grid columns currently visible. Kept close to the container layout
   *  so Ctrl/Cmd + up/down move a full row. */
  readonly columns = signal(3);

  // Options
  readonly pageSize = signal<ImagePageSize>('a4');
  readonly orientation = signal<ImageOrientation>('auto');
  readonly margin = signal(20); // px→pt approximate
  readonly quality = signal(85);
  readonly outputName = signal('');

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
  readonly heading = computed(() => `Uploaded images (${this.files().length})`);
  readonly canRun = computed(() => this.okFiles().length > 0);
  readonly suggestedName = computed(() => imagesSuggestion(this.okFiles()));

  constructor(
    public readonly pdf: PdfService,
    private readonly settings: SettingsService,
    private readonly recents: RecentInputsService,
  ) {
    this.syncColumns();
    useShortcuts({
      onOpen: () => void this.addFiles(),
      onRun: () => void this.convert(),
      enabled: () => this.runner.stage() === 'idle',
      canRun: () => this.canRun(),
    });
  }

  async ngOnInit(): Promise<void> {
    const paths = routerPaths().filter((path) => IMAGE_FILE.test(path));
    if (paths.length > 0) await this.ingestFrom(paths);
  }

  thumb(path: string): string {
    return convertFileSrc(path);
  }

  async addFiles(): Promise<void> {
    await this.runner.attempt(async () => this.ingest(await this.pdf.pickImages(true)));
  }

  private async ingestFrom(paths: string[]): Promise<void> {
    await this.runner.attempt(() => this.ingest(paths));
  }

  private async ingest(paths: string[]): Promise<void> {
    if (!paths.length) return;
    const inspected = await this.pdf.inspect(paths);
    const added = inspected
      .filter((f) => f.kind === 'image')
      .map((f) => ({ ...f, key: this.nextKey++ }));
    this.files.update((cur) => [...cur, ...added]);
    this.recents.remember(added);
    this.syncColumns();
  }

  remove(i: number): void {
    this.files.update((cur) => cur.filter((_, x) => x !== i));
  }

  clearAll(): void {
    if (this.files().length > 0 && !window.confirm('Remove all images from this list?')) return;
    this.files.set([]);
  }

  onReorder(event: ReorderEvent): void {
    this.files.update((cur) => applyReorder(cur, event));
  }

  private syncColumns(): void {
    const w = window.innerWidth;
    this.columns.set(w >= 1180 ? 3 : w >= 900 ? 2 : 1);
  }

  metaOf(f: InputFile): string {
    return f.width && f.height ? `${f.width} × ${f.height}` : '';
  }

  summaryText(): string {
    return `${pluralize(this.okFiles().length, 'image')} · ${formatBytes(this.totalSize())}`;
  }

  async convert(): Promise<void> {
    if (!this.canRun()) return;
    const outDir = await this.settings.resolveOutputDir();
    if (!outDir) return;
    const base = outputBase(this.outputName(), this.suggestedName());
    const conflict = await this.settings.resolveConflict(outDir, [`${base}.pdf`]);
    const paths = this.okFiles().map((f) => f.path);
    await this.runner.run((op) =>
      this.pdf.imagesToPdf(
        paths,
        {
          pageSize: this.pageSize(),
          orientation: this.orientation(),
          margin: this.margin(),
          quality: this.quality(),
          outputName: this.outputName() || undefined,
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
  }

  openResultFolder(): void {
    const r = this.runner.result();
    if (r?.outDir) void this.pdf.openFolder(r.outDir);
  }
}
