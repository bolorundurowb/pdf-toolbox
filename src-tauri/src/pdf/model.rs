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
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeOptions {
    /// Recompresses images in the merged output to reduce file size.
    pub optimize: bool,
    #[serde(default)]
    pub output_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitOptions {
    pub mode: String, // "ranges" | "size" | "extract"
    pub range_text: String,
    pub max_size_mb: f64,
    pub selected_pages: Vec<u32>,
    #[serde(default)]
    pub output_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressOptions {
    pub level: String, // "low" | "balanced" | "high"
    pub grayscale: bool,
    pub remove_metadata: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityOptions {
    pub user_password: String,
    #[serde(default)]
    pub owner_password: Option<String>,
    pub strength: String, // "aes256" | "aes128" | "rc4"
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
