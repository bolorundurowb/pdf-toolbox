import { Component, OnDestroy, computed, signal } from '@angular/core';
import { PdfService } from '../../core/pdf.service';
import { PdfRenderService } from '../../core/pdf-render.service';
import { createRunner } from '../../core/runner';
import { InputFile } from '../../core/models';
import { formatBytes } from '../../core/format';
import { ProcessStatusComponent } from '../../shared/process-status.component';
import { PageGridComponent, PageTile } from '../../shared/page-grid.component';
import { ReorderEvent, applyReorder } from '../../shared/reorder.directive';

@Component({
  selector: 'app-organize',
  imports: [ProcessStatusComponent, PageGridComponent],
  templateUrl: './organize.component.html',
})
export class OrganizeComponent implements OnDestroy {
  readonly fmtBytes = formatBytes;
  readonly runner = createRunner();

  readonly file = signal<InputFile | null>(null);
  readonly tiles = signal<PageTile[]>([]);

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

  constructor(
    public readonly pdf: PdfService,
    private readonly renderer: PdfRenderService,
  ) {}

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
    this.resetOrder();
  }

  async clearFile(): Promise<void> {
    const previous = this.file();
    this.file.set(null);
    this.tiles.set([]);
    if (previous) await this.renderer.dispose(previous.path);
  }

  resetOrder(): void {
    const n = this.sourcePages();
    this.nextKey = 1;
    this.tiles.set(
      Array.from({ length: n }, (_, i) => ({ key: this.nextKey++, source: i + 1, rotate: 0, selected: false })),
    );
  }

  rotate(i: number): void {
    this.tiles.update((arr) => arr.map((t, x) => (x === i ? { ...t, rotate: (t.rotate + 90) % 360 } : t)));
  }

  remove(i: number): void {
    this.tiles.update((arr) => arr.filter((_, x) => x !== i));
  }

  duplicate(i: number): void {
    this.tiles.update((arr) => {
      const source = arr[i];
      if (!source) return arr;
      const next = [...arr];
      next.splice(i + 1, 0, { ...source, key: this.nextKey++ });
      return next;
    });
  }

  onReorder(event: ReorderEvent): void {
    this.tiles.update((arr) => applyReorder(arr, event));
  }

  rotateAll(): void {
    this.tiles.update((arr) => arr.map((t) => ({ ...t, rotate: (t.rotate + 90) % 360 })));
  }

  async save(): Promise<void> {
    const f = this.file();
    if (!f || this.tiles().length === 0) return;
    const outDir = await this.pdf.defaultOutputDir();
    const pages = this.tiles().map((t) => ({ source: t.source, rotate: t.rotate }));
    await this.runner.run((op) => this.pdf.organizePdf(f.path, pages, outDir, op));
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
