//! Each source document is renumbered into a shared object-ID space so that
//! internal references remain valid after the page trees are combined.

use std::collections::BTreeMap;
use std::path::Path;

use lopdf::{Document, Object, ObjectId};
use tauri::ipc::Channel;

use super::model::{MergeOptions, OperationResult, OutputFile, Progress};
use super::util::{check_files_limits, file_size, report, short_filename, unique_path};

fn type_of(object: &Object) -> Option<String> {
    object
        .as_dict()
        .ok()
        .and_then(|d| d.get(b"Type").ok())
        .and_then(|t| t.as_name().ok())
        .map(|n| String::from_utf8_lossy(n).to_string())
}

pub fn merge_pdfs(
    paths: Vec<String>,
    options: MergeOptions,
    out_dir: String,
    on_progress: &Channel<Progress>,
) -> Result<OperationResult, String> {
    if paths.is_empty() {
        return Err("No PDFs to merge.".to_string());
    }
    check_files_limits(&paths)?;
    let total = paths.len() as u32;
    report(on_progress, Progress::new(0, total, "Reading PDFs…"))?;

    let mut max_id = 1u32;
    let mut documents_pages: BTreeMap<ObjectId, Object> = BTreeMap::new();
    let mut documents_objects: BTreeMap<ObjectId, Object> = BTreeMap::new();
    let mut merged = Document::with_version("1.5");

    for (i, path) in paths.iter().enumerate() {
        let mut doc = Document::load(path)
            .map_err(|e| format!("Couldn't read {}: {e}", short_filename(path)))?;
        doc.renumber_objects_with(max_id);
        max_id = doc.max_id + 1;

        documents_pages.extend(
            doc.get_pages()
                .into_values()
                .map(|object_id| {
                    (
                        object_id,
                        doc.get_object(object_id).unwrap().to_owned(),
                    )
                })
                .collect::<BTreeMap<ObjectId, Object>>(),
        );
        documents_objects.extend(doc.objects);

        report(on_progress, Progress::new(
            (i + 1) as u32,
            total,
            format!("Added {}", short_filename(path)),
        ))?;
    }

    let mut catalog_object: Option<(ObjectId, Object)> = None;
    let mut pages_object: Option<(ObjectId, Object)> = None;

    for (object_id, object) in &documents_objects {
        match type_of(object).as_deref() {
            Some("Catalog") => {
                if catalog_object.is_none() {
                    catalog_object = Some((*object_id, object.clone()));
                }
            }
            Some("Pages") => {
                if let Ok(dict) = object.as_dict() {
                    let mut dict = dict.clone();
                    if let Some((_, prev)) = &pages_object {
                        if let Ok(prev_dict) = prev.as_dict() {
                            dict.extend(prev_dict);
                        }
                    }
                    pages_object = Some((
                        pages_object.map(|(id, _)| id).unwrap_or(*object_id),
                        Object::Dictionary(dict),
                    ));
                }
            }
            Some("Page") | Some("Outlines") | Some("Outline") => {}
            _ => {
                merged.objects.insert(*object_id, object.clone());
            }
        }
    }

    let pages_object = pages_object.ok_or("No page tree found in the source PDFs.")?;
    let catalog_object = catalog_object.ok_or("No catalog found in the source PDFs.")?;

    for (object_id, object) in &documents_pages {
        if let Ok(dict) = object.as_dict() {
            let mut dict = dict.clone();
            dict.set("Parent", pages_object.0);
            merged.objects.insert(*object_id, Object::Dictionary(dict));
        }
    }

    if let Ok(dict) = pages_object.1.as_dict() {
        let mut dict = dict.clone();
        dict.set("Count", documents_pages.len() as u32);
        dict.set(
            "Kids",
            documents_pages
                .keys()
                .map(|id| Object::Reference(*id))
                .collect::<Vec<_>>(),
        );
        merged
            .objects
            .insert(pages_object.0, Object::Dictionary(dict));
    }

    if let Ok(dict) = catalog_object.1.as_dict() {
        let mut dict = dict.clone();
        dict.set("Pages", pages_object.0);
        dict.remove(b"Outlines");
        merged
            .objects
            .insert(catalog_object.0, Object::Dictionary(dict));
    }

    merged.trailer.set("Root", catalog_object.0);
    merged.max_id = merged.objects.len() as u32;
    merged.renumber_objects();
    merged.compress();

    let base = options
        .output_name
        .as_deref()
        .map(|n| n.trim())
        .filter(|n| !n.is_empty())
        .unwrap_or("Merged document");
    let file_name = if base.to_lowercase().ends_with(".pdf") {
        base.to_string()
    } else {
        format!("{base}.pdf")
    };
    let out_path = unique_path(Path::new(&out_dir), &file_name);
    merged
        .save(&out_path)
        .map_err(|e| format!("Couldn't save merged PDF: {e}"))?;

    if options.optimize {
        let _ = on_progress.send(Progress::new(total, total, "Optimizing…"));
        super::compress::optimize_file(&out_path);
    }

    let _ = on_progress.send(Progress::new(total, total, "Done"));

    Ok(OperationResult {
        files: vec![OutputFile {
            name: out_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("Merged document.pdf")
                .to_string(),
            path: out_path.to_string_lossy().to_string(),
            size: file_size(&out_path),
            badge: None,
        }],
        out_dir,
    })
}
