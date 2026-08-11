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
| **Dashboard**    | Quick actions and recent files from your output folder                                   |
| **Image to PDF** | Combine JPG, PNG, TIFF, or HEIC into one PDF (page size, orientation, margin, quality)   |
| **Merge**        | Combine several PDFs into one (drag to reorder)                                          |
| **Organise**     | Reorder, rotate, duplicate, or delete pages and save a new PDF                           |
| **Compress**     | Shrink PDFs (Low / Recommended / Extreme), optional grayscale and strip metadata         |
| **Extract**      | Pick pages, then save them as text, PNG/JPG images, or a new PDF — or split by file size |
| **Security**     | Add a password (AES-256, AES-128, or RC4) or remove one you already know                 |
| **Metadata**     | View and edit Title, Author, Subject, Keywords, and Creator                              |

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

1. Open the tool you need from the sidebar (or a quick action on the Dashboard).
2. Add one or more files with **Add files** (or drag and drop where supported).
3. Adjust options in the panel (page size, passwords, compression level, etc.).
4. Run the action. Progress shows in the status view.
5. When it finishes, open the result file or its folder from the status panel.

Outputs are saved under your Documents folder in **PDF Toolbox** by default
(you can change the destination when prompted).

### Tips

- **Merge** — drag items in the list to change order before merging.
- **Organise / Extract** — tiles show a real preview of each page. Drag to
  reorder, or focus a tile and press Ctrl/Cmd with the arrow keys.
- **Merge → Optimize output** — recompresses the result to reduce size.
- **Organize** — pages are shown as numbered tiles; reorder, rotate, or remove, then save.
- **Security** — keep a copy of the password; locked PDFs cannot be recovered without it.
- **Extract text** — works on PDFs that contain real text. Scanned image-only PDFs have nothing to extract (OCR is not included).

## Privacy

PDF Toolbox never sends your files anywhere. Processing stays on your machine.

## License

[Apache License 2.0](LICENSE)
