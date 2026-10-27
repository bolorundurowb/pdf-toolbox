//! Tauri command layer — bridges the Angular UI to the local PDF processing library.

mod pdf;

use tauri::ipc::Channel;
use tauri::{Emitter, Manager};

use pdf::model::{
    CompressEstimate, CompressOptions, FileInfo, ImagesOptions, MergeOptions, OperationResult, OrganizeOptions,
    PageOp, PdfMetadata, Progress, RecentFile, SecurityOptions, SplitOptions,
};
use pdf::update::UpdateInfo;

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
async fn estimate_compression(paths: Vec<String>, options: CompressOptions) -> Result<Vec<CompressEstimate>, String> {
    tauri::async_runtime::spawn_blocking(move || pdf::compress::estimate_compression(paths, options))
        .await
        .map_err(|e| format!("Task failed: {e}"))
}

#[tauri::command]
async fn encrypt_pdfs(
    paths: Vec<String>,
    options: SecurityOptions,
    out_dir: String,
    on_progress: Channel<Progress>,
) -> Result<OperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || pdf::security::encrypt_pdfs(paths, options, out_dir, &on_progress))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
async fn decrypt_pdfs(
    paths: Vec<String>,
    password: String,
    on_conflict: Option<String>,
    out_dir: String,
    on_progress: Channel<Progress>,
) -> Result<OperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        pdf::security::decrypt_pdfs(paths, password, on_conflict, out_dir, &on_progress)
    })
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
async fn set_metadata(
    path: String,
    metadata: PdfMetadata,
    on_conflict: Option<String>,
    out_dir: String,
) -> Result<OperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        pdf::metadata::set_metadata(&path, metadata, on_conflict, &out_dir)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
async fn recent_outputs(dir: String) -> Result<Vec<RecentFile>, String> {
    Ok(tauri::async_runtime::spawn_blocking(move || pdf::recents::recent_outputs(&dir))
        .await
        .map_err(|e| format!("Task failed: {e}"))?)
}

#[tauri::command]
async fn organize_pdf(
    path: String,
    pages: Vec<PageOp>,
    options: OrganizeOptions,
    out_dir: String,
    on_progress: Channel<Progress>,
) -> Result<OperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        pdf::organize::organize_pdf(path, pages, options, out_dir, &on_progress)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[tauri::command]
fn cancel_job() {
    pdf::cancel::request();
}

/// PDF paths passed on the command line when the app was launched (for file
/// associations). The dashboard shows these with an "open in a tool" choice.
#[tauri::command]
fn launch_files() -> Vec<String> {
    pdf_paths(std::env::args())
}

fn pdf_paths(args: impl IntoIterator<Item = String>) -> Vec<String> {
    args.into_iter()
        .filter(|arg| !arg.starts_with('-') && arg.to_lowercase().ends_with(".pdf"))
        .collect()
}

#[tauri::command]
fn app_version() -> String {
    pdf::update::app_version()
}

#[tauri::command]
async fn check_update() -> Result<UpdateInfo, String> {
    tauri::async_runtime::spawn_blocking(|| pdf::update::check_update())
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A second launch (e.g. double-clicking a PDF) is handed to this
            // window instead of starting another copy of the app.
            let files = pdf_paths(argv);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
                if !files.is_empty() {
                    let _ = window.emit("open-file", files);
                }
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            inspect_files,
            images_to_pdf,
            merge_pdfs,
            split_pdf,
            compress_pdfs,
            estimate_compression,
            encrypt_pdfs,
            decrypt_pdfs,
            get_metadata,
            set_metadata,
            recent_outputs,
            organize_pdf,
            app_version,
            check_update,
            cancel_job,
            launch_files,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the Tauri application");

    app.run(|app_handle, event| {
        // macOS and iOS deliver "open with" files as run events rather than
        // command-line arguments.
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        if let tauri::RunEvent::Opened { urls } = event {
            let files: Vec<String> = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|path| path.to_string_lossy().to_string())
                .filter(|path| path.to_lowercase().ends_with(".pdf"))
                .collect();
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.set_focus();
                if !files.is_empty() {
                    let _ = window.emit("open-file", files);
                }
            }
        }

        #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
        {
            let _ = (app_handle, event);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::pdf_paths;

    #[test]
    fn launch_args_keep_only_pdf_files() {
        let args = vec![
            "pdf-toolbox".to_string(),
            "--flag".to_string(),
            "C:\\Docs\\Report.PDF".to_string(),
            "notes.txt".to_string(),
            "/home/me/scan.pdf".to_string(),
        ];
        assert_eq!(
            pdf_paths(args),
            vec!["C:\\Docs\\Report.PDF".to_string(), "/home/me/scan.pdf".to_string()]
        );
    }
}
