import { Component, computed, signal } from '@angular/core';
import { PdfService } from '../../core/pdf.service';
import { createRunner } from '../../core/runner';
import { InputFile, PdfMetadata } from '../../core/models';
import { formatBytes } from '../../core/format';
import { ProcessStatusComponent } from '../../shared/process-status.component';
import { DropOverlayComponent } from '../../shared/drop-overlay.component';
import { PDF_FILE, useFileDrop } from '../../core/file-drop';

const EMPTY: PdfMetadata = { title: '', author: '', subject: '', keywords: '', creator: '', producer: '' };

@Component({
  selector: 'app-metadata',
  imports: [ProcessStatusComponent, DropOverlayComponent],
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

  /** A PDF dragged in from the OS opens it — only while no file is loaded, so a stray drop can't discard work. */
  readonly dropActive = useFileDrop({
    accept: PDF_FILE,
    onDrop: ([path]) => void this.runner.attempt(() => this.load(path)),
    enabled: () => this.runner.stage() === 'idle' && !this.file(),
  });


  constructor(public readonly pdf: PdfService) {}

  async choose(): Promise<void> {
    await this.runner.attempt(async () => {
      const [path] = await this.pdf.pickPdfs(false);
      if (path) await this.load(path);
    });
  }

  /**
   * Opens a file for editing. A protected or unreadable PDF used to show blank
   * fields that could still be saved; now it shows why it can't be edited.
   */
  private async load(path: string): Promise<void> {
    const [f] = await this.pdf.inspect([path]);
    if (!f) return;
    if (f.error) {
      this.runner.fail(f.error === 'Password-protected'
        ? 'This PDF is password-protected. Remove the password first (Security → Remove Password).'
        : f.error);
      return;
    }
    this.loading.set(true);
    try {
      const meta = await this.pdf.getMetadata(f.path);
      this.file.set(f);
      this.meta.set(meta);
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
