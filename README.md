<p align="center">
  <img src="assets/pdf-toolbox-logo.svg" alt="PDF Toolbox" width="128" />
</p>

# PDF Toolbox
[![Build](https://github.com/bolorundurowb/pdf-toolbox/actions/workflows/build.yml/badge.svg)](https://github.com/bolorundurowb/pdf-toolbox/actions/workflows/build.yml)

A local, offline desktop app for everyday PDF work. Everything runs on your
computer — no uploads, no cloud, no account.

## Features

| Tool             | What it does                                                                             |
|------------------|------------------------------------------------------------------------------------------|
| **Dashboard**    | A drop zone, recently opened files, and recent output from your output folder                |
| **Image to PDF** | Combine JPG, PNG, TIFF, WebP, HEIC, or HEIF into one PDF (page size, orientation, margin, quality) |
| **Merge**        | Combine several PDFs into one, with an optional page range per file (drag to reorder)    |
| **Organise**     | Reorder, rotate, duplicate, or delete pages; add watermarks, numbers, headers, footers, or crop |
| **Compress**     | Shrink PDFs (Minimal / Balanced / Extreme), optional grayscale and strip metadata        |
| **Extract**      | Save pages as text, PNG/JPG images, or a new PDF; split by size, every N pages, ranges, or bookmarks |
| **Convert**      | Convert a PDF into an editable Word document (.docx), with headings and page pictures     |
| **Security**     | Add a password (AES-256, AES-128, or RC4) or remove one you already know                 |
| **Metadata**     | View and edit Title, Author, Subject, Keywords, and Creator                              |
| **Settings**     | Output folder, name clashes, theme, and update checks                                     |

## Install

Download the installer for your platform from
[Releases](https://github.com/bolorundurowb/pdf-toolbox/releases).

| Platform    | What to get                                        |
|-------------|----------------------------------------------------|
| **Windows** | `.msi` or `.exe` installer                         |
| **macOS**   | `.dmg` (Apple Silicon or Intel, matching your Mac) |
| **Linux**   | `.deb`, `.rpm`, or `.AppImage`                     |

Install as usual for your OS, then open **PDF Toolbox** from your apps menu
or Start menu.

## How to use

1. Open the tool you need from the sidebar, or drop a file on the Dashboard.
2. Add one or more files with **Choose files** (or drag and drop where supported).
3. Adjust options in the panel (page size, passwords, compression level, etc.).
4. Run the action. Progress shows in the status view; **Cancel** stops between files, parts, or pages.
5. When it finishes, open the result file or its folder from the status panel, or send a PDF straight to another tool.

Outputs are saved to **Documents/PDF Toolbox** by default. Change the folder in
**Settings**, where you can also choose to be asked for a folder at the start of
every run. The same page decides whether a name clash keeps both files,
overwrites, or asks.

### Tips

- **Merge** — drag items to change order, and type a page range beside a file to use only those pages.
- **Organise / Extract** — tiles show a real preview of each page. Drag to reorder, focus a tile and press Ctrl/Cmd with the arrow keys, or double-click a tile for a large preview.
- **Merge → Optimise output** — recompresses the result to reduce size.
- **Organise** — Undo steps back through reorder, rotate, duplicate, and delete. Watermark, page numbers, header/footer, and crop are applied when you save.
- **Security** — keep a copy of the password; locked PDFs cannot be recovered without it.
- **Extract text** — works on PDFs that contain real text. Scanned image-only PDFs have nothing to extract (OCR is not included).
- **Extract → By bookmarks** — one PDF per top-level chapter; a document without an outline is reported and no files are written.
- **Convert** — short, large lines become Word headings, and a page with no text is embedded as a picture, so scanned pages remain visible.

## Privacy

PDF Toolbox processes files on this computer and never uploads them. The only
network request is an optional update check to GitHub: it runs at start-up and
every six hours, unless you turn automatic checks off in **Settings**. A manual
**Check now** always contacts GitHub.

## License

[Apache License 2.0](LICENSE)
