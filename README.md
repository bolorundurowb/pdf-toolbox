# PDF Toolbox

A local, offline desktop app for everyday PDF work. **Tauri 2** (Rust) +
**Angular 22** with a **Material-3 / Tailwind** design. Everything runs
on-device; no file leaves the computer.

## Features

| Page              | What it does                                                                | Engine         |
|-------------------|-----------------------------------------------------------------------------|----------------|
| **Dashboard**     | Quick actions + real "Recent Files" from your output folder                 | filesystem     |
| **Image to PDF**  | Combine JPG/PNG/TIFF/HEIC into one PDF (size, orientation, margin, quality) | lopdf + image  |
| **Merge / Split** | Merge (drag-reorder) or split by ranges / max file size                     | lopdf          |
| **Organize**      | Reorder, rotate, and delete pages → new PDF                                 | lopdf          |
| **Compress**      | Shrink PDFs (Low/Recommended/Extreme, grayscale, strip metadata)            | **pure Rust**  |
| **Extract**       | Text → `.txt` (pure Rust); pages → PNG/JPG (pdfium, optional)               | lopdf / pdfium |
| **Security**      | Add password (AES-256/128, RC4) or remove a known password                  | qpdf           |
| **Metadata**      | View / edit Title, Author, Subject, Keywords, Creator                       | lopdf          |

## How compression works (no external tool)

Compression is now **pure Rust**. Most of a PDF's size is its raster images, so
`compress.rs` walks the object table, finds JPEG (DCTDecode) image XObjects,
downsamples + re-encodes them at a quality driven by the level (optionally to
grayscale), strips metadata if asked, and flate-compresses content streams — then
keeps the result only if it's actually smaller. No Ghostscript required. Merge's
"Optimize output" toggle reuses the same code.

## Prerequisites

- Node 18+ and npm
- Rust stable + Tauri 2 system deps: https://tauri.app/start/prerequisites/

## Run / build

```bash
npm install
npm run tauri dev
npm run tauri build
```

## Optional external tools

Only two features need a native helper; everything else is pure Rust.

- **Security → qpdf.** Add/remove password + AES encryption. Bundled as an app
  resource; stage it with `pwsh scripts/fetch-qpdf.ps1`, then `npm run tauri build`.
  Resolution order at runtime: bundled resource → next to the app exe → `PATH` →
  `Program Files`. If absent, Security shows a friendly message.
- **Extract → Pages as Images → pdfium (opt-in).** Rasterizing pages has no
  pure-Rust option, so it's gated behind the `render` cargo feature and is OFF by
  default. To enable: build with the feature and drop the pdfium library into
  `src-tauri/resources/pdfium/` (see that folder's README). Without it, "Pages as
  Images" reports it isn't enabled; text extraction and all other tools work.

Ghostscript is **no longer used** (compression is pure Rust); the old
`fetch-ghostscript.ps1` script is obsolete.

## Architecture

```
src/app/
  app.component.*   Sidebar + topbar shell
  app.routes.ts     Hash routing → 8 pages
  core/             models, pdf.service (Tauri invoke), runner, nav.config, format
  shared/           process-status panel (processing / done / error)
  pages/            dashboard, images, merge-split, organize, compress, extract, security, metadata
src-tauri/src/pdf/
  inspect, images, merge, split, organize, compress (pure-Rust), extract (text),
  render (pdfium, feature-gated), security (qpdf), metadata, recents, heic, model, util
```

## Status / verification

- ✅ Frontend builds clean (dev + production), fonts/icons bundled offline.
- ⚠️ Rust was **not compiled in this environment** (no toolchain here). Run
  `cargo build` in `src-tauri` (add `--features render` for page rendering).

## Notes & open questions

1. **Extract → pages as images** is the one feature needing a native lib (pdfium),
   kept opt-in to preserve the pure-Rust default. *Open: bundle pdfium by default?*
2. **Organize** uses numbered page tiles (not rendered thumbnails), since
   thumbnails would also require pdfium. Reorder/rotate/delete are all real.
3. **Split by size** distributes pages evenly into `ceil(fileSize / maxMB)` parts
   (true per-part byte sizing needs rendering).
4. Text extraction quality depends on the PDF (scanned/image-only PDFs contain no
   extractable text — those need OCR, not bundled).
5. A few old, unreferenced Deel-era asset files remain under `src/assets` (the
   sandbox blocked deleting them); harmless, safe to delete locally.
