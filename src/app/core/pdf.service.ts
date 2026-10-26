import {Injectable} from '@angular/core';
import {Channel, invoke} from '@tauri-apps/api/core';
import {open} from '@tauri-apps/plugin-dialog';
import {documentDir, join} from '@tauri-apps/api/path';
import {mkdir, exists, writeFile, writeTextFile} from '@tauri-apps/plugin-fs';
import {openPath, openUrl, revealItemInDir} from '@tauri-apps/plugin-opener';
import {listen, UnlistenFn} from '@tauri-apps/api/event';
import {
    CompressEstimate, CompressOptions, ImagesOptions, InputFile, MergeOptions, OperationResult,
    OrganizeOptions, OutputFile, PdfMetadata, ProgressPayload, RecentFile, SecurityOptions, SplitOptions,
    PageOp, UpdateInfo,
} from './models';

// Must match src-tauri/src/pdf/inspect.rs IMAGE_EXTS.
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif', 'webp', 'heic', 'heif'];

@Injectable({providedIn: 'root'})
export class PdfService {
    async pickPdfs(multiple = true): Promise<string[]> {
        const sel = await open({multiple, directory: false, filters: [{name: 'PDF', extensions: ['pdf']}]});
        return this.toArray(sel);
    }

    async pickImages(multiple = true): Promise<string[]> {
        const sel = await open({multiple, directory: false, filters: [{name: 'Images', extensions: IMAGE_EXTS}]});
        return this.toArray(sel);
    }

    async pickAny(multiple = true): Promise<string[]> {
        const sel = await open({
            multiple,
            directory: false,
            filters: [
                {name: 'PDFs and images', extensions: ['pdf', ...IMAGE_EXTS]},
                {name: 'PDF', extensions: ['pdf']},
                {name: 'Images', extensions: IMAGE_EXTS},
            ],
        });
        return this.toArray(sel);
    }


    async inspect(paths: string[]): Promise<InputFile[]> {
        if (paths.length === 0) return [];
        return invoke<InputFile[]>('inspect_files', {paths});
    }

    async defaultOutputDir(): Promise<string> {
        const docs = await documentDir();
        const dir = await join(docs, 'PDF Toolbox');
        if (!(await exists(dir))) await mkdir(dir, {recursive: true});
        return dir;
    }

    imagesToPdf(paths: string[], options: ImagesOptions, outDir: string, onProgress: (p: ProgressPayload) => void) {
        return invoke<OperationResult>('images_to_pdf', {paths, options, outDir, onProgress: this.channel(onProgress)});
    }

    mergePdfs(paths: string[], options: MergeOptions, outDir: string, onProgress: (p: ProgressPayload) => void) {
        return invoke<OperationResult>('merge_pdfs', {paths, options, outDir, onProgress: this.channel(onProgress)});
    }

    splitPdf(path: string, options: SplitOptions, outDir: string, onProgress: (p: ProgressPayload) => void) {
        return invoke<OperationResult>('split_pdf', {path, options, outDir, onProgress: this.channel(onProgress)});
    }

    compressPdfs(paths: string[], options: CompressOptions, outDir: string, onProgress: (p: ProgressPayload) => void) {
        return invoke<OperationResult>('compress_pdfs', {paths, options, outDir, onProgress: this.channel(onProgress)});
    }

    estimateCompression(paths: string[], options: CompressOptions): Promise<CompressEstimate[]> {
        if (paths.length === 0) return Promise.resolve([]);
        return invoke<CompressEstimate[]>('estimate_compression', {paths, options});
    }

    encryptPdfs(paths: string[], options: SecurityOptions, outDir: string, onProgress: (p: ProgressPayload) => void) {
        return invoke<OperationResult>('encrypt_pdfs', {paths, options, outDir, onProgress: this.channel(onProgress)});
    }

    decryptPdfs(paths: string[], password: string, onConflict: string | undefined, outDir: string, onProgress: (p: ProgressPayload) => void) {
        return invoke<OperationResult>('decrypt_pdfs', {paths, password, onConflict, outDir, onProgress: this.channel(onProgress)});
    }

    getMetadata(path: string): Promise<PdfMetadata> {
        return invoke<PdfMetadata>('get_metadata', {path});
    }

    setMetadata(path: string, metadata: PdfMetadata, onConflict: string | undefined, outDir: string): Promise<OperationResult> {
        return invoke<OperationResult>('set_metadata', {path, metadata, onConflict, outDir});
    }

    /**
     * Writes bytes produced in the frontend (pdf.js renders text and images
     * locally) into the output folder.
     */
    async writeOutput(
        outDir: string,
        name: string,
        data: Uint8Array | string,
        onConflict: 'keep' | 'overwrite' = 'keep',
    ): Promise<OutputFile> {
        const path = onConflict === 'overwrite'
            ? await join(outDir, sanitizeFileName(name))
            : await this.uniqueOutputPath(outDir, name);
        if (typeof data === 'string') {
            await writeTextFile(path, data);
        } else {
            await writeFile(path, data);
        }

        const len = typeof data === 'string'
            ? new TextEncoder().encode(data).byteLength
            : data.byteLength;
        return {
            name: path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1),
            path,
            size: len,
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

    organizePdf(path: string, pages: PageOp[], options: OrganizeOptions, outDir: string, onProgress: (p: ProgressPayload) => void) {
        return invoke<OperationResult>('organize_pdf', {path, pages, options, outDir, onProgress: this.channel(onProgress)});
    }

    async recentOutputs(dir: string): Promise<RecentFile[]> {
        return invoke<RecentFile[]>('recent_outputs', {dir});
    }

    /** Stops a running job between files, parts or pages. */
    cancelJob(): Promise<void> {
        return invoke<void>('cancel_job');
    }

    /** PDF paths the app was launched with (file associations). */
    launchFiles(): Promise<string[]> {
        return invoke<string[]>('launch_files');
    }

    /** A PDF opened while the app is running, delivered by single-instance. */
    listenForOpenFiles(cb: (paths: string[]) => void): Promise<UnlistenFn> {
        return listen<string[]>('open-file', (event) => cb(event.payload));
    }

    appVersion(): Promise<string> {
        return invoke<string>('app_version');
    }

    checkUpdate(): Promise<UpdateInfo> {
        return invoke<UpdateInfo>('check_update');
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

    /** Opens a web link in the default browser (openPath is for local files). */
    async openUrl(url: string): Promise<void> {
        await openUrl(url);
    }

    private toArray(sel: string | string[] | null): string[] {
        if (!sel) {
            return [];
        }

        return Array.isArray(sel) ? sel : [sel];
    }

    private channel(cb: (p: ProgressPayload) => void): Channel<ProgressPayload> {
        const ch = new Channel<ProgressPayload>();
        ch.onmessage = cb;
        return ch;
    }
}

/** Must match src-tauri/src/pdf/util.rs::sanitize_file_name exactly. */
function sanitizeFileName(name: string): string {
    const cleaned = [...name]
        .map((c) => {
            switch (c) {
                case '/':
                case '\\':
                    return '-';
                case '<':
                case '>':
                case ':':
                case '"':
                case '|':
                case '?':
                case '*':
                    return '_';
                default:
                    return c <= '\u{001f}' ? '_' : c;
            }
        })
        .join('')
        .trim();

    if (!cleaned || [...cleaned].every((c) => c === '.')) return 'output';
    return cleaned;
}
