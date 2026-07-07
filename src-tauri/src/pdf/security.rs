//! Password / encryption via the qpdf external tool.
//!
//! qpdf is resolved in this order: bundled app resource → next to the app exe →
//! `PATH` → standard Windows install. If missing, a friendly error is shown.

use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::ipc::Channel;

use super::model::{OperationResult, OutputFile, Progress, SecurityOptions};
use super::util::{file_size, stem, unique_path};

fn exe_names() -> &'static [&'static str] {
    if cfg!(target_os = "windows") { &["qpdf.exe"] } else { &["qpdf"] }
}

pub fn resolve(bundled: Option<String>) -> Option<String> {
    if let Some(p) = bundled {
        if Path::new(&p).exists() {
            return Some(p);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in exe_names() {
                let cand = dir.join(name);
                if cand.exists() {
                    return Some(cand.to_string_lossy().to_string());
                }
            }
        }
    }
    let name = if cfg!(target_os = "windows") { "qpdf.exe" } else { "qpdf" };
    if Command::new(name).arg("--version").output().is_ok() {
        return Some(name.to_string());
    }
    #[cfg(target_os = "windows")]
    {
        for var in ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"] {
            if let Ok(base) = std::env::var(var) {
                let root = PathBuf::from(base).join("qpdf");
                if let Ok(entries) = std::fs::read_dir(&root) {
                    for entry in entries.flatten() {
                        let cand = entry.path().join("bin").join("qpdf.exe");
                        if cand.exists() {
                            return Some(cand.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

fn not_found() -> String {
    "qpdf wasn't found. Reinstall the app or install qpdf (see README).".to_string()
}

pub fn encrypt_pdfs(
    paths: Vec<String>,
    options: SecurityOptions,
    out_dir: String,
    qpdf_override: Option<String>,
    on_progress: &Channel<Progress>,
) -> Result<OperationResult, String> {
    if paths.is_empty() {
        return Err("No PDFs to protect.".to_string());
    }
    if options.user_password.is_empty() {
        return Err("Enter a user password.".to_string());
    }
    let qpdf = resolve(qpdf_override).ok_or_else(not_found)?;
    let owner = options
        .owner_password
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| options.user_password.clone());

    let (bits, use_aes) = match options.strength.as_str() {
        "aes128" => ("128", true),
        "rc4" => ("128", false),
        _ => ("256", true), // aes256
    };

    let total = paths.len() as u32;
    let mut files = Vec::new();

    for (i, path) in paths.iter().enumerate() {
        let name = format!("{} (protected).pdf", stem(Path::new(path)));
        let _ = on_progress.send(Progress::new(i as u32, total, format!("Protecting {name}")));
        let out_path = unique_path(Path::new(&out_dir), &name);

        let mut cmd = Command::new(&qpdf);
        cmd.arg("--encrypt")
            .arg(&options.user_password)
            .arg(&owner)
            .arg(bits);
        if bits == "128" {
            cmd.arg(if use_aes { "--use-aes=y" } else { "--use-aes=n" });
        }
        cmd.arg("--")
            .arg(path)
            .arg(out_path.to_string_lossy().to_string());

        run(&mut cmd, &name)?;
        files.push(out_file(&out_path, &name));
    }

    let _ = on_progress.send(Progress::new(total, total, "Done"));
    Ok(OperationResult { files, out_dir })
}

pub fn decrypt_pdfs(
    paths: Vec<String>,
    password: String,
    out_dir: String,
    qpdf_override: Option<String>,
    on_progress: &Channel<Progress>,
) -> Result<OperationResult, String> {
    if paths.is_empty() {
        return Err("No PDFs to unlock.".to_string());
    }
    let qpdf = resolve(qpdf_override).ok_or_else(not_found)?;

    let total = paths.len() as u32;
    let mut files = Vec::new();

    for (i, path) in paths.iter().enumerate() {
        let name = format!("{} (unlocked).pdf", stem(Path::new(path)));
        let _ = on_progress.send(Progress::new(i as u32, total, format!("Unlocking {name}")));
        let out_path = unique_path(Path::new(&out_dir), &name);

        let mut cmd = Command::new(&qpdf);
        cmd.arg(format!("--password={password}"))
            .arg("--decrypt")
            .arg(path)
            .arg(out_path.to_string_lossy().to_string());

        run(&mut cmd, &name)?;
        files.push(out_file(&out_path, &name));
    }

    let _ = on_progress.send(Progress::new(total, total, "Done"));
    Ok(OperationResult { files, out_dir })
}

fn run(cmd: &mut Command, name: &str) -> Result<(), String> {
    let output = cmd.output().map_err(|e| format!("Couldn't run qpdf: {e}"))?;
    // qpdf exit code 3 = warnings (still produced output); treat as success.
    let code = output.status.code().unwrap_or(-1);
    if code == 0 || code == 3 {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let last = stderr.lines().last().unwrap_or("").trim();
    if last.to_lowercase().contains("password") {
        Err(format!("Wrong password for {name}."))
    } else {
        Err(format!("qpdf failed on {name}. {last}"))
    }
}

fn out_file(out_path: &Path, name: &str) -> OutputFile {
    OutputFile {
        name: out_path.file_name().and_then(|s| s.to_str()).unwrap_or(name).to_string(),
        path: out_path.to_string_lossy().to_string(),
        size: file_size(out_path),
        badge: None,
    }
}
