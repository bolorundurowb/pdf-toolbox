//! Types shared with the Angular frontend — these cross the Tauri IPC boundary
//! and must stay in sync with the TypeScript models.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pages: Option<u32>,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub badge: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResult {
    pub files: Vec<OutputFile>,
    pub out_dir: String,
    /// True when the user stopped the job before it finished.
    #[serde(default)]
    pub stopped: bool,
}

impl OperationResult {
    pub fn new(files: Vec<OutputFile>, out_dir: String) -> Self {
        Self { files, out_dir, stopped: false }
    }

    pub fn stopped(files: Vec<OutputFile>, out_dir: String) -> Self {
        Self { files, out_dir, stopped: true }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub processed: u32,
    pub total: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl Progress {
    pub fn new(processed: u32, total: u32, message: impl Into<String>) -> Self {
        Self { processed, total, message: Some(message.into()) }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    /// Unix millis.
    pub modified: i64,
}

/* ------------------------------- options --------------------------------- */

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImagesOptions {
    pub page_size: String,   // "a4" | "letter" | "fit"
    pub orientation: String, // "auto" | "portrait" | "landscape"
    /// Margin in points.
    pub margin: f64,
    /// JPEG quality 1-100.
    pub quality: u8,
    /// Optional name typed by the user; otherwise the source names are used.
    #[serde(default)]
    pub output_name: Option<String>,
    /// "keep" (default) or "overwrite". "ask" is resolved by the UI.
    #[serde(default)]
    pub on_conflict: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeOptions {
    /// Recompresses images in the merged output to reduce file size.
    pub optimize: bool,
    #[serde(default)]
    pub output_name: Option<String>,
    /// One optional page-range expression per input, aligned with `paths`.
    #[serde(default)]
    pub page_ranges: Vec<String>,
    #[serde(default)]
    pub on_conflict: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitOptions {
    pub mode: String, // "ranges" | "size" | "extract" | "every" | "bookmarks"
    pub range_text: String,
    pub max_size_mb: f64,
    pub selected_pages: Vec<u32>,
    #[serde(default)]
    pub every_pages: u32,
    #[serde(default)]
    pub output_name: Option<String>,
    #[serde(default)]
    pub on_conflict: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressOptions {
    /// "minimal" | "light" | "balanced" | "strong" | "extreme" ("low"/"high" still accepted).
    pub level: String,
    pub grayscale: bool,
    #[serde(default)]
    pub remove_metadata: bool,
    #[serde(default)]
    pub on_conflict: Option<String>,
}

/// Approximate result of compressing one file, shown before the user commits.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressEstimate {
    pub path: String,
    pub original: u64,
    pub estimated: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityOptions {
    pub user_password: String,
    #[serde(default)]
    pub owner_password: Option<String>,
    pub strength: String, // "aes256" | "aes128" | "rc4"
    #[serde(default)]
    pub on_conflict: Option<String>,
}

/// Options applied to every page when an organised PDF is saved.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeOptions {
    #[serde(default)]
    pub watermark_text: String,
    /// 0.0–1.0.
    #[serde(default = "default_opacity")]
    pub watermark_opacity: f64,
    /// "diagonal" | "horizontal"
    #[serde(default)]
    pub watermark_placement: String,
    #[serde(default)]
    pub page_numbers: bool,
    /// "corner" | "centre"
    #[serde(default)]
    pub page_number_placement: String,
    #[serde(default = "default_page_start")]
    pub page_number_start: i64,
    #[serde(default)]
    pub header_text: String,
    #[serde(default)]
    pub footer_text: String,
    /// Margin in points to cut from every edge (0 = no crop).
    #[serde(default)]
    pub crop_margin: f64,
    #[serde(default)]
    pub on_conflict: Option<String>,
}

fn default_opacity() -> f64 {
    0.18
}

fn default_page_start() -> i64 {
    1
}

impl Default for OrganizeOptions {
    fn default() -> Self {
        Self {
            watermark_text: String::new(),
            watermark_opacity: default_opacity(),
            watermark_placement: "diagonal".to_string(),
            page_numbers: false,
            page_number_placement: "corner".to_string(),
            page_number_start: 1,
            header_text: String::new(),
            footer_text: String::new(),
            crop_margin: 0.0,
            on_conflict: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PdfMetadata {
    pub title: String,
    pub author: String,
    pub subject: String,
    pub keywords: String,
    pub creator: String,
    pub producer: String,
}

/// One page in a reorder/rotate operation. `source` is the 1-based page index
/// in the original document; `rotate` is an added rotation in degrees (0/90/180/270).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageOp {
    pub source: u32,
    pub rotate: i32,
}
