# Bundled pdfium (optional)

Only needed for **Extract → Pages as Images**, and only when the app is built
with the `render` feature:

```bash
# build the Rust side with rendering enabled
cargo build --features render        # (or: tauri build -- --features render)
```

Rendering PDF pages has no pure-Rust implementation, so it uses pdfium. Place the
platform pdfium dynamic library here so it ships with the app:

- Windows: `pdfium.dll`
- macOS: `libpdfium.dylib`
- Linux: `libpdfium.so`

Prebuilt binaries: https://github.com/bblanchon/pdfium-binaries/releases
(download the one for your target, extract the library from its `bin/`/`lib/`).

The app resolves this folder at runtime; if the library is absent, page-to-image
export shows a friendly message and the other tools are unaffected. Binaries are
not committed (.gitignore). pdfium is BSD-3-Clause licensed.
