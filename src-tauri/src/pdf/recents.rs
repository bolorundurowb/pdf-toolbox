//! List recently produced PDFs from the output directory (for the dashboard).

use std::path::Path;
use std::time::UNIX_EPOCH;

use super::model::RecentFile;

pub fn recent_outputs(dir: &str) -> Vec<RecentFile> {
    let path = Path::new(dir);
    let mut out: Vec<RecentFile> = Vec::new();

    let Ok(entries) = std::fs::read_dir(path) else {
        return out;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        let is_pdf = p.extension().and_then(|s| s.to_str()).map(|e| e.eq_ignore_ascii_case("pdf")).unwrap_or(false);
        if !is_pdf {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let modified = meta
            .modified()
            .ok()
            .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        out.push(RecentFile {
            name: p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string(),
            path: p.to_string_lossy().to_string(),
            size: meta.len(),
            modified,
        });
    }

    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out.truncate(20);
    out
}
