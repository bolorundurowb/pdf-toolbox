//! HEIC/HEIF support via an external helper (libheif's `heif-convert` or
//! ImageMagick). This keeps the Rust build free of a system libheif link
//! dependency; the helper binary is expected to be installed or bundled as a
//! Tauri sidecar (see README).

use std::path::{Path, PathBuf};
use std::process::Command;

/// Candidate helper binaries, in preference order.
fn candidates() -> Vec<&'static str> {
    if cfg!(target_os = "windows") {
        vec!["heif-convert.exe", "magick.exe", "magick", "heif-convert"]
    } else {
        vec!["heif-convert", "magick", "convert"]
    }
}

/// Whether any HEIC helper appears to be on PATH.
pub fn helper_available() -> bool {
    which_helper().is_some()
}

fn which_helper() -> Option<String> {
    for c in candidates() {
        if Command::new(c).arg("--version").output().is_ok() {
            return Some(c.to_string());
        }
    }
    None
}

/// Convert a HEIC/HEIF file to a temporary PNG and return its path.
/// The caller is responsible for reading and then removing the temp file.
pub fn convert_to_png(input: &Path, tmp_dir: &Path) -> Result<PathBuf, String> {
    let helper = which_helper().ok_or_else(|| {
        "No HEIC helper found. Install libheif (heif-convert) or ImageMagick.".to_string()
    })?;
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image");
    let out = tmp_dir.join(format!("{stem}-heic-{}.png", std::process::id()));

    let status = if helper.contains("heif-convert") {
        Command::new(&helper).arg(input).arg(&out).status()
    } else {
        // ImageMagick: `magick input.heic output.png`
        Command::new(&helper).arg(input).arg(&out).status()
    };

    match status {
        Ok(s) if s.success() && out.exists() => Ok(out),
        _ => Err(format!("Couldn't convert {}", input.display())),
    }
}
