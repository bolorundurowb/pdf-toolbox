import { Component, computed, signal } from '@angular/core';
import { PdfService } from '../../core/pdf.service';
import { createRunner } from '../../core/runner';
import { CompressLevel, InputFile } from '../../core/models';
import { formatBytes, pluralize } from '../../core/format';
import { ProcessStatusComponent } from '../../shared/process-status.component';

@Component({
  selector: 'app-compress',
  imports: [ProcessStatusComponent],
  templateUrl: './compress.component.html',
})
export class CompressComponent {
  readonly fmtBytes = formatBytes;
  readonly runner = createRunner();

  readonly files = signal<InputFile[]>([]);
  readonly grayscale = signal(false);
  readonly removeMetadata = signal(false);

  /** Slider 1..3 → level. */
  readonly levelIndex = signal(2);
  readonly level = computed<CompressLevel>(() => (this.levelIndex() === 1 ? 'low' : this.levelIndex() === 3 ? 'high' : 'balanced'));

  readonly levelLabels = [
    { i: 1, name: 'Low', hint: 'Max quality' },
    { i: 2, name: 'Recommended', hint: 'Balanced' },
    { i: 3, name: 'Extreme', hint: 'Smallest file' },
  ];

  readonly okFiles = computed(() => this.files().filter((f) => !f.error));
  readonly total = computed(() => this.okFiles().reduce((a, f) => a + f.size, 0));
  readonly canRun = computed(() => this.okFiles().length > 0);

  constructor(public readonly pdf: PdfService) {}

  levelHint(): string {
    return this.level() === 'low' ? 'Light compression — best quality (~300 dpi).'
      : this.level() === 'high' ? 'Strong compression — smallest file (~72 dpi).'
      : 'Balanced — great for sharing (~150 dpi).';
  }

  async addFiles(): Promise<void> {
    const paths = await this.pdf.pickPdfs(true);
    if (!paths.length) return;
    const inspected = await this.pdf.inspect(paths);
    this.files.update((c) => [...c, ...inspected.filter((f) => f.kind === 'pdf')]);
  }
  remove(i: number) { this.files.update((c) => c.filter((_, x) => x !== i)); }
  clearAll() { this.files.set([]); }

  summary(): string {
    return `${pluralize(this.okFiles().length, 'file')} · ${formatBytes(this.total())} · Level: ${this.level() === 'balanced' ? 'Recommended' : this.level() === 'low' ? 'Low' : 'Extreme'}`;
  }

  async apply(): Promise<void> {
    if (!this.canRun()) return;
    const outDir = await this.pdf.defaultOutputDir();
    const paths = this.okFiles().map((f) => f.path);
    await this.runner.run((op) => this.pdf.compressPdfs(paths, { level: this.level(), grayscale: this.grayscale(), removeMetadata: this.removeMetadata() }, outDir, op));
  }

  reset() { this.runner.reset(); this.files.set([]); }
  openResultFolder() { const r = this.runner.result(); if (r) void this.pdf.openFolder(r.outDir); }
}
