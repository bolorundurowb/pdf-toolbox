
<p align="center">
  <img src="assets/pdf-toolbox-logo.svg" alt="PDF Toolbox" width="128" />
</p>

# PDF Toolbox

[![Build](https://github.com/bolorundurowb/pdf-toolbox/actions/workflows/build.yml/badge.svg)](https://github.com/bolorundurowb/pdf-toolbox/actions/workflows/build.yml)

A local, offline desktop app for everyday PDF work. Built with **Tauri 2** (Rust) and
**Angular 22** (Material-3 / Tailwind). Everything runs on-device — no file leaves
your computer.

## Features

| Page              | What it does                                                                | Engine         |
|-------------------|-----------------------------------------------------------------------------|----------------|
| **Dashboard**     | Quick actions + recent output files from your save folder                   | filesystem     |
| **Image to PDF**  | Combine JPG/PNG/TIFF/HEIC into one PDF (size, orientation, margin, quality) | lopdf + image  |
| **Merge / Split** | Merge (drag-reorder) or split by ranges / max file size                     | lopdf          |
| **Organize**      | Reorder, rotate, and delete pages → new PDF                                 | lopdf          |
| **Compress**      | Shrink PDFs (Low / Recommended / Extreme, grayscale, strip metadata)        | lopdf          |
| **Extract**       | Text → `.txt` (pure Rust); pages → PNG/JPG (pdfium, optional)               | lopdf / pdfium |
| **Security**      | Add password (AES-256/128, RC4) or remove a known password                  | lopdf          |
| **Metadata**      | View / edit Title, Author, Subject, Keywords, Creator                       | lopdf          |

All core PDF tools are **pure Rust** via [lopdf](https://github.com/J-F-Liu/lopdf). The only
optional native dependency is pdfium for page-to-image export (off by default).

## Prerequisites

- **Node.js** 18+ and npm
- **Rust** stable and [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/)

## Quick start

```bash
git clone https://github.com/bolorundurowb/pdf-toolbox.git
cd pdf-toolbox
npm install
npm run tauri dev
```

## Build locally

```bash
npm install
npm run build          # Angular production build
npm run tauri build    # Desktop installer / bundle
```

Installers and bundles are written under `src-tauri/target/release/bundle/`.

### Optional: page rendering (pdfium)

**Extract → Pages as Images** is the one feature that still needs a native library, and
only when built with the `render` Cargo feature (off by default):

```bash
# place the platform library in src-tauri/resources/pdfium/ (see that README)
npm run tauri build -- --features render
```

Prebuilt binaries: [bblanchon/pdfium-binaries](https://github.com/bblanchon/pdfium-binaries/releases).

Without pdfium, text extraction and every other tool work normally.

## How compression works

Compression walks the PDF object table, finds JPEG (DCTDecode) image XObjects,
downsamples and re-encodes them at a quality driven by the chosen level (optionally to
grayscale), strips metadata when asked, and flate-compresses content streams. The
result is kept only if it is actually smaller. Merge's **Optimize output** toggle
reuses the same code.

## CI / releases

### Build workflow

[`build.yml`](.github/workflows/build.yml) runs on pushes and pull requests to
`main`/`master`, and can be triggered manually from the Actions tab. It:

1. Builds the Angular frontend on Ubuntu
2. Compiles the Rust backend on Ubuntu, Windows, and macOS

### Release workflow

[`release.yml`](.github/workflows/release.yml) is **on-demand only**
(`workflow_dispatch`). From **Actions → Release → Run workflow** you can set:

| Input             | Default                             | Purpose                                              |
|-------------------|-------------------------------------|------------------------------------------------------|
| **tag**           | `v<version>` from `tauri.conf.json` | Git tag and GitHub Release name                      |
| **draft**         | `true`                              | Keep the release unpublished until you review assets |
| **prerelease**    | `false`                             | Mark as pre-release                                  |
| **enable_render** | `false`                             | Build with the pdfium `render` feature               |

The workflow builds for **Windows x64**, **Linux x64**, **macOS Intel**, and
**macOS Apple Silicon**, then uploads installers to a
[new GitHub Release](https://github.com/bolorundurowb/pdf-toolbox/releases).

**Repository setting:** under **Settings → Actions → General → Workflow permissions**,
enable **Read and write permissions** so the release action can publish assets.

## Project layout

```
src/app/
  app.component.*     Shell (sidebar + top bar)
  app.routes.ts       Hash routing → 8 tool pages
  core/               models, pdf.service, runner, nav + tool config
  shared/             process-status panel
  pages/              dashboard, images, merge-split, organize, compress,
                      extract, security, metadata
src-tauri/
  src/pdf/            Rust PDF engines (see feature table above)
  resources/pdfium/   Optional pdfium library for page rendering
```

## Notes

- **Organize** shows numbered page tiles, not rendered thumbnails (thumbnails would
  need pdfium).
- **Split by size** distributes pages evenly into `ceil(fileSize / maxMB)` parts;
  exact per-part byte sizing would require rendering.
- Text extraction depends on the PDF — scanned/image-only PDFs have no extractable
  text (OCR is not bundled).
- A few unused legacy asset files may remain under `src/assets/`; safe to delete.

## License

[Apache License 2.0](LICENSE)
