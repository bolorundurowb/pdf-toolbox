//! Reorder, rotate, and delete pages, producing a new PDF.

use std::path::Path;

use lopdf::{Document, Object};
use tauri::ipc::Channel;

use super::model::{OperationResult, OutputFile, PageOp, Progress};
use super::util::{file_size, stem, unique_path};

pub fn organize_pdf(
    path: String,
    pages: Vec<PageOp>,
    out_dir: String,
    on_progress: &Channel<Progress>,
) -> Result<OperationResult, String> {
    if pages.is_empty() {
        return Err("Keep at least one page.".to_string());
    }
    let _ = on_progress.send(Progress::new(0, 1, "Reorganizing…"));

    let mut doc = Document::load(&path).map_err(|_| "Couldn't read this PDF.".to_string())?;
    let page_map = doc.get_pages(); // 1-based → object id

    let root_id = doc
        .catalog()
        .map_err(|_| "Invalid PDF (no catalog).".to_string())?
        .get(b"Pages")
        .map_err(|_| "Invalid PDF (no page tree).".to_string())?
        .as_reference()
        .map_err(|_| "Invalid PDF (bad page tree).".to_string())?;

    let mut kids: Vec<Object> = Vec::new();
    for op in &pages {
        let Some(&pid) = page_map.get(&op.source) else { continue };
        if let Ok(obj) = doc.get_object_mut(pid) {
            if let Ok(dict) = obj.as_dict_mut() {
                let existing = dict.get(b"Rotate").ok().and_then(|o| o.as_i64().ok()).unwrap_or(0);
                let rot = (((existing + op.rotate as i64) % 360) + 360) % 360;
                dict.set("Rotate", rot);
                dict.set("Parent", Object::Reference(root_id));
            }
        }
        kids.push(Object::Reference(pid));
    }
    if kids.is_empty() {
        return Err("No matching pages to keep.".to_string());
    }
    let count = kids.len() as i64;

    if let Ok(obj) = doc.get_object_mut(root_id) {
        if let Ok(dict) = obj.as_dict_mut() {
            dict.set("Kids", kids);
            dict.set("Count", count);
        }
    }

    doc.prune_objects();
    doc.renumber_objects();
    doc.compress();

    let name = format!("{} (organized).pdf", stem(Path::new(&path)));
    let out_path = unique_path(Path::new(&out_dir), &name);
    doc.save(&out_path).map_err(|e| format!("Couldn't save PDF: {e}"))?;

    let _ = on_progress.send(Progress::new(1, 1, "Done"));
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
