//! Extract text content from a PDF (pure Rust, via lopdf).

use std::path::Path;

use lopdf::Document;

use super::model::{OperationResult, OutputFile, Progress};
use super::util::{file_size, stem, unique_path};
use tauri::ipc::Channel;

pub fn extract_text(
    path: String,
    out_dir: String,
    on_progress: &Channel<Progress>,
) -> Result<OperationResult, String> {
    let _ = on_progress.send(Progress::new(0, 1, "Reading PDF…"));
    let doc = Document::load(&path).map_err(|_| "Couldn't read this PDF.".to_string())?;

    let page_numbers: Vec<u32> = doc.get_pages().keys().cloned().collect();
    if page_numbers.is_empty() {
        return Err("This PDF has no pages.".to_string());
    }

    let mut text = String::new();
    let total = page_numbers.len() as u32;
    for (i, n) in page_numbers.iter().enumerate() {
        if let Ok(page_text) = doc.extract_text(&[*n]) {
            text.push_str(&page_text);
            if !page_text.ends_with('\n') {
                text.push('\n');
            }
        }
        text.push('\u{000C}'); // form-feed page separator
        let _ = on_progress.send(Progress::new((i + 1) as u32, total, format!("Page {}", i + 1)));
    }

    let name = format!("{}.txt", stem(Path::new(&path)));
    let out_path = unique_path(Path::new(&out_dir), &name);
    std::fs::write(&out_path, text).map_err(|e| format!("Couldn't write text file: {e}"))?;

    let _ = on_progress.send(Progress::new(total, total, "Done"));
    Ok(OperationResult {
        files: vec![OutputFile {
            name: out_path.file_name().and_then(|s| s.to_str()).unwrap_or(&name).to_string(),
            path: out_path.to_string_lossy().to_string(),
            size: file_size(&out_path),
            badge: None,
        }],
        out_dir,
    })
}
