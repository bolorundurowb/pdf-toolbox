# Bundled Ghostscript

The **Compress PDF** tool uses Ghostscript. To ship it with the app so users
don't install anything, place the Ghostscript **console** executable and its
runtime library here before running `npm run tauri build`:

- Windows: `gswin64c.exe` **and** `gsdll64.dll`
- macOS/Linux: the `gs` binary (plus any shared libs it needs)

The app resolves this folder at runtime (Tauri resource dir → `ghostscript/`).
The easiest way to populate it is the helper script:

```powershell
# from the project root, after Ghostscript is installed on the build machine
pwsh scripts/fetch-ghostscript.ps1
```

These binaries are **not committed** (see .gitignore) and are GPL/AGPL licensed;
if you distribute the app externally, include Ghostscript's license and,
for AGPL, an offer of source. For internal Deel use this is fine.
