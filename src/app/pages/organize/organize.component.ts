import { Component, computed, signal } from '@angular/core';
import { PdfService } from '../../core/pdf.service';
import { createRunner } from '../../core/runner';
import { InputFile } from '../../core/models';
import { formatBytes } from '../../core/format';
import { ProcessStatusComponent } from '../../shared/process-status.component';

interface Tile {
  key: number;   // stable id for @for tracking
  source: number; // 1-based original page
  rotate: number; // 0/90/180/270
}

@Component({
  selector: 'app-organize',
  imports: [ProcessStatusComponent],
  templateUrl: './organize.component.html',
})
export class OrganizeComponent {
  readonly fmtBytes = formatBytes;
  readonly runner = createRunner();

  readonly file = signal<InputFile | null>(null);
  readonly tiles = signal<Tile[]>([]);

  private dragFrom: number | null = null;

  readonly canRun = computed(() => !!this.file() && this.tiles().length > 0);
  readonly removedCount = computed(() => {
    const total = this.file()?.pages ?? 0;
    return Math.max(0, total - this.tiles().length);
  });

  constructor(public readonly pdf: PdfService) {}

  async choose(): Promise<void> {
    const paths = await this.pdf.pickPdfs(false);
    if (!paths.length) return;
    const [f] = await this.pdf.inspect(paths);
    if (!f) return;
    this.file.set(f);
    const n = f.pages ?? 0;
    this.tiles.set(Array.from({ length: n }, (_, i) => ({ key: i + 1, source: i + 1, rotate: 0 })));
  }

  clearFile() { this.file.set(null); this.tiles.set([]); }

  rotate(i: number) {
    this.tiles.update((arr) => arr.map((t, x) => (x === i ? { ...t, rotate: (t.rotate + 90) % 360 } : t)));
  }
  remove(i: number) {
    this.tiles.update((arr) => arr.filter((_, x) => x !== i));
  }
  resetOrder() {
    const n = this.file()?.pages ?? 0;
    this.tiles.set(Array.from({ length: n }, (_, i) => ({ key: i + 1, source: i + 1, rotate: 0 })));
  }

  onDragStart(i: number) { this.dragFrom = i; }
  onDragOver(e: DragEvent) { e.preventDefault(); }
  onDrop(to: number) {
    const from = this.dragFrom;
    this.dragFrom = null;
    if (from === null || from === to) return;
    const arr = [...this.tiles()];
    const [m] = arr.splice(from, 1);
    arr.splice(to, 0, m);
    this.tiles.set(arr);
  }

  async save(): Promise<void> {
    const f = this.file();
    if (!f || this.tiles().length === 0) return;
    const outDir = await this.pdf.defaultOutputDir();
    const pages = this.tiles().map((t) => ({ source: t.source, rotate: t.rotate }));
    await this.runner.run((op) => this.pdf.organizePdf(f.path, pages, outDir, op));
  }

  reset() { this.runner.reset(); this.clearFile(); }
  openResultFolder() { const r = this.runner.result(); if (r) void this.pdf.openFolder(r.outDir); }
}
