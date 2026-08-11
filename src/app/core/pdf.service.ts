import { Injectable } from '@angular/core';
import { Channel, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { documentDir, join } from '@tauri-apps/api/path';
import { mkdir, exists, stat, writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  CompressOptions, ImagesOptions, InputFile, MergeOptions, OperationResult,
  OutputFile, PdfMetadata, ProgressPayload, RecentFile, SecurityOptions, SplitOptions,
  PageOp,
} from './models';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif', 'webp', 'heic', 'heif'];

@Injectable({ providedIn: 'root' })
export class PdfService {
  async pickPdfs(multiple = true): Promise<string[]> {
    const sel = await open({ multiple, directory: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    return this.toArray(sel);
  }

  async pickImages(multiple = true): Promise<string[]> {
    const sel = await open({ multiple, directory: false, filters: [{ name: 'Images', extensions: IMAGE_EXTS }] });
    return this.toArray(sel);
  }


  async inspect(paths: string[]): Promise<InputFile[]> {
    if (paths.length === 0) return [];
    return invoke<InputFile[]>('inspect_files', { paths });
  }

  async defaultOutputDir(): Promise<string> {
    const docs = await documentDir();
    const dir = await join(docs, 'PDF Toolbox');
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
    return dir;
  }

  imagesToPdf(paths: string[], options: ImagesOptions, outDir: string, onProgress: (p: ProgressPayload) => void) {
    return invoke<OperationResult>('images_to_pdf', { paths, options, outDir, onProgress: this.channel(onProgress) });
  }

  mergePdfs(paths: string[], options: MergeOptions, outDir: string, onProgress: (p: ProgressPayload) => void) {
    return invoke<OperationResult>('merge_pdfs', { paths, options, outDir, onProgress: this.channel(onProgress) });
  }

  splitPdf(path: string, options: SplitOptions, outDir: string, onProgress: (p: ProgressPayload) => void) {
    return invoke<OperationResult>('split_pdf', { path, options, outDir, onProgress: this.channel(onProgress) });
  }

  compressPdfs(paths: string[], options: CompressOptions, outDir: string, onProgress: (p: ProgressPayload) => void) {
    return invoke<OperationResult>('compress_pdfs', { paths, options, outDir, onProgress: this.channel(onProgress) });
  }

  encryptPdfs(paths: string[], options: SecurityOptions, outDir: string, onProgress: (p: ProgressPayload) => void) {
    return invoke<OperationResult>('encrypt_pdfs', { paths, options, outDir, onProgress: this.channel(onProgress) });
  }

  decryptPdfs(paths: string[], password: string, outDir: string, onProgress: (p: ProgressPayload) => void) {
    return invoke<OperationResult>('decrypt_pdfs', { paths, password, outDir, onProgress: this.channel(onProgress) });
  }

  getMetadata(path: string): Promise<PdfMetadata> {
    return invoke<PdfMetadata>('get_metadata', { path });
  }

  setMetadata(path: string, metadata: PdfMetadata, outDir: string): Promise<OperationResult> {
    return invoke<OperationResult>('set_metadata', { path, metadata, outDir });
  }

  /**
   * Writes bytes produced in the frontend (pdf.js renders text and images
   * locally) into the output folder, never overwriting an existing file.
   */
  async writeOutput(outDir: string, name: string, data: Uint8Array | string): Promise<OutputFile> {
    const path = await this.uniqueOutputPath(outDir, name);
    if (typeof data === 'string') {
      await writeTextFile(path, data);
    } else {
      await writeFile(path, data);
    }
    return {
      name: path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1),
      path,
      size: await this.sizeOf(path),
    };
  }

  /** Mirrors the Rust `unique_path` helper: `name.txt`, `name (2).txt`, … */
  private async uniqueOutputPath(outDir: string, name: string): Promise<string> {
    const safe = sanitizeFileName(name);
    const first = await join(outDir, safe);
    if (!(await exists(first))) return first;

    const dot = safe.lastIndexOf('.');
    const stem = dot > 0 ? safe.slice(0, dot) : safe;
    const ext = dot > 0 ? safe.slice(dot) : '';
    for (let n = 2; ; n++) {
      const candidate = await join(outDir, `${stem} (${n})${ext}`);
      if (!(await exists(candidate))) return candidate;
    }
  }

  private async sizeOf(path: string): Promise<number> {
    try {
      return (await stat(path)).size;
    } catch {
      return 0;
    }
  }

  organizePdf(path: string, pages: PageOp[], outDir: string, onProgress: (p: ProgressPayload) => void) {
    return invoke<OperationResult>('organize_pdf', { path, pages, outDir, onProgress: this.channel(onProgress) });
  }

  recentOutputs(): Promise<RecentFile[]> {
    return invoke<RecentFile[]>('recent_outputs', {});
  }

  async openFolder(dir: string): Promise<void> {
    await openPath(dir);
  }

  async openFolderOf(filePath: string): Promise<void> {
    await revealItemInDir(filePath);
  }

  async openPath(path: string): Promise<void> {
    await openPath(path);
  }

  private toArray(sel: string | string[] | null): string[] {
    if (!sel) return [];
    return Array.isArray(sel) ? sel : [sel];
  }

  private channel(cb: (p: ProgressPayload) => void): Channel<ProgressPayload> {
    const ch = new Channel<ProgressPayload>();
    ch.onmessage = cb;
    return ch;
  }
}

/** Keeps generated names from escaping the output folder or upsetting the OS. */
function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, '-')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .trim();
  return cleaned || 'output';
}
