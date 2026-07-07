import { Component, computed, signal } from '@angular/core';
import { PdfService } from '../../core/pdf.service';
import { createRunner } from '../../core/runner';
import { ExtractImageFormat, InputFile } from '../../core/models';
import { formatBytes } from '../../core/format';
import { ProcessStatusComponent } from '../../shared/process-status.component';

type Mode = 'text' | 'images';

@Component({
  selector: 'app-extract',
  imports: [ProcessStatusComponent],
  templateUrl: './extract.component.html',
})
export class ExtractComponent {
  readonly fmtBytes = formatBytes;
  readonly runner = createRunner();

  readonly file = signal<InputFile | null>(null);
  readonly mode = signal<Mode>('text');
  readonly imageFormat = signal<ExtractImageFormat>('png');
  readonly dpi = signal(150);
  readonly dpis = [72, 150, 300];

  readonly canRun = computed(() => !!this.file());

  constructor(public readonly pdf: PdfService) {}

  setMode(m: Mode) { this.mode.set(m); }

  async choose(): Promise<void> {
    const paths = await this.pdf.pickPdfs(false);
    if (!paths.length) return;
    const [f] = await this.pdf.inspect(paths);
    if (f) this.file.set(f);
  }
  clearFile() { this.file.set(null); }

  async run(): Promise<void> {
    const f = this.file();
    if (!f) return;
    const outDir = await this.pdf.defaultOutputDir();
    if (this.mode() === 'text') {
      await this.runner.run((op) => this.pdf.extractText(f.path, outDir, op));
    } else {
      await this.runner.run((op) => this.pdf.pagesToImages(f.path, this.imageFormat(), this.dpi(), outDir, op));
    }
  }

  reset() { this.runner.reset(); this.file.set(null); }
  openResultFolder() { const r = this.runner.result(); if (r) void this.pdf.openFolder(r.outDir); }
}
