import { Component, computed, signal } from '@angular/core';
import { PdfService } from '../../core/pdf.service';
import { createRunner } from '../../core/runner';
import { EncryptionStrength, InputFile } from '../../core/models';
import { formatBytes, pluralize } from '../../core/format';
import { ProcessStatusComponent } from '../../shared/process-status.component';
import { DropOverlayComponent } from '../../shared/drop-overlay.component';
import { PDF_FILE, useFileDrop } from '../../core/file-drop';
import { mergeUnique } from '../../core/files';

type Mode = 'add' | 'remove';

@Component({
  selector: 'app-security',
  imports: [ProcessStatusComponent, DropOverlayComponent],
  templateUrl: './security.component.html',
})
export class SecurityComponent {
  readonly fmtBytes = formatBytes;
  readonly runner = createRunner();

  readonly mode = signal<Mode>('add');
  readonly files = signal<InputFile[]>([]);

  // Add-password
  readonly userPassword = signal('');
  /** Re-typed password: a typo here would lock the user out of their own files. */
  readonly confirmPassword = signal('');
  readonly ownerPassword = signal('');
  readonly showUser = signal(false);
  readonly strength = signal<EncryptionStrength>('aes256');

  // Remove-password
  readonly unlockPassword = signal('');

  readonly strengths: { id: EncryptionStrength; label: string }[] = [
    { id: 'aes256', label: 'AES-256 (Highly secure — Acrobat 9.0+)' },
    { id: 'aes128', label: 'AES-128 (Secure — Acrobat 7.0+)' },
    { id: 'rc4', label: 'RC4-128 (Standard compatibility)' },
  ];

  readonly okFiles = computed(() => this.files().filter((f) => !f.error));
  /** Files that can't be protected in "add" mode — usually already password-protected. */
  readonly skippedCount = computed(() => this.files().length - this.okFiles().length);
  readonly passwordMismatch = computed(
    () => this.confirmPassword().length > 0 && this.confirmPassword() !== this.userPassword(),
  );
  readonly canRun = computed(() => {
    if (this.mode() === 'remove') return this.files().length > 0 && this.unlockPassword().length > 0;
    if (this.okFiles().length === 0) return false;
    return this.userPassword().length > 0 && this.confirmPassword() === this.userPassword();
  });

  readonly dropActive = useFileDrop({
    accept: PDF_FILE,
    onDrop: (paths) => void this.runner.attempt(() => this.ingest(paths)),
    enabled: () => this.runner.stage() === 'idle',
  });

  constructor(public readonly pdf: PdfService) {}

  setMode(m: Mode) { this.mode.set(m); }

  async addFiles(): Promise<void> {
    await this.runner.attempt(async () => this.ingest(await this.pdf.pickPdfs(true)));
  }

  private async ingest(paths: string[]): Promise<void> {
    if (!paths.length) return;
    const inspected = await this.pdf.inspect(paths);
    // For "remove", encrypted files report an error from inspect; keep them anyway.
    this.files.update((c) => mergeUnique(c, inspected.filter((f) => f.name.toLowerCase().endsWith('.pdf'))));
  }

  /** Why a file will be skipped in the current mode, if it will be. */
  noteFor(f: InputFile): string | null {
    if (this.mode() === 'add' && f.error) return f.error === 'Password-protected' ? 'Already protected — skipped' : f.error;
    return null;
  }
  remove(i: number) { this.files.update((c) => c.filter((_, x) => x !== i)); }

  summary(): string {
    if (this.mode() === 'add') return `${pluralize(this.okFiles().length, 'file')} · Encrypt: ${this.strength().toUpperCase()}`;
    return `${pluralize(this.files().length, 'file')} · Remove password`;
  }

  async apply(): Promise<void> {
    if (!this.canRun()) return;
    const outDir = await this.pdf.defaultOutputDir();
    if (this.mode() === 'add') {
      const paths = this.okFiles().map((f) => f.path);
      await this.runner.run((op) => this.pdf.encryptPdfs(paths, { userPassword: this.userPassword(), ownerPassword: this.ownerPassword() || undefined, strength: this.strength() }, outDir, op));
    } else {
      const paths = this.files().map((f) => f.path);
      await this.runner.run((op) => this.pdf.decryptPdfs(paths, this.unlockPassword(), outDir, op));
    }
  }

  reset() {
    this.runner.reset();
    this.files.set([]);
    this.userPassword.set('');
    this.confirmPassword.set('');
    this.ownerPassword.set('');
    this.unlockPassword.set('');
  }
  openResultFolder() { const r = this.runner.result(); if (r) void this.pdf.openFolder(r.outDir); }
}
