import { Component, computed, signal } from '@angular/core';
import { PdfService } from '../../core/pdf.service';
import { createRunner } from '../../core/runner';
import { InputFile, PdfMetadata } from '../../core/models';
import { formatBytes } from '../../core/format';
import { ProcessStatusComponent } from '../../shared/process-status.component';

const EMPTY: PdfMetadata = { title: '', author: '', subject: '', keywords: '', creator: '', producer: '' };

@Component({
  selector: 'app-metadata',
  imports: [ProcessStatusComponent],
  templateUrl: './metadata.component.html',
})
export class MetadataComponent {
  readonly fmtBytes = formatBytes;
  readonly runner = createRunner();

  readonly file = signal<InputFile | null>(null);
  readonly meta = signal<PdfMetadata>({ ...EMPTY });
  readonly loading = signal(false);

  readonly fields: { key: keyof PdfMetadata; label: string; hint: string; area?: boolean }[] = [
    { key: 'title', label: 'Title', hint: 'Document title' },
    { key: 'author', label: 'Author', hint: 'Who created it' },
    { key: 'subject', label: 'Subject', hint: 'What it is about' },
    { key: 'keywords', label: 'Keywords', hint: 'Comma-separated', area: true },
    { key: 'creator', label: 'Creator', hint: 'Authoring application' },
  ];

  readonly canRun = computed(() => !!this.file());

  constructor(public readonly pdf: PdfService) {}

  async choose(): Promise<void> {
    const paths = await this.pdf.pickPdfs(false);
    if (!paths.length) return;
    const [f] = await this.pdf.inspect(paths);
    if (!f) return;
    this.file.set(f);
    this.loading.set(true);
    try {
      this.meta.set(await this.pdf.getMetadata(f.path));
    } catch {
      this.meta.set({ ...EMPTY });
    } finally {
      this.loading.set(false);
    }
  }

  update(key: keyof PdfMetadata, value: string): void {
    this.meta.update((m) => ({ ...m, [key]: value }));
  }

  clearFile(): void {
    this.file.set(null);
    this.meta.set({ ...EMPTY });
  }

  async save(): Promise<void> {
    const f = this.file();
    if (!f) return;
    const outDir = await this.pdf.defaultOutputDir();
    await this.runner.run(() => this.pdf.setMetadata(f.path, this.meta(), outDir));
  }

  reset() { this.runner.reset(); this.clearFile(); }
  openResultFolder() { const r = this.runner.result(); if (r) void this.pdf.openFolder(r.outDir); }
}
