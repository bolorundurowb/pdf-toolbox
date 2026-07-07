# Bundled qpdf

The **Security** tool (add/remove password, encryption) uses qpdf. To ship it so
users install nothing, stage the qpdf binary + its DLLs here before building:

- Windows: `qpdf.exe` **and** every `*.dll` from qpdf's `bin` folder
- macOS/Linux: the `qpdf` binary (plus any shared libs it needs)

Populate it with the helper script (from the project root):

```powershell
pwsh scripts/fetch-qpdf.ps1
```

The app resolves this folder at runtime (Tauri resource dir → `qpdf/`).
Binaries are **not committed** (.gitignore) and qpdf is Apache-2.0 licensed.
