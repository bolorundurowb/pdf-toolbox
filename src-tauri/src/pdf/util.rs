//! Shared helpers for range parsing, safe output paths, progress reporting,
//! and filename extraction.

use std::path::{Path, PathBuf};

use lopdf::{Document, Object, StringFormat};
use rand::RngExt;
use tauri::ipc::Channel;

use super::model::Progress;

/// Matches the frontend's range-parsing logic so the page preview and the
/// written output always agree.
pub fn parse_ranges(text: &str, max: u32) -> Vec<(u32, u32)> {
    let mut out = Vec::new();
    for tok in text.split(',') {
        let tok = tok.trim();
        if tok.is_empty() {
            continue;
        }
        if let Some((a, b)) = tok.split_once('-') {
            if let (Ok(mut a), Ok(mut b)) = (a.trim().parse::<u32>(), b.trim().parse::<u32>()) {
                if a > b {
                    std::mem::swap(&mut a, &mut b);
                }
                let a = a.max(1);
                let b = b.min(max);
                if a <= b && a >= 1 {
                    out.push((a, b));
                }
            }
        } else if let Ok(p) = tok.parse::<u32>() {
            if p >= 1 && p <= max {
                out.push((p, p));
            }
        }
    }
    out
}

pub fn stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Document")
        .to_string()
}

/// "Scan" for one file, "Scan and 3 more" for several. Used for the names the
/// Rust side generates when the user leaves the name field empty.
pub fn first_and_more(paths: &[String]) -> String {
    let first = paths
        .first()
        .map(|p| stem(Path::new(p)))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Document".to_string());
    match paths.len() {
        0 | 1 => first,
        n => format!("{first} and {} more", n - 1),
    }
}

/// Collapses page numbers into the shortest range text: `1-5, 8, 11-13`.
pub fn pages_label(pages: &[u32]) -> String {
    let mut sorted: Vec<u32> = pages.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    if sorted.is_empty() {
        return String::new();
    }
    let mut parts = Vec::new();
    let (mut start, mut prev) = (sorted[0], sorted[0]);
    for &n in &sorted[1..] {
        if n == prev + 1 {
            prev = n;
            continue;
        }
        parts.push(if start == prev { start.to_string() } else { format!("{start}-{prev}") });
        start = n;
        prev = n;
    }
    parts.push(if start == prev { start.to_string() } else { format!("{start}-{prev}") });
    parts.join(", ")
}

/// Expands inclusive ranges into a sorted, de-duplicated page list.
pub fn ranges_to_pages(ranges: &[(u32, u32)]) -> Vec<u32> {
    let mut pages = Vec::new();
    for &(a, b) in ranges {
        pages.extend(a..=b);
    }
    pages.sort_unstable();
    pages.dedup();
    pages
}

/// Strips a trailing `.pdf` regardless of case (`Report.PDF` → `Report`).
pub fn strip_pdf_ext(name: &str) -> &str {
    if name.len() >= 4 && name.is_char_boundary(name.len() - 4) && name[name.len() - 4..].eq_ignore_ascii_case(".pdf") {
        &name[..name.len() - 4]
    } else {
        name
    }
}

/// How an output name collision is resolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Clash {
    KeepBoth,
    Overwrite,
}

impl Clash {
    /// The UI resolves "ask" before a job starts, so only the two concrete
    /// choices arrive here. Anything unrecognised falls back to today's safe
    /// behaviour: keep both files.
    pub fn from_option(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            Some("overwrite") => Clash::Overwrite,
            _ => Clash::KeepBoth,
        }
    }
}

/// Picks the output path for `file_name`, honouring the user's clash choice.
pub fn output_path(dir: &Path, file_name: &str, clash: Clash) -> PathBuf {
    if clash == Clash::Overwrite {
        return dir.join(sanitize_file_name(file_name));
    }
    unique_path(dir, file_name)
}

/// Strips anything that would let a user-supplied output name escape the output
/// folder or upset the filesystem. Output names come straight from a text box, and
/// `Path::join` happily resolves `../` — or replaces the whole path if handed
/// something absolute like `C:\Windows\...`.
pub fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' => '-',
            '<' | '>' | ':' | '"' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();

    // A name of only dots (`.`, `..`) would still resolve to a directory.
    let trimmed = cleaned.trim();
    if trimmed.is_empty() || trimmed.chars().all(|c| c == '.') {
        return "output".to_string();
    }
    trimmed.to_string()
}

pub fn unique_path(dir: &Path, file_name: &str) -> PathBuf {
    let file_name = &sanitize_file_name(file_name);
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let p = Path::new(file_name);
    let stem = p
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output")
        .to_string();
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("");
    let mut n = 2;
    loop {
        let name = if ext.is_empty() {
            format!("{stem} ({n})")
        } else {
            format!("{stem} ({n}).{ext}")
        };
        let candidate = dir.join(&name);
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

pub fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/// Sends a progress update. Returns `Ok(())` on success or
/// `Err("Operation cancelled.")` if the frontend disconnected.
pub fn report(channel: &Channel<Progress>, progress: Progress) -> Result<(), String> {
    channel.send(progress).map_err(|_| "Operation cancelled.".to_string())
}

/// Extract the file name from a path string, falling back to the whole string
/// if the path has no filename component.
pub fn short_filename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
}

/// Page attributes a page may inherit from an ancestor `/Pages` node (PDF 32000 §7.7.3.4).
const INHERITABLE: [&[u8]; 4] = [b"Resources", b"MediaBox", b"CropBox", b"Rotate"];

/// Copies inherited attributes onto every page dictionary.
///
/// Merge and Organise re-parent pages under a different `/Pages` node; without
/// this, a page that relied on its old parent for its size, rotation or fonts
/// would silently lose them (wrong page size, missing text or images).
pub fn flatten_inherited_attributes(doc: &mut Document) {
    for page_id in doc.get_pages().into_values() {
        let Ok(page) = doc.get_dictionary(page_id) else { continue };
        let mut missing: Vec<&[u8]> = INHERITABLE.iter().copied().filter(|k| !page.has(k)).collect();
        let mut parent = page.get(b"Parent").and_then(Object::as_reference).ok();
        let mut inherited: Vec<(&[u8], Object)> = Vec::new();

        // Bounded so a malformed document with a cyclic /Parent chain can't hang.
        for _ in 0..32 {
            let Some(pid) = parent else { break };
            if missing.is_empty() {
                break;
            }
            let Ok(node) = doc.get_dictionary(pid) else { break };
            missing.retain(|key| match node.get(key) {
                Ok(value) => {
                    inherited.push((key, value.clone()));
                    false
                }
                Err(_) => true,
            });
            parent = node.get(b"Parent").and_then(Object::as_reference).ok();
        }

        if inherited.is_empty() {
            continue;
        }
        if let Ok(page) = doc.get_dictionary_mut(page_id) {
            for (key, value) in inherited {
                page.set(key.to_vec(), value);
            }
        }
    }
}

/// Gives the document a trailer `/ID` if it lacks one. AES-128 and RC4
/// encryption derive their key from it, and many PDFs (including this app's own
/// merge and image outputs) don't have one, so protecting them used to fail.
pub fn ensure_file_id(doc: &mut Document) {
    if doc.trailer.has(b"ID") {
        return;
    }
    let mut id = [0u8; 16];
    rand::rng().fill(&mut id);
    doc.trailer.set(
        "ID",
        Object::Array(vec![
            Object::String(id.to_vec(), StringFormat::Hexadecimal),
            Object::String(id.to_vec(), StringFormat::Hexadecimal),
        ]),
    );
}

/// Without the password lopdf still "loads" an encrypted file, but with no
/// usable objects — operations then wrote broken output or failed confusingly.
pub fn ensure_unlocked(doc: &Document, name: &str) -> Result<(), String> {
    if doc.is_encrypted() {
        return Err(format!(
            "{name} is password-protected. Remove the password first (Security → Remove Password)."
        ));
    }
    Ok(())
}

/// Maximum file size the application will process (200 MB).
pub const MAX_FILE_SIZE: u64 = 200 * 1024 * 1024;

/// Returns an error if the file exceeds safety limits.
pub fn check_file_limits(path: &Path) -> Result<(), String> {
    let size = file_size(path);
    if size > MAX_FILE_SIZE {
        let mb = size as f64 / (1024.0 * 1024.0);
        return Err(format!(
            "{} is {:.0} MB — too large to process (limit: 200 MB).",
            short_filename(&path.to_string_lossy()),
            mb,
        ));
    }
    Ok(())
}

/// Calls `check_file_limits` for every path. Returns early on the first failure.
pub fn check_files_limits(paths: &[String]) -> Result<(), String> {
    for p in paths {
        check_file_limits(Path::new(p))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- parse_ranges ----

    #[test]
    fn ranges_single_page() {
        assert_eq!(parse_ranges("5", 10), vec![(5, 5)]);
    }

    #[test]
    fn ranges_multiple() {
        assert_eq!(parse_ranges("1-3, 7", 10), vec![(1, 3), (7, 7)]);
    }

    #[test]
    fn ranges_inverted() {
        assert_eq!(parse_ranges("8-3", 10), vec![(3, 8)]);
    }

    #[test]
    fn ranges_out_of_bounds() {
        assert_eq!(parse_ranges("0, 11, 99", 10), vec![]);
    }

    #[test]
    fn ranges_clamped() {
        assert_eq!(parse_ranges("1-99", 10), vec![(1, 10)]);
    }

    #[test]
    fn ranges_empty() {
        assert_eq!(parse_ranges("", 10), vec![]);
    }

    #[test]
    fn ranges_whitespace() {
        assert_eq!(parse_ranges(" 1 , 3 - 5 ", 10), vec![(1, 1), (3, 5)]);
    }

    #[test]
    fn ranges_garbage() {
        assert_eq!(parse_ranges("abc, x-y", 10), vec![]);
    }

    #[test]
    fn ranges_sparse() {
        assert_eq!(parse_ranges("1, 5, 3, 7", 10), vec![(1, 1), (5, 5), (3, 3), (7, 7)]);
    }

    // ---- sanitize_file_name ----

    #[test]
    fn sanitize_path_traversal() {
        assert_eq!(sanitize_file_name("../etc/passwd"), "..-etc-passwd");
    }

    #[test]
    fn sanitize_absolute_windows() {
        assert_eq!(sanitize_file_name("C:\\Windows\\evil.exe"), "C_-Windows-evil.exe");
    }

    #[test]
    fn sanitize_control_chars() {
        assert_eq!(sanitize_file_name("test\x00file"), "test_file");
    }

    #[test]
    fn sanitize_all_dots() {
        assert_eq!(sanitize_file_name("..."), "output");
    }

    #[test]
    fn sanitize_empty() {
        assert_eq!(sanitize_file_name("   "), "output");
    }

    #[test]
    fn sanitize_normal() {
        assert_eq!(sanitize_file_name("My Document.pdf"), "My Document.pdf");
    }

    #[test]
    fn sanitize_wildcards() {
        assert_eq!(sanitize_file_name("doc<1>?.pdf"), "doc_1__.pdf");
    }

    // ---- unique_path (smoke test only; depends on filesystem) ----

    #[test]
    fn unique_path_no_collision() {
        let dir = std::env::temp_dir();
        let path = unique_path(&dir, "test-unique-abc123.pdf");
        assert!(path.starts_with(&dir));
        // Must not produce the exact name if a collision somehow exists.
        assert!(
            path.file_name().map(|n| n != "test-unique-abc123.pdf").unwrap_or(false)
                || !path.exists()
        );
    }

    // ---- file_size ----

    #[test]
    fn file_size_of_nonexistent() {
        assert_eq!(file_size(Path::new("does_not_exist_xyz.abc")), 0);
    }

    // ---- short_filename ----

    #[test]
    fn short_filename_simple() {
        assert_eq!(short_filename("/home/user/doc.pdf"), "doc.pdf");
    }

    #[test]
    fn short_filename_windows() {
        assert_eq!(short_filename("C:\\Users\\me\\file.pdf"), "file.pdf");
    }

    #[test]
    fn short_filename_fallback() {
        assert_eq!(short_filename("just_a_name"), "just_a_name");
    }

    // ---- generated names ----

    #[test]
    fn first_and_more_names() {
        assert_eq!(first_and_more(&[]), "Document");
        assert_eq!(first_and_more(&["C:\\Scan.PDF".to_string()]), "Scan");
        assert_eq!(
            first_and_more(&["a/Report.pdf".to_string(), "b/Notes.pdf".to_string(), "c/More.pdf".to_string()]),
            "Report and 2 more"
        );
    }

    #[test]
    fn page_labels_collapse_ranges() {
        assert_eq!(pages_label(&[1, 2, 3, 5, 8, 9]), "1-3, 5, 8-9");
        assert_eq!(pages_label(&[7]), "7");
        assert_eq!(pages_label(&[]), "");
    }

    #[test]
    fn ranges_expand_in_order() {
        assert_eq!(ranges_to_pages(&[(3, 5), (1, 2)]), vec![1, 2, 3, 4, 5]);
    }

    #[test]
    fn clash_defaults_to_keeping_both() {
        assert_eq!(Clash::from_option(None), Clash::KeepBoth);
        assert_eq!(Clash::from_option(Some("ask")), Clash::KeepBoth);
        assert_eq!(Clash::from_option(Some("overwrite")), Clash::Overwrite);
    }
}
