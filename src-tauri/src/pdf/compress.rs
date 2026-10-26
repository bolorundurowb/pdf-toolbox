//! Image recompression accounts for most of the size reduction because raster
//! images typically dominate PDF file size. The approach is entirely in-process,
//! avoiding any runtime dependency on external tools.

use std::path::Path;

use image::GenericImageView;
use lopdf::{Dictionary, Document, Object, ObjectId};
use tauri::ipc::Channel;

use super::model::{CompressEstimate, CompressOptions, OperationResult, OutputFile, Progress};
use super::util::{check_files_limits, file_size, output_path, report, stem, Clash};

struct Profile {
    /// `None` means no downscaling — the image is re-encoded at its original size.
    max_dim: Option<u32>,
    quality: u8,
}

/// Five steps from gentlest to strongest. `low` and `high` are the names the
/// original three-stop slider used and are kept as aliases.
fn profile(level: &str) -> Profile {
    match level {
        "minimal" | "low" => Profile { max_dim: None, quality: 85 },
        "light" => Profile { max_dim: Some(2400), quality: 75 },
        "strong" => Profile { max_dim: Some(1200), quality: 55 },
        "extreme" | "high" => Profile { max_dim: Some(1000), quality: 45 },
        _ => Profile { max_dim: Some(1600), quality: 65 }, // balanced
    }
}

fn is_jpeg_image(dict: &Dictionary) -> bool {
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

fn resolve<'a>(doc: &'a Document, obj: &'a Object) -> &'a Object {
    match obj {
        Object::Reference(id) => doc.get_object(*id).unwrap_or(obj),
        other => other,
    }
}

/// Number of colour components, for the colour spaces a plain JPEG re-encode can
/// reproduce faithfully. Anything else (CMYK, Lab, Indexed, DeviceN…) is `None`.
fn components(doc: &Document, dict: &Dictionary) -> Option<i64> {
    let cs = resolve(doc, dict.get(b"ColorSpace").ok()?);
    match cs {
        Object::Name(n) => match n.as_slice() {
            b"DeviceRGB" | b"CalRGB" => Some(3),
            b"DeviceGray" | b"CalGray" => Some(1),
            _ => None,
        },
        Object::Array(arr) => match arr.first()?.as_name().ok()? {
            b"ICCBased" => {
                let stream = resolve(doc, arr.get(1)?).as_stream().ok()?;
                match stream.dict.get(b"N").ok()?.as_i64().ok()? {
                    n @ (1 | 3) => Some(n),
                    _ => None,
                }
            }
            b"CalRGB" => Some(3),
            b"CalGray" => Some(1),
            _ => None,
        },
        _ => None,
    }
}

/// JPEG images that can be decoded and re-encoded without visible damage, with
/// their component count. Transparency (`/SMask`, `/Mask`), `/Decode` arrays
/// (used by inverted CMYK JPEGs) and unusual colour spaces are left untouched —
/// recompressing those produced black boxes or colour-inverted images.
fn candidates(doc: &Document) -> Vec<(ObjectId, i64, usize)> {
    doc.objects
        .iter()
        .filter_map(|(id, obj)| {
            let Object::Stream(stream) = obj else { return None };
            let dict = &stream.dict;
            if !is_jpeg_image(dict) {
                return None;
            }
            if dict.has(b"SMask") || dict.has(b"Mask") || dict.has(b"Decode") || dict.has(b"ImageMask") {
                return None;
            }
            let comps = components(doc, dict)?;
            Some((*id, comps, stream.content.len()))
        })
        .collect()
}

/// Re-encodes one JPEG. Returns `None` if it can't be decoded or wouldn't shrink.
fn recompress_one(content: &[u8], prof: &Profile, gray: bool) -> Option<(Vec<u8>, u32, u32)> {
    let mut img = image::load_from_memory(content).ok()?;

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
    let ok = {
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, prof.quality);
        if gray {
            let luma = img.to_luma8();
            encoder.encode(luma.as_raw(), w, h, image::ExtendedColorType::L8).is_ok()
        } else {
            let rgb = img.to_rgb8();
            encoder.encode(rgb.as_raw(), w, h, image::ExtendedColorType::Rgb8).is_ok()
        }
    };
    (ok && jpeg.len() < content.len()).then_some((jpeg, w, h))
}

pub fn recompress_images(doc: &mut Document, level: &str, grayscale: bool) -> u32 {
    let prof = profile(level);
    let mut changed = 0u32;

    for (id, comps, _) in candidates(doc) {
        let Ok(Object::Stream(stream)) = doc.get_object_mut(id) else { continue };
        // A grey source stays grey; its colour space (often ICC with N=1) still fits.
        let gray = grayscale || comps == 1;
        let Some((jpeg, w, h)) = recompress_one(&stream.content, &prof, gray) else { continue };

        stream.dict.set("Width", w as i64);
        stream.dict.set("Height", h as i64);
        stream.dict.set("BitsPerComponent", 8i64);
        stream.dict.set("Filter", "DCTDecode");
        stream.dict.remove(b"DecodeParms");
        if grayscale && comps == 3 {
            stream.dict.set("ColorSpace", "DeviceGray");
        }
        stream.set_content(jpeg);
        changed += 1;
    }
    changed
}

/// Removes the document information dictionary and the XMP metadata stream —
/// leaving the XMP behind kept the same title/author visible in most readers.
fn strip_metadata(doc: &mut Document) {
    doc.trailer.remove(b"Info");
    if let Ok(catalog) = doc.catalog_mut() {
        catalog.remove(b"Metadata");
    }
    doc.prune_objects();
}

fn locked_error(name: &str) -> String {
    format!("{name} is password-protected. Remove the password first (Security → Remove Password).")
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
    super::cancel::reset();
    check_files_limits(&paths)?;
    let total = paths.len() as u32;
    let mut files = Vec::new();
    let clash = Clash::from_option(options.on_conflict.as_deref());

    for (i, path) in paths.iter().enumerate() {
        if super::cancel::is_cancelled() {
            return Ok(OperationResult::stopped(files, out_dir));
        }
        let name = format!("{} (compressed).pdf", stem(Path::new(path)));
        report(on_progress, Progress::new(i as u32, total, format!("Compressing {name}")))?;

        let in_size = file_size(Path::new(path));
        let mut doc = Document::load(path).map_err(|e| format!("Couldn't read {name}: {e}"))?;
        if doc.is_encrypted() {
            return Err(locked_error(&name));
        }

        recompress_images(&mut doc, &options.level, options.grayscale);
        if options.remove_metadata {
            strip_metadata(&mut doc);
        }
        doc.compress();

        let out_path = output_path(Path::new(&out_dir), &name, clash);
        doc.save(&out_path).map_err(|e| format!("Couldn't save {name}: {e}"))?;

        let out_size = file_size(&out_path);
        let badge = if in_size > 0 && out_size < in_size {
            let saved = ((1.0 - out_size as f64 / in_size as f64) * 100.0).round() as i64;
            if saved >= 1 { format!("-{saved}%") } else { "<1% smaller".to_string() }
        } else {
            // Say so plainly instead of the old, misleading "-0%".
            "No reduction".to_string()
        };

        files.push(OutputFile {
            name: out_path.file_name().and_then(|s| s.to_str()).unwrap_or(&name).to_string(),
            path: out_path.to_string_lossy().to_string(),
            size: out_size,
            badge: Some(badge),
        });
    }

    let _ = on_progress.send(Progress::new(total, total, "Done"));
    Ok(OperationResult::new(files, out_dir))
}

/// How many of the largest images are actually re-encoded when estimating.
const ESTIMATE_SAMPLES: usize = 6;

/// A quick, approximate preview of the compressed size of each file.
///
/// Re-encodes a sample of each file's largest images at the chosen level and
/// extrapolates the saving to the rest of its image data; non-image bytes are
/// assumed unchanged. Fast enough to re-run as the slider moves.
pub fn estimate_compression(paths: Vec<String>, options: CompressOptions) -> Vec<CompressEstimate> {
    let prof = profile(&options.level);
    paths
        .into_iter()
        .map(|path| {
            let original = file_size(Path::new(&path));
            let estimated = estimate_one(&path, original, &prof, options.grayscale).unwrap_or(original);
            CompressEstimate { path, original, estimated: estimated.min(original) }
        })
        .collect()
}

fn estimate_one(path: &str, original: u64, prof: &Profile, grayscale: bool) -> Option<u64> {
    let doc = Document::load(path).ok()?;
    if doc.is_encrypted() {
        return None;
    }

    let mut images = candidates(&doc);
    let image_bytes: u64 = images.iter().map(|(_, _, len)| *len as u64).sum();
    if image_bytes == 0 {
        return Some(original);
    }

    images.sort_by(|a, b| b.2.cmp(&a.2));
    let (mut before, mut after) = (0u64, 0u64);
    for (id, comps, len) in images.into_iter().take(ESTIMATE_SAMPLES) {
        let Ok(Object::Stream(stream)) = doc.get_object(id) else { continue };
        let new_len = recompress_one(&stream.content, prof, grayscale || comps == 1)
            .map(|(jpeg, _, _)| jpeg.len())
            .unwrap_or(len);
        before += len as u64;
        after += new_len as u64;
    }
    if before == 0 {
        return Some(original);
    }

    let ratio = after as f64 / before as f64;
    let other = original.saturating_sub(image_bytes);
    Some(other + (image_bytes as f64 * ratio).round() as u64)
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
    // Write beside the original and swap in, so a failed save can't leave a
    // truncated merged file behind.
    let tmp = path.with_extension("pdf.tmp");
    if doc.save(&tmp).is_err() {
        let _ = std::fs::remove_file(&tmp);
        return false;
    }
    std::fs::rename(&tmp, path).is_ok()
}
