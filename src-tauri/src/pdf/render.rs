//! No pure-Rust PDF renderer exists, so rendering is delegated to pdfium and
//! gated behind the optional `render` feature. Builds without the feature
//! return a descriptive error rather than failing silently.

use super::model::{OperationResult, Progress};
use tauri::ipc::Channel;

#[cfg(feature = "render")]
pub fn pages_to_images(
    path: String,
    out_dir: String,
    image_format: String,
    dpi: u32,
    lib_dir: Option<String>,
    on_progress: &Channel<Progress>,
) -> Result<OperationResult, String> {
    use std::path::Path;

    use pdfium_render::prelude::*;

    use super::model::OutputFile;
    use super::util::{file_size, stem, unique_path};

    let bindings = lib_dir
        .and_then(|dir| {
            Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(&dir)).ok()
        })
        .or_else(|| Pdfium::bind_to_system_library().ok())
        .ok_or_else(|| "The PDF rendering library (pdfium) wasn't found. See README.".to_string())?;
    let pdfium = Pdfium::new(bindings);

    let doc = pdfium
        .load_pdf_from_file(&path, None)
        .map_err(|_| "Couldn't read this PDF.".to_string())?;

    let base = stem(Path::new(&path));
    let ext = if image_format.eq_ignore_ascii_case("jpg") || image_format.eq_ignore_ascii_case("jpeg") {
        "jpg"
    } else {
        "png"
    };
    let save_fmt = if ext == "jpg" { image::ImageFormat::Jpeg } else { image::ImageFormat::Png };

    let scale = (dpi.max(36) as f32) / 72.0;
    let config = PdfRenderConfig::new().scale_page_by_factor(scale);

    let total = doc.pages().len() as u32;
    let mut files = Vec::new();

    for (i, page) in doc.pages().iter().enumerate() {
        let _ = on_progress.send(Progress::new(i as u32, total, format!("Rendering page {}", i + 1)));
        let image = page
            .render_with_config(&config)
            .map_err(|e| format!("Couldn't render page {}: {e}", i + 1))?
            .as_image();
        let name = format!("{base}_page_{}.{ext}", i + 1);
        let out_path = unique_path(Path::new(&out_dir), &name);
        image
            .save_with_format(&out_path, save_fmt)
            .map_err(|e| format!("Couldn't save {name}: {e}"))?;
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

#[cfg(not(feature = "render"))]
pub fn pages_to_images(
    _path: String,
    _out_dir: String,
    _image_format: String,
    _dpi: u32,
    _lib_dir: Option<String>,
    _on_progress: &Channel<Progress>,
) -> Result<OperationResult, String> {
    Err("Exporting pages as images isn't enabled in this build. Rebuild with `--features render` and bundle pdfium (see README).".to_string())
}
