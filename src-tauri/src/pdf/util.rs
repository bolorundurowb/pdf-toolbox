//! Small shared helpers: range parsing and output paths.

use std::path::{Path, PathBuf};

/// Parse a range string like "1-5, 8, 12-24" into inclusive 1-based ranges,
/// clamped to `[1, max]`. Mirrors the frontend logic so previews match output.
pub fn parse_ranges(text: &str, max: u32) -> Vec<(u32, u32)> {
    let mut out = Vec::new();
    for tok in text.split(',') {
        let tok = tok.trim();
        if tok.is_empty() {
            continue;
        }
        if let Some((a, b)) = tok.split_once('-') {
            if let (Ok(mut a), Ok(mut b)) = (a.trim().parse::<u32>(), b.trim().parse::<u32>()) {
                if a > b {
                    std::mem::swap(&mut a, &mut b);
                }
                let a = a.max(1);
                let b = b.min(max);
                if a <= b && a >= 1 {
                    out.push((a, b));
                }
            }
        } else if let Ok(p) = tok.parse::<u32>() {
            if p >= 1 && p <= max {
                out.push((p, p));
            }
        }
    }
    out
}

/// Return the file stem (name without extension) or a fallback.
pub fn stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Document")
        .to_string()
}

/// Build a non-clobbering output path inside `dir` for `file_name`.
/// If it exists, appends " (2)", " (3)", ... before the extension.
pub fn unique_path(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let p = Path::new(file_name);
    let stem = p
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output")
        .to_string();
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("");
    let mut n = 2;
    loop {
        let name = if ext.is_empty() {
            format!("{stem} ({n})")
        } else {
            format!("{stem} ({n}).{ext}")
        };
        let candidate = dir.join(&name);
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

/// File size in bytes, or 0 if unreadable.
pub fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}
