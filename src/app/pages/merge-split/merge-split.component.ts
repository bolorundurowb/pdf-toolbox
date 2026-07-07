import { Component, computed, signal } from '@angular/core';
import { PdfService } from '../../core/pdf.service';
import { createRunner } from '../../core/runner';
import { InputFile, SplitMode } from '../../core/models';
import { formatBytes, pluralize } from '../../core/format';
import { ProcessStatusComponent } from '../../shared/process-status.component';

type Tab = 'merge' | 'split';

@Component({
  selector: 'app-merge-split',
  imports: [ProcessStatusComponent],
  templateUrl: './merge-split.component.html',
})
export class MergeSplitComponent {
  readonly fmtBytes = formatBytes;
  readonly runner = createRunner();

  readonly tab = signal<Tab>('merge');

  // Merge state
  readonly files = signal<InputFile[]>([]);
  readonly optimize = signal(false);
  readonly mergeName = signal('');

  // Split state
  readonly splitFile = signal<InputFile | null>(null);
  readonly splitMode = signal<SplitMode>('ranges');
  readonly rangeText = signal('1-5, 8, 10-12');
  readonly maxSizeMb = signal(25);
  readonly splitName = signal('');

  private dragFrom: number | null = null;

  readonly okFiles = computed(() => this.files().filter((f) => !f.error));
  readonly mergeTotal = computed(() => this.okFiles().reduce((a, f) => a + f.size, 0));
  readonly mergePages = computed(() => this.okFiles().reduce((a, f) => a + (f.pages ?? 0), 0));

  readonly splitPages = computed(() => this.splitFile()?.pages ?? 0);
  readonly ranges = computed(() => this.parseRanges(this.rangeText(), this.splitPages()));

  /** Pages (capped) with a flag for whether they're included by the current ranges. */
  readonly previewPages = computed(() => {
    const total = this.splitPages();
    const cap = Math.min(total, 60);
    const out: { n: number; on: boolean; group: number }[] = [];
    for (let n = 1; n <= cap; n++) {
      let on = false;
      let group = -1;
      if (this.splitMode() === 'ranges') {
        group = this.ranges().findIndex(([a, b]) => n >= a && n <= b);
        on = group >= 0;
      } else {
        // size mode: colour by even chunk index (approximate preview)
        const parts = this.sizeParts();
        const per = parts > 0 ? Math.ceil(total / parts) : total;
        group = Math.floor((n - 1) / Math.max(1, per));
        on = true;
      }
      out.push({ n, on, group });
    }
    return out;
  });
  readonly moreCount = computed(() => Math.max(0, this.splitPages() - 60));

  readonly summaryOp = computed(() => (this.tab() === 'merge' ? 'Merge' : 'Split'));

  readonly canRun = computed(() => {
    if (this.tab() === 'merge') return this.okFiles().length >= 2;
    if (!this.splitFile()) return false;
    if (this.splitMode() === 'ranges') return this.ranges().length > 0;
    return this.maxSizeMb() > 0;
  });

  constructor(public readonly pdf: PdfService) {}

  setTab(t: Tab) { this.tab.set(t); }

  // ---- merge ----
  async addMergeFiles(): Promise<void> {
    const paths = await this.pdf.pickPdfs(true);
    if (!paths.length) return;
    const inspected = await this.pdf.inspect(paths);
    this.files.update((cur) => [...cur, ...inspected.filter((f) => f.kind === 'pdf')]);
  }
  removeMerge(i: number) { this.files.update((c) => c.filter((_, x) => x !== i)); }
  onDragStart(i: number) { this.dragFrom = i; }
  onDragOver(e: DragEvent) { e.preventDefault(); }
  onDrop(to: number) {
    const from = this.dragFrom; this.dragFrom = null;
    if (from === null || from === to) return;
    const arr = [...this.files()];
    const [m] = arr.splice(from, 1); arr.splice(to, 0, m);
    this.files.set(arr);
  }

  // ---- split ----
  async chooseSplitFile(): Promise<void> {
    const paths = await this.pdf.pickPdfs(false);
    if (!paths.length) return;
    const [f] = await this.pdf.inspect(paths);
    if (f) this.splitFile.set(f);
  }
  onRange(e: Event) { this.rangeText.set((e.target as HTMLInputElement).value); }
  onMaxSize(e: Event) { this.maxSizeMb.set(Math.max(1, +(e.target as HTMLInputElement).value || 1)); }
  private sizeParts(): number {
    const f = this.splitFile();
    if (!f || this.maxSizeMb() <= 0) return 1;
    return Math.max(1, Math.ceil(f.size / (this.maxSizeMb() * 1024 * 1024)));
  }

  fileMeta(f: InputFile): string {
    return `${fmtOrDash(f.pages)} • ${formatBytes(f.size)}`;
  }
  summaryFiles(): string {
    return this.tab() === 'merge' ? pluralize(this.okFiles().length, 'file') : '1 file';
  }
  summarySize(): string {
    return this.tab() === 'merge' ? formatBytes(this.mergeTotal()) : formatBytes(this.splitFile()?.size ?? 0);
  }

  async process(): Promise<void> {
    if (!this.canRun()) return;
    const outDir = await this.pdf.defaultOutputDir();
    if (this.tab() === 'merge') {
      const paths = this.okFiles().map((f) => f.path);
      await this.runner.run((op) => this.pdf.mergePdfs(paths, { optimize: this.optimize(), outputName: this.mergeName() || undefined }, outDir, op));
    } else {
      const f = this.splitFile()!;
      await this.runner.run((op) => this.pdf.splitPdf(f.path, {
        mode: this.splitMode(), rangeText: this.rangeText(), maxSizeMb: this.maxSizeMb(),
        selectedPages: [], outputName: this.splitName() || undefined,
      }, outDir, op));
    }
  }

  reset(): void {
    this.runner.reset();
    this.files.set([]);
    this.splitFile.set(null);
  }
  openResultFolder(): void {
    const r = this.runner.result();
    if (r) void this.pdf.openFolder(r.outDir);
  }

  private parseRanges(text: string, max: number): [number, number][] {
    const out: [number, number][] = [];
    for (const raw of (text || '').split(',')) {
      const tok = raw.trim(); if (!tok) continue;
      const m = tok.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        let a = +m[1], b = +m[2]; if (a > b) [a, b] = [b, a];
        a = Math.max(1, a); b = Math.min(max, b);
        if (a <= b) out.push([a, b]);
      } else if (/^\d+$/.test(tok)) {
        const p = +tok; if (p >= 1 && p <= max) out.push([p, p]);
      }
    }
    return out;
  }
}

function fmtOrDash(n?: number): string {
  return n != null ? `${n} Pages` : '— Pages';
}
