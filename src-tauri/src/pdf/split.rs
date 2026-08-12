//! Split one PDF into several: by page ranges, by max file size, or by
//! extracting selected pages.

use std::path::Path;

use lopdf::Document;
use tauri::ipc::Channel;

use super::model::{OperationResult, OutputFile, Progress, SplitOptions};
use super::util::{check_file_limits, file_size, parse_ranges, report, stem, unique_path};

pub fn split_pdf(
    path: String,
    options: SplitOptions,
    out_dir: String,
    on_progress: &Channel<Progress>,
) -> Result<OperationResult, String> {
    check_file_limits(Path::new(&path))?;
    let src = Document::load(&path).map_err(|e| format!("Couldn't read this PDF: {e}"))?;
    let page_count = src.get_pages().len() as u32;
    if page_count == 0 {
        return Err("This PDF has no pages.".to_string());
    }

    let base = options
        .output_name
        .as_deref()
        .map(|n| n.trim())
        .filter(|n| !n.is_empty())
        .map(|n| n.trim_end_matches(".pdf").to_string())
        .unwrap_or_else(|| stem(Path::new(&path)));

    let subsets: Vec<(String, Vec<u32>)> = match options.mode.as_str() {
        "ranges" => {
            let ranges = parse_ranges(&options.range_text, page_count);
            if ranges.is_empty() {
                return Err("No valid page ranges. Try something like 1-5, 8, 12-24.".to_string());
            }
            ranges
                .iter()
                .enumerate()
                .map(|(i, (a, b))| (format!("{base}_part_{}.pdf", i + 1), (*a..=*b).collect()))
                .collect()
        }
        "size" => {
            let total_bytes = file_size(Path::new(&path));
            let max_bytes = (options.max_size_mb.max(0.1) * 1024.0 * 1024.0) as u64;
            let parts = ((total_bytes as f64 / max_bytes.max(1) as f64).ceil() as u32).max(1);
            let per = (page_count as f64 / parts as f64).ceil().max(1.0) as u32;
            let mut out = Vec::new();
            let mut start = 1u32;
            let mut idx = 1u32;
            while start <= page_count {
                let end = (start + per - 1).min(page_count);
                out.push((format!("{base}_part_{idx}.pdf"), (start..=end).collect()));
                start = end + 1;
                idx += 1;
            }
            out
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
            vec![(format!("{base} (selected pages).pdf"), pages)]
        }
        other => return Err(format!("Unknown split mode: {other}")),
    };

    let total = subsets.len() as u32;
    let mut files = Vec::new();

    for (i, (name, keep)) in subsets.into_iter().enumerate() {
        report(on_progress, Progress::new(i as u32, total, format!("Writing {name}")))?;

        let mut doc = src.clone();
        let to_delete: Vec<u32> = (1..=page_count).filter(|p| !keep.contains(p)).collect();
        doc.delete_pages(&to_delete);
        doc.renumber_objects();
        doc.compress();

        let out_path = unique_path(Path::new(&out_dir), &name);
        doc.save(&out_path).map_err(|e| format!("Couldn't save {name}: {e}"))?;

        files.push(OutputFile {
            name: out_path.file_name().and_then(|s| s.to_str()).unwrap_or(&name).to_string(),
            path: out_path.to_string_lossy().to_string(),
            size: file_size(&out_path),
            badge: None,
        });
    }

    let _ = on_progress.send(Progress::new(total, total, "Done"));
    Ok(OperationResult { files, out_dir })
}
