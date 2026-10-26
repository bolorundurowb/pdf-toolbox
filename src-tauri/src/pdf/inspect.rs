//! Files are inspected upfront so the UI can surface page counts, image
//! dimensions, and encryption or damage errors before any operation begins.

use std::path::Path;

use super::model::FileInfo;
use super::util::file_size;

const IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "bmp", "tiff", "tif", "webp", "heic", "heif",
];

pub fn inspect_files(paths: Vec<String>) -> Vec<FileInfo> {
    paths.into_iter().map(|p| inspect_one(&p)).collect()
}

fn base(path_str: &str, kind: &str) -> FileInfo {
    let path = Path::new(path_str);
    FileInfo {
        path: path_str.to_string(),
        name: path.file_name().and_then(|s| s.to_str()).unwrap_or(path_str).to_string(),
        size: file_size(path),
        pages: None,
        kind: kind.to_string(),
        error: None,
        width: None,
        height: None,
    }
}

fn inspect_one(path_str: &str) -> FileInfo {
    let ext = Path::new(path_str)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext == "pdf" {
        return inspect_pdf(path_str);
    }
    if IMAGE_EXTS.contains(&ext.as_str()) {
        return inspect_image(path_str, &ext);
    }
    let mut info = base(path_str, "pdf");
    info.error = Some("Unsupported format".to_string());
    info
}

fn inspect_pdf(path_str: &str) -> FileInfo {
    let mut info = base(path_str, "pdf");
    match lopdf::Document::load(path_str) {
        Ok(doc) => {
            if doc.is_encrypted() {
                info.error = Some("Password-protected".to_string());
            } else {
                info.pages = Some(doc.get_pages().len() as u32);
            }
        }
        Err(_) => {
            info.error = Some("Couldn't read this PDF. It may be damaged or protected.".to_string());
        }
    }
    info
}

fn inspect_image(path_str: &str, _ext: &str) -> FileInfo {
    let mut info = base(path_str, "image");
    let dimensions = if super::heic::is_heif(path_str) {
        super::heic::dimensions(path_str)
    } else {
        upright_dimensions(path_str).ok_or_else(|| "Unsupported or unreadable image".to_string())
    };
    match dimensions {
        Ok((w, h)) => {
            info.width = Some(w);
            info.height = Some(h);
        }
        Err(message) => info.error = Some(message),
    }
    info
}

/// Pixel size as the image will appear once its EXIF orientation is applied,
/// so a portrait phone photo isn't reported (and laid out) as landscape.
fn upright_dimensions(path_str: &str) -> Option<(u32, u32)> {
    use image::metadata::Orientation;
    use image::ImageDecoder;

    // `heif-oxide` applies the container's rotation and returns display-ready
    // dimensions, so the EXIF pass below must not run for these files.
    if super::heic::is_heif(path_str) {
        return super::heic::dimensions(path_str).ok();
    }

    let mut decoder = image::ImageReader::open(Path::new(path_str))
        .ok()?
        .with_guessed_format()
        .ok()?
        .into_decoder()
        .ok()?;
    let (w, h) = decoder.dimensions();
    let quarter_turn = matches!(
        decoder.orientation().ok(),
        Some(Orientation::Rotate90 | Orientation::Rotate270 | Orientation::Rotate90FlipH | Orientation::Rotate270FlipH)
    );
    Some(if quarter_turn { (h, w) } else { (w, h) })
}
