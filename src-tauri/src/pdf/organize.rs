//! Reorder, rotate, duplicate, and delete pages, producing a new PDF.

use std::collections::HashMap;
use std::path::Path;

use lopdf::{Dictionary, Document, Object};
use tauri::ipc::Channel;

use super::model::{OperationResult, OutputFile, PageOp, Progress};
use super::util::{check_file_limits, file_size, report, stem, unique_path};

pub fn organize_pdf(
    path: String,
    pages: Vec<PageOp>,
    out_dir: String,
    on_progress: &Channel<Progress>,
) -> Result<OperationResult, String> {
    if pages.is_empty() {
        return Err("Keep at least one page.".to_string());
    }
    check_file_limits(Path::new(&path))?;
    report(on_progress, Progress::new(0, 1, "Reorganizing…"))?;

    let mut doc = Document::load(&path).map_err(|e| format!("Couldn't read this PDF: {e}"))?;
    let page_map = doc.get_pages(); // 1-based → object id

    let root_id = doc
        .catalog()
        .map_err(|e| format!("Invalid PDF (no catalog): {e}"))?
        .get(b"Pages")
        .map_err(|e| format!("Invalid PDF (no page tree): {e}"))?
        .as_reference()
        .map_err(|e| format!("Invalid PDF (bad page tree): {e}"))?;

    // Snapshot each page's starting rotation before anything is mutated. Reading
    // it back off the dictionary mid-loop would compound the added rotation every
    // time a page appears more than once.
    let base_rotations: HashMap<u32, i64> = page_map
        .iter()
        .map(|(&page_no, &pid)| (page_no, inherited_rotation(&doc, pid)))
        .collect();

    let mut kids: Vec<Object> = Vec::new();
    let mut used: Vec<u32> = Vec::new();

    for op in &pages {
        let Some(&pid) = page_map.get(&op.source) else { continue };

        let base = base_rotations.get(&op.source).copied().unwrap_or(0);
        let rot = (((base + op.rotate as i64) % 360) + 360) % 360;

        // The first appearance reuses the original object. Later ones need a copy:
        // repeating an object id in /Kids would make the page tree a DAG, and the
        // duplicates would share one dictionary — so rotation, annotations and
        // later page deletions would all alias across every instance.
        let target = if used.contains(&op.source) {
            let Some(copy) = clone_page_dict(&doc, pid) else { continue };
            doc.add_object(Object::Dictionary(copy))
        } else {
            used.push(op.source);
            pid
        };

        if let Ok(obj) = doc.get_object_mut(target) {
            if let Ok(dict) = obj.as_dict_mut() {
                dict.set("Rotate", rot);
                dict.set("Parent", Object::Reference(root_id));
            }
        }
        kids.push(Object::Reference(target));
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

/// `/Rotate` is an inheritable attribute, so a page may get its value from an
/// ancestor `Pages` node. Walking the `/Parent` chain avoids writing an explicit
/// `/Rotate 0` that would shadow an inherited rotation once the tree is rebuilt.
fn inherited_rotation(doc: &Document, page_id: (u32, u16)) -> i64 {
    let mut current = page_id;
    // Bounded so a malformed document with a cyclic /Parent chain can't hang.
    for _ in 0..32 {
        let Ok(dict) = doc.get_object(current).and_then(|o| o.as_dict()) else { return 0 };
        if let Some(rotate) = dict.get(b"Rotate").ok().and_then(|o| o.as_i64().ok()) {
            return rotate;
        }
        match dict.get(b"Parent").ok().and_then(|o| o.as_reference().ok()) {
            Some(parent) => current = parent,
            None => return 0,
        }
    }
    0
}

/// Copies a page dictionary so a duplicated page becomes its own object. The
/// content streams and resources stay shared by reference, which is what we want
/// — only the page node itself needs to be distinct.
fn clone_page_dict(doc: &Document, page_id: (u32, u16)) -> Option<Dictionary> {
    doc.get_object(page_id).ok()?.as_dict().ok().cloned()
}
