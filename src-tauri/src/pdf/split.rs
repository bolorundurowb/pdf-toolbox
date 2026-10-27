//! Split one PDF into several: by page ranges, by max file size, by extracting
//! selected pages, every N pages, or by the document's bookmarks.

use std::collections::HashMap;
use std::path::Path;

use lopdf::{Dictionary, Document, Object, ObjectId};
use tauri::ipc::Channel;

use super::model::{OperationResult, OutputFile, Progress, SplitOptions};
use super::util::{
    check_file_limits, ensure_unlocked, file_size, output_path, pages_label, parse_ranges, report,
    stem, strip_pdf_ext, Clash,
};

const MAX_OUTLINE_ENTRIES: usize = 5000;

pub fn split_pdf(
    path: String,
    options: SplitOptions,
    out_dir: String,
    on_progress: &Channel<Progress>,
) -> Result<OperationResult, String> {
    super::cancel::reset();
    check_file_limits(Path::new(&path))?;
    let src = Document::load(&path).map_err(|e| format!("Couldn't read this PDF: {e}"))?;
    ensure_unlocked(&src, "This PDF")?;
    let page_count = src.get_pages().len() as u32;
    if page_count == 0 {
        return Err("This PDF has no pages.".to_string());
    }

    let base = options
        .output_name
        .as_deref()
        .map(|n| n.trim())
        .filter(|n| !n.is_empty())
        .map(|n| strip_pdf_ext(n).to_string())
        .unwrap_or_else(|| stem(Path::new(&path)));

    let subsets = match options.mode.as_str() {
        "ranges" => {
            let ranges = parse_ranges(&options.range_text, page_count);
            if ranges.is_empty() {
                return Err("No valid page ranges. Try something like 1-5, 8, 12-24.".to_string());
            }
            ranges
                .iter()
                .map(|(a, b)| {
                    let pages: Vec<u32> = (*a..=*b).collect();
                    (format!("{base} ({}).pdf", range_label(*a, *b)), pages)
                })
                .collect()
        }
        "size" => {
            let total_bytes = file_size(Path::new(&path));
            let max_bytes = (options.max_size_mb.max(0.1) * 1024.0 * 1024.0) as u64;
            let requested = ((total_bytes as f64 / max_bytes.max(1) as f64).ceil() as u32).max(1);
            let per = (page_count as f64 / requested as f64).ceil().max(1.0) as u32;
            let groups = chunks(page_count, per);
            name_parts(&base, groups)
        }
        "every" => {
            let per = options.every_pages.max(1);
            let groups = chunks(page_count, per);
            name_parts(&base, groups)
        }
        "extract" => {
            let mut pages: Vec<u32> = options
                .selected_pages
                .into_iter()
                .filter(|p| *p >= 1 && *p <= page_count)
                .collect();
            pages.sort_unstable();
            pages.dedup();
            if pages.is_empty() {
                return Err("No pages selected to extract.".to_string());
            }
            let label = pages_label(&pages);
            let noun = if pages.len() == 1 { "page" } else { "pages" };
            vec![(format!("{base} ({noun} {label}).pdf"), pages)]
        }
        "bookmarks" => {
            let starts = bookmark_starts(&src);
            if starts.is_empty() {
                return Err("This PDF has no bookmarks to split by.".to_string());
            }
            let mut starts = starts;
            starts.sort_unstable();
            starts.dedup();
            if starts.first().copied().unwrap_or(1) > 1 {
                starts.insert(0, 1);
            }
            starts
                .iter()
                .enumerate()
                .filter_map(|(i, &start)| {
                    let end = starts.get(i + 1).map(|next| next - 1).unwrap_or(page_count);
                    (start <= end).then(|| {
                        let pages: Vec<u32> = (start..=end).collect();
                        (format!("{base} ({}).pdf", range_label(start, end)), pages)
                    })
                })
                .collect()
        }
        other => return Err(format!("Unknown split mode: {other}")),
    };

    let total = subsets.len() as u32;
    let mut files = Vec::new();
    let clash = Clash::from_option(options.on_conflict.as_deref());

    for (i, (name, keep)) in subsets.into_iter().enumerate() {
        if super::cancel::is_cancelled() {
            return Ok(OperationResult::stopped(files, out_dir));
        }
        report(on_progress, Progress::new(i as u32, total, format!("Writing {name}")))?;

        let mut doc = src.clone();
        let to_delete: Vec<u32> = (1..=page_count).filter(|p| !keep.contains(p)).collect();
        doc.delete_pages(&to_delete);
        // Drop the fonts, images and content streams only the deleted pages used;
        // without this every part carried the whole document's resources, so
        // "split by size" produced parts about as large as the original.
        doc.prune_objects();
        doc.renumber_objects();
        doc.compress();

        let out_path = output_path(Path::new(&out_dir), &name, clash);
        doc.save(&out_path).map_err(|e| format!("Couldn't save {name}: {e}"))?;

        files.push(OutputFile {
            name: out_path.file_name().and_then(|s| s.to_str()).unwrap_or(&name).to_string(),
            path: out_path.to_string_lossy().to_string(),
            size: file_size(&out_path),
            badge: None,
        });
    }

    let _ = on_progress.send(Progress::new(total, total, "Done"));
    Ok(OperationResult::new(files, out_dir))
}

fn chunks(page_count: u32, per: u32) -> Vec<Vec<u32>> {
    let per = per.max(1);
    let mut groups = Vec::new();
    let mut start = 1u32;
    while start <= page_count {
        let end = (start + per - 1).min(page_count);
        groups.push((start..=end).collect());
        start = end + 1;
    }
    groups
}

fn name_parts(base: &str, groups: Vec<Vec<u32>>) -> Vec<(String, Vec<u32>)> {
    let total = groups.len();
    groups
        .into_iter()
        .enumerate()
        .map(|(i, pages)| (format!("{base} (part {} of {}).pdf", i + 1, total), pages))
        .collect()
}

fn range_label(start: u32, end: u32) -> String {
    if start == end {
        format!("page {start}")
    } else {
        format!("pages {start}-{end}")
    }
}

/// Top-level bookmark destinations, as 1-based page numbers.
fn bookmark_starts(doc: &Document) -> Vec<u32> {
    let page_map = doc.get_pages();
    let by_id: HashMap<ObjectId, u32> = page_map.iter().map(|(&no, &id)| (id, no)).collect();
    let Ok(catalog) = doc.catalog() else { return Vec::new() };
    let Ok(outlines) = catalog.get(b"Outlines") else { return Vec::new() };
    let outlines: &Dictionary = match outlines {
        Object::Reference(id) => match doc.get_dictionary(*id) {
            Ok(dict) => dict,
            Err(_) => return Vec::new(),
        },
        Object::Dictionary(dict) => dict,
        _ => return Vec::new(),
    };
    let Ok(first) = outlines.get(b"First") else { return Vec::new() };

    let mut starts = Vec::new();
    let mut node = first.clone();
    for _ in 0..MAX_OUTLINE_ENTRIES {
        let dict = match &node {
            Object::Reference(id) => match doc.get_dictionary(*id) {
                Ok(d) => d,
                Err(_) => break,
            },
            Object::Dictionary(d) => d,
            _ => break,
        };
        if let Some(page) = outline_page(doc, dict, &by_id) {
            starts.push(page);
        }
        match dict.get(b"Next") {
            Ok(next) => node = next.clone(),
            Err(_) => break,
        }
    }
    starts
}

fn outline_page(doc: &Document, dict: &Dictionary, by_id: &HashMap<ObjectId, u32>) -> Option<u32> {
    let dest = match dict.get(b"Dest") {
        Ok(dest) => dest,
        Err(_) => {
            let action = dict.get(b"A").ok()?;
            let action = match action {
                Object::Reference(id) => doc.get_object(*id).ok()?,
                other => other,
            };
            action.as_dict().ok()?.get(b"D").ok()?
        }
    };
    page_from_destination(doc, dest, by_id)
}

fn page_from_destination(doc: &Document, dest: &Object, by_id: &HashMap<ObjectId, u32>) -> Option<u32> {
    match dest {
        Object::Array(items) => items.first().and_then(|first| page_from_destination(doc, first, by_id)),
        Object::Reference(id) => by_id.get(id).copied().or_else(|| {
            doc.get_object(*id)
                .ok()
                .and_then(|object| object.as_array().ok())
                .and_then(|items| items.first())
                .and_then(|first| page_from_destination(doc, first, by_id))
        }),
        // An explicit page index is zero-based in the PDF specification.
        Object::Integer(index) => u32::try_from(*index + 1).ok(),
        Object::Real(value) => {
            let rounded = *value as i64 + 1;
            (rounded >= 1).then_some(rounded as u32)
        }
        _ => None,
    }
}
