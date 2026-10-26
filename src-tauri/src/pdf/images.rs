//! Images are re-encoded to JPEG before embedding so the output uses a single,
//! predictable decode filter (DCTDecode) regardless of the source format.

use std::path::Path;

use image::{DynamicImage, ImageDecoder, ImageReader, RgbImage};
use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Dictionary, Document, Object, Stream};
use tauri::ipc::Channel;

use super::model::{ImagesOptions, OperationResult, OutputFile, Progress};
use super::util::{
    check_files_limits, ensure_file_id, file_size, first_and_more, output_path, report, short_filename,
    strip_pdf_ext, Clash,
};

pub fn images_to_pdf(
    paths: Vec<String>,
    options: ImagesOptions,
    out_dir: String,
    on_progress: &Channel<Progress>,
) -> Result<OperationResult, String> {
    if paths.is_empty() {
        return Err("No images to convert.".to_string());
    }
    super::cancel::reset();
    check_files_limits(&paths)?;
    let total = paths.len() as u32;

    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();

    let mut page_ids: Vec<Object> = Vec::new();

    for (i, path) in paths.iter().enumerate() {
        if super::cancel::is_cancelled() {
            return Ok(OperationResult::stopped(Vec::new(), out_dir));
        }
        report(on_progress, Progress::new(i as u32, total, format!("Adding {}", short_filename(path))))?;

        let img = load_image(path)?;
        let rgb = flatten_onto_white(&img);
        let (w, h) = rgb.dimensions();

        let mut jpeg = Vec::new();
        {
            let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, options.quality.clamp(10, 100));
            enc.encode(rgb.as_raw(), w, h, image::ExtendedColorType::Rgb8)
                .map_err(|e| format!("Couldn't encode {}: {e}", short_filename(path)))?;
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
    ensure_file_id(&mut doc);

    if super::cancel::is_cancelled() {
        return Ok(OperationResult::stopped(Vec::new(), out_dir));
    }

    let base = options
        .output_name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(strip_pdf_ext)
        .filter(|n| !n.is_empty())
        .map(|n| n.to_string())
        .unwrap_or_else(|| first_and_more(&paths));
    let out_path = output_path(
        Path::new(&out_dir),
        &format!("{}.pdf", base),
        Clash::from_option(options.on_conflict.as_deref()),
    );
    doc.save(&out_path)
        .map_err(|e| format!("Couldn't save PDF: {e}"))?;

    let _ = on_progress.send(Progress::new(total, total, "Done"));
    Ok(OperationResult::new(
        vec![OutputFile {
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
    ))
}

/// Decodes an image upright: phone photos are usually stored sideways with an
/// EXIF orientation tag, which `image::open` ignores — they came out rotated.
/// HEIC/HEIF files go through `heif-oxide`, which has already applied the
/// container's rotation, so the EXIF pass must be skipped for them.
fn load_image(path: &str) -> Result<DynamicImage, String> {
    if super::heic::is_heif(path) {
        return super::heic::decode(path);
    }
    let err = |e: &dyn std::fmt::Display| format!("Couldn't read {}: {e}", short_filename(path));
    let mut decoder = ImageReader::open(Path::new(path))
        .and_then(|r| r.with_guessed_format())
        .map_err(|e| err(&e))?
        .into_decoder()
        .map_err(|e| err(&e))?;
    let orientation = decoder.orientation().ok();
    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| err(&e))?;
    if let Some(o) = orientation {
        img.apply_orientation(o);
    }
    Ok(img)
}

/// JPEG has no alpha channel. Dropping it outright turned transparent areas of
/// PNGs black, so composite onto white (what a page looks like) instead.
fn flatten_onto_white(img: &DynamicImage) -> RgbImage {
    if !img.color().has_alpha() {
        return img.to_rgb8();
    }
    let rgba = img.to_rgba8();
    RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let [r, g, b, a] = rgba.get_pixel(x, y).0;
        let a = a as u16;
        let blend = |c: u8| ((c as u16 * a + 255 * (255 - a) + 127) / 255) as u8;
        image::Rgb([blend(r), blend(g), blend(b)])
    })
}

/// Longest side of a "fit to image" page, in points (about 1.27 m).
const FIT_MAX_PT: f64 = 3600.0;

/// Returns `(page_w, page_h, draw_x, draw_y, draw_w, draw_h)` in PDF points.
fn layout(
    px_w: u32,
    px_h: u32,
    page_size: &str,
    orientation: &str,
    margin_pt: f64,
) -> (f64, f64, f64, f64, f64, f64) {
    let (mut page_w, mut page_h) = match page_size {
        "letter" => (612.0, 792.0),
        "fit" => {
            // Treat pixels as 96 dpi (0.75 pt each) and cap the longer side well
            // under the 14,400 pt limit many readers enforce, so large photos
            // don't produce enormous or invalid pages.
            let scale = 0.75_f64.min(FIT_MAX_PT / px_w.max(px_h).max(1) as f64);
            (px_w as f64 * scale + 2.0 * margin_pt, px_h as f64 * scale + 2.0 * margin_pt)
        }
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


