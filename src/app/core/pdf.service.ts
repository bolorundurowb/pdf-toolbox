import { Injectable } from '@angular/core';
import { Channel, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { documentDir, join } from '@tauri-apps/api/path';
import { mkdir, exists } from '@tauri-apps/plugin-fs';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  CompressOptions, ImagesOptions, InputFile, MergeOptions, OperationResult,
  PdfMetadata, ProgressPayload, RecentFile, SecurityOptions, SplitOptions,
  ExtractImageFormat, PageOp,
} from './models';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif', 'webp', 'heic', 'heif'];

@Injectable({ providedIn: 'root' })
export class PdfService {
  /** Pick PDF files. */
  async pickPdfs(multiple = true): Promise<string[]> {
    const sel = await open({ multiple, directory: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    return this.toArray(sel);
  }

  /** Pick image files. */
  async pickImages(multiple = true): Promise<string[]> {
    const sel = await open({ multiple, directory: false, filters: [{ name: 'Images', extensions: IMAGE_EXTS }] });
    return this.toArray(sel);
  }

  /** Pick a single PDF or image (used by the top-bar "Open File"). */
  async pickAny(): Promise<string | null> {
    const sel = await open({
      multiple: false, directory: false,
      filters: [{ name: 'PDF or image', extensions: ['pdf', ...IMAGE_EXTS] }],
    });
    return typeof sel === 'string' ? sel : null;
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

  extractText(path: string, outDir: string, onProgress: (p: ProgressPayload) => void) {
    return invoke<OperationResult>('extract_text', { path, outDir, onProgress: this.channel(onProgress) });
  }

  pagesToImages(path: string, imageFormat: ExtractImageFormat, dpi: number, outDir: string, onProgress: (p: ProgressPayload) => void) {
    return invoke<OperationResult>('pages_to_images', { path, imageFormat, dpi, outDir, onProgress: this.channel(onProgress) });
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
