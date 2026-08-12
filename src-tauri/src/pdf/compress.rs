//! Image recompression accounts for most of the size reduction because raster
//! images typically dominate PDF file size. The approach is entirely in-process,
//! avoiding any runtime dependency on external tools.

use std::path::Path;

use image::GenericImageView;
use lopdf::{Document, Object};
use tauri::ipc::Channel;

use super::model::{CompressOptions, OperationResult, OutputFile, Progress};
use super::util::{check_files_limits, file_size, report, stem, unique_path};

struct Profile {
    /// `None` means no downscaling — the image is re-encoded at its original size.
    max_dim: Option<u32>,
    quality: u8,
}

fn profile(level: &str) -> Profile {
    match level {
        "low" => Profile { max_dim: None, quality: 82 },
        "high" => Profile { max_dim: Some(1000), quality: 45 },
        _ => Profile { max_dim: Some(1600), quality: 65 }, // balanced
    }
}

fn is_jpeg_image(dict: &lopdf::Dictionary) -> bool {
    let is_image = dict
        .get(b"Subtype")
        .ok()
        .and_then(|o| o.as_name().ok())
        .map(|n| n == b"Image")
        .unwrap_or(false);
    if !is_image {
        return false;
    }
    match dict.get(b"Filter") {
        Ok(Object::Name(n)) => n == b"DCTDecode",
        Ok(Object::Array(arr)) => {
            arr.len() == 1 && arr.iter().any(|o| o.as_name().map(|n| n == b"DCTDecode").unwrap_or(false))
        }
        _ => false,
    }
}

pub fn recompress_images(doc: &mut Document, level: &str, grayscale: bool) -> u32 {
    let prof = profile(level);
    let ids: Vec<(u32, u16)> = doc.objects.keys().cloned().collect();
    let mut changed = 0u32;

    for id in ids {
        let Ok(obj) = doc.get_object_mut(id) else { continue };
        let Object::Stream(stream) = obj else { continue };
        if !is_jpeg_image(&stream.dict) {
            continue;
        }
        let Ok(mut img) = image::load_from_memory(&stream.content) else { continue };

        if let Some(max) = prof.max_dim {
            let (w, h) = img.dimensions();
            if w.max(h) > max {
                let scale = max as f32 / w.max(h) as f32;
                let nw = ((w as f32 * scale).round() as u32).max(1);
                let nh = ((h as f32 * scale).round() as u32).max(1);
                img = img.resize(nw, nh, image::imageops::FilterType::Triangle);
            }
        }

        let (w, h) = img.dimensions();
        let mut jpeg = Vec::new();
        let ok = if grayscale {
            let luma = img.to_luma8();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, prof.quality)
                .encode(luma.as_raw(), w, h, image::ExtendedColorType::L8)
                .is_ok()
        } else {
            let rgb = img.to_rgb8();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, prof.quality)
                .encode(rgb.as_raw(), w, h, image::ExtendedColorType::Rgb8)
                .is_ok()
        };
        if !ok || jpeg.len() >= stream.content.len() {
            // Skip if encoding failed or didn't help.
            continue;
        }

        stream.dict.set("Width", w as i64);
        stream.dict.set("Height", h as i64);
        stream.dict.set("ColorSpace", if grayscale { "DeviceGray" } else { "DeviceRGB" });
        stream.dict.set("BitsPerComponent", 8i64);
        stream.dict.set("Filter", "DCTDecode");
        stream.dict.remove(b"DecodeParms");
        stream.dict.remove(b"SMask");
        stream.set_content(jpeg);
        changed += 1;
    }
    changed
}

fn strip_metadata(doc: &mut Document) {
    if let Ok(Object::Reference(id)) = doc.trailer.get(b"Info") {
        let id = *id;
        if let Ok(obj) = doc.get_object_mut(id) {
            if let Ok(dict) = obj.as_dict_mut() {
                for k in [b"Title".as_ref(), b"Author", b"Subject", b"Keywords", b"Creator", b"Producer"] {
                    dict.remove(k);
                }
            }
        }
    }
}

pub fn compress_pdfs(
    paths: Vec<String>,
    options: CompressOptions,
    out_dir: String,
    on_progress: &Channel<Progress>,
) -> Result<OperationResult, String> {
    if paths.is_empty() {
        return Err("No PDFs to compress.".to_string());
    }
    check_files_limits(&paths)?;
    let total = paths.len() as u32;
    let mut files = Vec::new();

    for (i, path) in paths.iter().enumerate() {
        let name = format!("{} (compressed).pdf", stem(Path::new(path)));
        report(on_progress, Progress::new(i as u32, total, format!("Compressing {name}")))?;

        let in_size = file_size(Path::new(path));
        let mut doc = Document::load(path).map_err(|e| format!("Couldn't read {name}: {e}"))?;

        recompress_images(&mut doc, &options.level, options.grayscale);
        if options.remove_metadata {
            strip_metadata(&mut doc);
        }
        doc.compress();

        let out_path = unique_path(Path::new(&out_dir), &name);
        doc.save(&out_path).map_err(|e| format!("Couldn't save {name}: {e}"))?;

        let out_size = file_size(&out_path);
        let saved = if in_size > 0 && out_size < in_size {
            ((1.0 - out_size as f64 / in_size as f64) * 100.0).round() as i64
        } else {
            0
        };

        files.push(OutputFile {
            name: out_path.file_name().and_then(|s| s.to_str()).unwrap_or(&name).to_string(),
            path: out_path.to_string_lossy().to_string(),
            size: out_size,
            badge: Some(format!("-{saved}%")),
        });
    }

    let _ = on_progress.send(Progress::new(total, total, "Done"));
    Ok(OperationResult { files, out_dir })
}

/// Called after merge when the user enables the optimize toggle, so the merged
/// output is compacted without requiring a separate compress pass.
pub fn optimize_file(path: &Path) -> bool {
    let Ok(mut doc) = Document::load(path) else { return false };
    let changed = recompress_images(&mut doc, "balanced", false);
    doc.compress();
    if changed == 0 {
        return false;
    }
    doc.save(path).is_ok()
}
