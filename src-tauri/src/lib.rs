//! PDF Toolbox — a local, offline suite: images→PDF, merge/split, compress,
//! security (qpdf), and metadata.

mod pdf;

use tauri::ipc::Channel;
use tauri::path::BaseDirectory;
use tauri::Manager;

use pdf::model::{
    CompressOptions, FileInfo, ImagesOptions, MergeOptions, OperationResult, PageOp, PdfMetadata,
    Progress, RecentFile, SecurityOptions, SplitOptions,
};

/// Resolve a bundled external tool folder (e.g. "qpdf") to the
/// first matching executable inside it, if present as an app resource.
fn bundled_tool(app: &tauri::AppHandle, dir: &str, names: &[&str]) -> Option<String> {
    let base = app.path().resolve(dir, BaseDirectory::Resource).ok()?;
    names
        .iter()
        .map(|n| base.join(n))
        .find(|p| p.exists())
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
async fn inspect_files(paths: Vec<String>) -> Result<Vec<FileInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || pdf::inspect::inspect_files(paths))
        .await
        .map_err(|e| format!("Inspection failed: {e}"))
}

#[tauri::command]
async fn images_to_pdf(
    paths: Vec<String>,
    options: ImagesOptions,
    out_dir: String,
    on_progress: Channel<Progress>,
) -> Result<OperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || pdf::images::images_to_pdf(paths, options, out_dir, &on_progress))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
async fn merge_pdfs(
    paths: Vec<String>,
    options: MergeOptions,
    out_dir: String,
    on_progress: Channel<Progress>,
) -> Result<OperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || pdf::merge::merge_pdfs(paths, options, out_dir, &on_progress))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
async fn split_pdf(
    path: String,
    options: SplitOptions,
    out_dir: String,
    on_progress: Channel<Progress>,
) -> Result<OperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || pdf::split::split_pdf(path, options, out_dir, &on_progress))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
async fn compress_pdfs(
    paths: Vec<String>,
    options: CompressOptions,
    out_dir: String,
    on_progress: Channel<Progress>,
) -> Result<OperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || pdf::compress::compress_pdfs(paths, options, out_dir, &on_progress))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
async fn encrypt_pdfs(
    app: tauri::AppHandle,
    paths: Vec<String>,
    options: SecurityOptions,
    out_dir: String,
    on_progress: Channel<Progress>,
) -> Result<OperationResult, String> {
    let qpdf = bundled_tool(&app, "qpdf", &["qpdf.exe", "qpdf"]);
    tauri::async_runtime::spawn_blocking(move || pdf::security::encrypt_pdfs(paths, options, out_dir, qpdf, &on_progress))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
async fn decrypt_pdfs(
    app: tauri::AppHandle,
    paths: Vec<String>,
    password: String,
    out_dir: String,
    on_progress: Channel<Progress>,
) -> Result<OperationResult, String> {
    let qpdf = bundled_tool(&app, "qpdf", &["qpdf.exe", "qpdf"]);
    tauri::async_runtime::spawn_blocking(move || pdf::security::decrypt_pdfs(paths, password, out_dir, qpdf, &on_progress))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
async fn get_metadata(path: String) -> Result<PdfMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || pdf::metadata::get_metadata(&path))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
async fn set_metadata(path: String, metadata: PdfMetadata, out_dir: String) -> Result<OperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || pdf::metadata::set_metadata(&path, metadata, &out_dir))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
async fn recent_outputs(app: tauri::AppHandle) -> Result<Vec<RecentFile>, String> {
    let dir = app
        .path()
        .document_dir()
        .map(|d| d.join("PDF Toolbox"))
        .map_err(|_| "Couldn't resolve the documents folder.".to_string())?;
    let dir = dir.to_string_lossy().to_string();
    Ok(tauri::async_runtime::spawn_blocking(move || pdf::recents::recent_outputs(&dir))
        .await
        .map_err(|e| format!("Task failed: {e}"))?)
}

#[tauri::command]
async fn extract_text(
    path: String,
    out_dir: String,
    on_progress: Channel<Progress>,
) -> Result<OperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || pdf::extract::extract_text(path, out_dir, &on_progress))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
async fn organize_pdf(
    path: String,
    pages: Vec<PageOp>,
    out_dir: String,
    on_progress: Channel<Progress>,
) -> Result<OperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || pdf::organize::organize_pdf(path, pages, out_dir, &on_progress))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
async fn pages_to_images(
    app: tauri::AppHandle,
    path: String,
    out_dir: String,
    image_format: String,
    dpi: u32,
    on_progress: Channel<Progress>,
) -> Result<OperationResult, String> {
    let lib_dir = app
        .path()
        .resolve("pdfium", BaseDirectory::Resource)
        .ok()
        .map(|p| p.to_string_lossy().to_string());
    tauri::async_runtime::spawn_blocking(move || {
        pdf::render::pages_to_images(path, out_dir, image_format, dpi, lib_dir, &on_progress)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            inspect_files,
            images_to_pdf,
            merge_pdfs,
            split_pdf,
            compress_pdfs,
            encrypt_pdfs,
            decrypt_pdfs,
            get_metadata,
            set_metadata,
            recent_outputs,
            extract_text,
            organize_pdf,
            pages_to_images,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
