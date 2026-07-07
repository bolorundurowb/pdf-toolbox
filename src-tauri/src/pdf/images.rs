//! Combine images into a single PDF.
//!
//! Each image is re-encoded to JPEG and embedded as a DCTDecode XObject, then
//! placed (aspect-preserving, centered) on a page whose size/orientation is
//! driven by the user's options. HEIC/HEIF are routed through an external
//! helper (see `heic`).

use std::path::Path;

use image::DynamicImage;
use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Dictionary, Document, Object, Stream};
use tauri::ipc::Channel;

use super::heic;
use super::model::{ImagesOptions, OperationResult, OutputFile, Progress};
use super::util::{file_size, unique_path};

pub fn images_to_pdf(
    paths: Vec<String>,
    options: ImagesOptions,
    out_dir: String,
    on_progress: &Channel<Progress>,
) -> Result<OperationResult, String> {
    if paths.is_empty() {
        return Err("No images to convert.".to_string());
    }
    let total = paths.len() as u32;

    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();

    let tmp_dir = std::env::temp_dir();
    let mut page_ids: Vec<Object> = Vec::new();

    for (i, path) in paths.iter().enumerate() {
        let _ = on_progress.send(Progress::new(i as u32, total, format!("Adding {}", short(path))));

        let img = load_image(path, &tmp_dir)?;
        let rgb = img.to_rgb8();
        let (w, h) = rgb.dimensions();

        // Re-encode to JPEG for a compact DCTDecode stream.
        let mut jpeg = Vec::new();
        {
            let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, options.quality.clamp(10, 100));
            enc.encode(rgb.as_raw(), w, h, image::ExtendedColorType::Rgb8)
                .map_err(|e| format!("Couldn't encode {}: {e}", short(path)))?;
        }

        let img_id = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => w as i64,
                "Height" => h as i64,
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
                "Filter" => "DCTDecode",
            },
            jpeg,
        ));

        let (pw, ph, dx, dy, dw, dh) = layout(
            w,
            h,
            &options.page_size,
            &options.orientation,
            options.margin,
        );
        let _ = options.optimize;

        let ops = vec![
            Operation::new("q", vec![]),
            Operation::new(
                "cm",
                vec![
                    real(dw),
                    real(0.0),
                    real(0.0),
                    real(dh),
                    real(dx),
                    real(dy),
                ],
            ),
            Operation::new("Do", vec![Object::Name(b"Im0".to_vec())]),
            Operation::new("Q", vec![]),
        ];

        let content = Content { operations: ops };
        let content_id = doc.add_object(Stream::new(
            dictionary! {},
            content.encode().map_err(|e| format!("Content error: {e}"))?,
        ));

        // Resources
        let mut xobjects = Dictionary::new();
        xobjects.set("Im0", Object::Reference(img_id));
        let mut resources = Dictionary::new();
        resources.set("XObject", Object::Dictionary(xobjects));
        let resources_id = doc.add_object(Object::Dictionary(resources));

        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => Object::Reference(pages_id),
            "Contents" => Object::Reference(content_id),
            "MediaBox" => vec![real(0.0), real(0.0), real(pw), real(ph)],
            "Resources" => Object::Reference(resources_id),
        });
        page_ids.push(Object::Reference(page_id));
    }

    let count = page_ids.len() as i64;
    let pages_dict = dictionary! {
        "Type" => "Pages",
        "Kids" => page_ids,
        "Count" => count,
    };
    doc.objects.insert(pages_id, Object::Dictionary(pages_dict));

    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => Object::Reference(pages_id),
    });
    doc.trailer.set("Root", Object::Reference(catalog_id));
    doc.compress();

    let out_path = unique_path(Path::new(&out_dir), "Images.pdf");
    doc.save(&out_path)
        .map_err(|e| format!("Couldn't save PDF: {e}"))?;

    let _ = on_progress.send(Progress::new(total, total, "Done"));

    Ok(OperationResult {
        files: vec![OutputFile {
            name: out_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("Images.pdf")
                .to_string(),
            path: out_path.to_string_lossy().to_string(),
            size: file_size(&out_path),
            badge: None,
        }],
        out_dir,
    })
}

fn load_image(path: &str, tmp_dir: &Path) -> Result<DynamicImage, String> {
    let p = Path::new(path);
    let ext = p
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext == "heic" || ext == "heif" {
        let png = heic::convert_to_png(p, tmp_dir)?;
        let img = image::open(&png).map_err(|e| format!("Couldn't read {}: {e}", short(path)))?;
        let _ = std::fs::remove_file(&png);
        Ok(img)
    } else {
        image::open(p).map_err(|e| format!("Couldn't read {}: {e}", short(path)))
    }
}

/// Compute page + image-placement geometry in PDF points.
/// Returns (page_w, page_h, draw_x, draw_y, draw_w, draw_h).
fn layout(
    px_w: u32,
    px_h: u32,
    page_size: &str,
    orientation: &str,
    margin_pt: f64,
) -> (f64, f64, f64, f64, f64, f64) {
    let (mut page_w, mut page_h) = match page_size {
        "letter" => (612.0, 792.0),
        "fit" => (px_w as f64 + 2.0 * margin_pt, px_h as f64 + 2.0 * margin_pt),
        _ => (595.276, 841.89), // A4
    };

    if page_size != "fit" {
        let landscape = match orientation {
            "landscape" => true,
            "portrait" => false,
            _ => px_w > px_h,
        };
        if landscape {
            std::mem::swap(&mut page_w, &mut page_h);
        }
    }

    let avail_w = (page_w - 2.0 * margin_pt).max(1.0);
    let avail_h = (page_h - 2.0 * margin_pt).max(1.0);
    let scale = (avail_w / px_w as f64).min(avail_h / px_h as f64);
    let draw_w = px_w as f64 * scale;
    let draw_h = px_h as f64 * scale;
    let draw_x = (page_w - draw_w) / 2.0;
    let draw_y = (page_h - draw_h) / 2.0;
    (page_w, page_h, draw_x, draw_y, draw_w, draw_h)
}

fn real(v: f64) -> Object {
    Object::Real(v as f32)
}

fn short(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
}

