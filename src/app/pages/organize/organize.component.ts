import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { PdfService } from '../../core/pdf.service';
import { PdfRenderService } from '../../core/pdf-render.service';
import { createRunner } from '../../core/runner';
import {
  InputFile, OrganizeOptions, PageNumberPlacement, WatermarkPlacement, emptyOrganizeOptions,
} from '../../core/models';
import { formatBytes } from '../../core/format';
import { SettingsService } from '../../core/settings.service';
import { RecentInputsService } from '../../core/recent-inputs.service';
import { ProcessStatusComponent } from '../../shared/process-status.component';
import { DropOverlayComponent } from '../../shared/drop-overlay.component';
import { ToolPageComponent } from '../../shared/tool-page.component';
import { FileDropZoneComponent } from '../../shared/file-drop-zone.component';
import { PagePreviewComponent } from '../../shared/page-preview.component';
import { PDF_FILE, useFileDrop } from '../../core/file-drop';
import { PageGridComponent, PageTile } from '../../shared/page-grid.component';
import { ReorderEvent, applyReorder } from '../../shared/reorder.directive';
import { useShortcuts } from '../../core/shortcuts';
import { stemOf } from '../../core/output-names';
import { routerPaths } from '../../core/tool-nav';

@Component({
  selector: 'app-organize',
  imports: [
    ProcessStatusComponent, PageGridComponent, DropOverlayComponent,
    ToolPageComponent, FileDropZoneComponent, PagePreviewComponent,
  ],
  templateUrl: './organize.component.html',
})
export class OrganizeComponent implements OnInit, OnDestroy {
  readonly fmtBytes = formatBytes;
  readonly runner = createRunner(() => void this.pdf.cancelJob());

  readonly file = signal<InputFile | null>(null);
  readonly tiles = signal<PageTile[]>([]);
  readonly previewIndex = signal<number | null>(null);

  /** Previous page lists, most recent last, for Undo. */
  private readonly history = signal<PageTile[][]>([]);
  readonly canUndo = computed(() => this.history().length > 0);

  /** A PDF dragged in from the OS opens it — only while no file is loaded, so a stray drop can't discard work. */
  readonly dropActive = useFileDrop({
    accept: PDF_FILE,
    onDrop: ([path]) => void this.runner.attempt(() => this.load(path)),
    enabled: () => this.runner.stage() === 'idle' && !this.file(),
  });

  /** Monotonic, so a duplicated page still gets a unique `@for` track key. */
  private nextKey = 1;

  readonly canRun = computed(() => !!this.file() && this.tiles().length > 0);
  readonly sourcePages = computed(() => this.file()?.pages ?? 0);
  readonly removedCount = computed(() => {
    const kept = new Set(this.tiles().map((t) => t.source));
    return Math.max(0, this.sourcePages() - kept.size);
  });
  readonly addedCount = computed(() => {
    const kept = new Set(this.tiles().map((t) => t.source));
    return Math.max(0, this.tiles().length - kept.size);
  });

  // Page tools, applied when the PDF is saved.
  readonly options = signal<OrganizeOptions>(emptyOrganizeOptions());
  readonly watermarkPlacements: { id: WatermarkPlacement; label: string }[] = [
    { id: 'diagonal', label: 'Diagonal' },
    { id: 'horizontal', label: 'Horizontal' },
  ];
  readonly numberPlacements: { id: PageNumberPlacement; label: string }[] = [
    { id: 'corner', label: 'Bottom right' },
    { id: 'centre', label: 'Bottom centre' },
  ];

  constructor(
    public readonly pdf: PdfService,
    private readonly renderer: PdfRenderService,
    private readonly settings: SettingsService,
    private readonly recents: RecentInputsService,
  ) {
    useShortcuts({
      onOpen: () => { if (!this.file()) void this.choose(); },
      onRun: () => void this.save(),
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
    this.resetOrder(false);
    this.recents.remember([f]);
  }

  async clearFile(): Promise<void> {
    const previous = this.file();
    this.file.set(null);
    this.tiles.set([]);
    this.history.set([]);
    this.previewIndex.set(null);
    if (previous) await this.renderer.dispose(previous.path);
  }

  /** Reset the list to the source order. Loading a file does not record history. */
  resetOrder(record = true): void {
    if (record) this.pushHistory();
    const n = this.sourcePages();
    this.nextKey = 1;
    this.tiles.set(
      Array.from({ length: n }, (_, i) => ({ key: this.nextKey++, source: i + 1, rotate: 0, selected: false })),
    );
  }

  /** The Reset button asks first, because it also clears the undo history. */
  async resetClick(): Promise<void> {
    if (!window.confirm('Reset the page order and clear the undo history?')) return;
    this.resetOrder(false);
    this.history.set([]);
  }

  private pushHistory(): void {
    this.history.update((h) => [...h.slice(-24), this.tiles()]);
  }

  undo(): void {
    const history = this.history();
    const previous = history[history.length - 1];
    if (!previous) return;
    this.history.set(history.slice(0, -1));
    this.tiles.set(previous);
  }

  rotate(i: number): void {
    this.pushHistory();
    this.tiles.update((arr) => arr.map((t, x) => (x === i ? { ...t, rotate: (t.rotate + 90) % 360 } : t)));
  }

  remove(i: number): void {
    this.pushHistory();
    this.tiles.update((arr) => arr.filter((_, x) => x !== i));
  }

  duplicate(i: number): void {
    this.pushHistory();
    this.tiles.update((arr) => {
      const source = arr[i];
      if (!source) return arr;
      const next = [...arr];
      next.splice(i + 1, 0, { ...source, key: this.nextKey++ });
      return next;
    });
  }

  onReorder(event: ReorderEvent): void {
    this.pushHistory();
    this.tiles.update((arr) => applyReorder(arr, event));
  }

  rotateAll(): void {
    if (this.tiles().length === 0) return;
    this.pushHistory();
    this.tiles.update((arr) => arr.map((t) => ({ ...t, rotate: (t.rotate + 90) % 360 })));
  }

  updateOption<K extends keyof OrganizeOptions>(key: K, value: OrganizeOptions[K]): void {
    this.options.update((o) => ({ ...o, [key]: value }));
  }

  async save(): Promise<void> {
    const f = this.file();
    if (!f || this.tiles().length === 0) return;
    const outDir = await this.settings.resolveOutputDir();
    if (!outDir) return;
    const name = `${stemOf(f.name)} (organised).pdf`;
    const conflict = await this.settings.resolveConflict(outDir, [name]);
    const pages = this.tiles().map((t) => ({ source: t.source, rotate: t.rotate }));
    await this.runner.run((op) =>
      this.pdf.organizePdf(f.path, pages, { ...this.options(), onConflict: conflict }, outDir, op),
    );
  }

  async reset(): Promise<void> {
    this.runner.reset();
    this.options.set(emptyOrganizeOptions());
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
