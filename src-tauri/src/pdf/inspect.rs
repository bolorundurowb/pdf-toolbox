//! Reading metadata (size, page count, dimensions, validity) for files.

use std::path::Path;

use super::model::FileInfo;
use super::util::file_size;

const IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "bmp", "tiff", "tif", "webp",
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
    match image::image_dimensions(Path::new(path_str)) {
        Ok((w, h)) => {
            info.width = Some(w);
            info.height = Some(h);
        }
        Err(_) => info.error = Some("Unsupported or unreadable image".to_string()),
    }
    info
}
