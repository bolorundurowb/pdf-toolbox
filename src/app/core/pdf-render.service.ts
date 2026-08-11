import { Injectable, OnDestroy } from '@angular/core';
import { readFile } from '@tauri-apps/plugin-fs';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { ExtractImageFormat } from './models';

/** Where the locally-bundled pdf.js support files live (see angular.json assets). */
const PDFJS_ASSETS = 'assets/pdfjs/';

type PdfJs = typeof import('pdfjs-dist');

/** A page rendered to a bitmap, plus the URL to display it with. */
export interface Thumbnail {
  url: string;
  width: number;
  height: number;
}

export class PdfPasswordError extends Error {
  constructor() {
    super('This PDF is password protected. Remove the password first (Security → Unlock).');
  }
}

/**
 * Renders and reads PDFs in the frontend via pdf.js.
 *
 * pdf.js replaces the old pdfium native dependency: it powers page thumbnails,
 * page-to-image export and text extraction, and needs no platform binaries.
 * Everything stays on-device — the worker, cmaps, fonts and wasm are bundled
 * as local assets and nothing is fetched over the network.
 */
@Injectable({ providedIn: 'root' })
export class PdfRenderService implements OnDestroy {
  private lib: Promise<PdfJs> | null = null;
  private readonly docs = new Map<string, Promise<PDFDocumentProxy>>();
  /**
   * Promises rather than values, so two tiles asking for the same page share one
   * render. Caching the resolved value instead would let the second render's URL
   * overwrite the first, orphaning a blob that is still bound to an <img>.
   */
  private readonly thumbs = new Map<string, Promise<Thumbnail>>();

  /** Loads pdf.js on first use so it lands in a lazy chunk, not the initial bundle. */
  private pdfjs(): Promise<PdfJs> {
    this.lib ??= import('pdfjs-dist').then((m) => {
      m.GlobalWorkerOptions.workerSrc = `${PDFJS_ASSETS}pdf.worker.min.mjs`;
      return m;
    });
    return this.lib;
  }

  /** Opens a document (cached per path) and returns its page count. */
  async pageCount(path: string): Promise<number> {
    const doc = await this.document(path);
    return doc.numPages;
  }

  private document(path: string): Promise<PDFDocumentProxy> {
    let doc = this.docs.get(path);
    if (doc) return doc;

    doc = (async () => {
      const pdfjs = await this.pdfjs();
      const bytes = await readFile(path);
      // pdf.js takes ownership of (and detaches) the buffer it is handed, so
      // pass it a copy — the caller's Uint8Array stays usable.
      const data = new Uint8Array(bytes);
      try {
        return await pdfjs.getDocument({
          data,
          cMapUrl: `${PDFJS_ASSETS}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${PDFJS_ASSETS}standard_fonts/`,
          wasmUrl: `${PDFJS_ASSETS}wasm/`,
          iccUrl: `${PDFJS_ASSETS}iccs/`,
        }).promise;
      } catch (e) {
        if (isPasswordException(e)) throw new PdfPasswordError();
        throw new Error('Couldn’t read this PDF. It may be damaged.');
      }
    })();

    this.docs.set(path, doc);
    // A failed open must not poison the cache — the user may fix and retry.
    doc.catch(() => this.docs.delete(path));
    return doc;
  }

  /**
   * Renders a page small enough for a grid tile. Cached, so scrolling back to
   * an already-seen page is instant.
   */
  thumbnail(path: string, pageNo: number, targetWidth = 160, signal?: AbortSignal): Promise<Thumbnail> {
    const key = `${path}#${pageNo}@${targetWidth}`;
    const hit = this.thumbs.get(key);
    if (hit) return hit;

    // A shared render isn't tied to any one caller's signal — the first requester
    // scrolling away must not cancel a render a second tile is waiting on.
    const pending = this.renderThumbnail(path, pageNo, targetWidth);
    this.thumbs.set(key, pending);
    pending.catch(() => {
      // Don't cache failures; a retry should be able to succeed.
      if (this.thumbs.get(key) === pending) this.thumbs.delete(key);
    });

    if (!signal) return pending;
    return Promise.race([pending, rejectOnAbort(signal)]);
  }

  private async renderThumbnail(path: string, pageNo: number, targetWidth: number): Promise<Thumbnail> {
    const doc = await this.document(path);
    const page = await doc.getPage(pageNo);
    try {
      const base = page.getViewport({ scale: 1 });
      const thumb = await this.paint(page, targetWidth / base.width, 'png', 0.92);

      // dispose() may have run while this was in flight. Revoking here keeps the
      // blob from outliving the document it belongs to.
      if (!this.docs.has(path)) {
        URL.revokeObjectURL(thumb.url);
        throw new Error('Document closed.');
      }
      return thumb;
    } finally {
      page.cleanup();
    }
  }

  /** Renders a page at a print resolution and returns the encoded image bytes. */
  async renderToBytes(
    path: string,
    pageNo: number,
    dpi: number,
    format: ExtractImageFormat,
    quality = 0.92,
  ): Promise<Uint8Array> {
    const doc = await this.document(path);
    const page = await doc.getPage(pageNo);
    try {
      const { blob } = await this.paintBlob(page, Math.max(36, dpi) / 72, format, quality);
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      page.cleanup();
    }
  }

  /** Extracts a page's text, preserving line breaks reported by pdf.js. */
  async pageText(path: string, pageNo: number): Promise<string> {
    const doc = await this.document(path);
    const page = await doc.getPage(pageNo);
    try {
      const content = await page.getTextContent();
      let out = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        out += item.str;
        if (item.hasEOL) out += '\n';
      }
      return out;
    } finally {
      page.cleanup();
    }
  }

  /** Frees a document and every thumbnail rendered from it. */
  async dispose(path: string): Promise<void> {
    const doc = this.docs.get(path);
    this.docs.delete(path);

    for (const [key, pending] of this.thumbs) {
      if (!key.startsWith(`${path}#`)) continue;
      this.thumbs.delete(key);
      // In-flight renders resolve after this loop, so revoke on settle rather
      // than only for the ones that have already finished.
      void pending.then((thumb) => URL.revokeObjectURL(thumb.url)).catch(() => undefined);
    }

    if (doc) await doc.then((d) => d.loadingTask.destroy()).catch(() => undefined);
  }

  async ngOnDestroy(): Promise<void> {
    for (const path of [...this.docs.keys()]) await this.dispose(path);
  }

  private async paint(
    page: PDFPageProxy,
    scale: number,
    format: ExtractImageFormat,
    quality: number,
  ): Promise<Thumbnail> {
    const { blob, width, height } = await this.paintBlob(page, scale, format, quality);
    return { url: URL.createObjectURL(blob), width, height };
  }

  private async paintBlob(
    page: PDFPageProxy,
    scale: number,
    format: ExtractImageFormat,
    quality: number,
  ): Promise<{ blob: Blob; width: number; height: number }> {
    // The page's own /Rotate is honoured here; UI rotation is applied on top
    // as a CSS transform so the source document is never re-rendered for it.
    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));

    // A plain <canvas> rather than OffscreenCanvas: the latter is unavailable in
    // the WKWebView shipped with older macOS versions.
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const task: RenderTask = page.render({ canvas, viewport });
    await task.promise;

    const type = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const blob = await toBlob(canvas, type, quality);
    // Release the backing store promptly; large pages at 300 DPI are costly.
    canvas.width = 0;
    canvas.height = 0;
    return { blob, width, height };
  }
}

/** Lets a caller stop waiting on a shared render without cancelling it. */
function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
}

function isPasswordException(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: string }).name === 'PasswordException';
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Couldn’t encode this page as an image.'))),
      type,
      quality,
    );
  });
}
