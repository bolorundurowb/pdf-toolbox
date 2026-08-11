//! Encryption and decryption run entirely in-process — no system tools or
//! shell-outs — so the operation works fully offline on any platform.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use lopdf::encryption::crypt_filters::{Aes128CryptFilter, Aes256CryptFilter, CryptFilter, Rc4CryptFilter};
use lopdf::{Document, EncryptionState, EncryptionVersion, Error, LoadOptions, Permissions};
use rand::RngExt;
use tauri::ipc::Channel;

use super::model::{OperationResult, OutputFile, Progress, SecurityOptions};
use super::util::{file_size, stem, unique_path};

fn default_permissions() -> Permissions {
    Permissions::PRINTABLE
        | Permissions::COPYABLE
        | Permissions::COPYABLE_FOR_ACCESSIBILITY
        | Permissions::PRINTABLE_IN_HIGH_QUALITY
}

fn build_encryption_state(
    doc: &Document,
    strength: &str,
    user_password: &str,
    owner_password: &str,
) -> Result<EncryptionState, String> {
    let permissions = default_permissions();

    match strength {
        "aes128" => {
            let crypt_filter: Arc<dyn CryptFilter> = Arc::new(Aes128CryptFilter);
            let version = EncryptionVersion::V4 {
                document: doc,
                encrypt_metadata: true,
                crypt_filters: BTreeMap::from([(b"StdCF".to_vec(), crypt_filter)]),
                stream_filter: b"StdCF".to_vec(),
                string_filter: b"StdCF".to_vec(),
                owner_password,
                user_password,
                permissions,
            };
            EncryptionState::try_from(version).map_err(|e| e.to_string())
        }
        "rc4" => {
            let crypt_filter: Arc<dyn CryptFilter> = Arc::new(Rc4CryptFilter);
            let version = EncryptionVersion::V4 {
                document: doc,
                encrypt_metadata: true,
                crypt_filters: BTreeMap::from([(b"StdCF".to_vec(), crypt_filter)]),
                stream_filter: b"StdCF".to_vec(),
                string_filter: b"StdCF".to_vec(),
                owner_password,
                user_password,
                permissions,
            };
            EncryptionState::try_from(version).map_err(|e| e.to_string())
        }
        _ => {
            let crypt_filter: Arc<dyn CryptFilter> = Arc::new(Aes256CryptFilter);
            let mut file_encryption_key = [0u8; 32];
            rand::rng().fill(&mut file_encryption_key);
            let version = EncryptionVersion::V5 {
                encrypt_metadata: true,
                crypt_filters: BTreeMap::from([(b"StdCF".to_vec(), crypt_filter)]),
                file_encryption_key: &file_encryption_key,
                stream_filter: b"StdCF".to_vec(),
                string_filter: b"StdCF".to_vec(),
                owner_password,
                user_password,
                permissions,
            };
            EncryptionState::try_from(version).map_err(|e| e.to_string())
        }
    }
}

fn map_crypto_error(err: Error, name: &str) -> String {
    match err {
        Error::InvalidPassword => format!("Wrong password for {name}."),
        other => format!("Couldn't process {name}: {other}"),
    }
}

pub fn encrypt_pdfs(
    paths: Vec<String>,
    options: SecurityOptions,
    out_dir: String,
    on_progress: &Channel<Progress>,
) -> Result<OperationResult, String> {
    if paths.is_empty() {
        return Err("No PDFs to protect.".to_string());
    }
    if options.user_password.is_empty() {
        return Err("Enter a user password.".to_string());
    }

    let owner = options
        .owner_password
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(&options.user_password);

    let total = paths.len() as u32;
    let mut files = Vec::new();

    for (i, path) in paths.iter().enumerate() {
        let name = format!("{} (protected).pdf", stem(Path::new(path)));
        let _ = on_progress.send(Progress::new(i as u32, total, format!("Protecting {name}")));
        let out_path = unique_path(Path::new(&out_dir), &name);

        let mut doc = Document::load(path).map_err(|e| map_crypto_error(e, &name))?;
        if doc.is_encrypted() {
            return Err(format!("{name} is already password-protected."));
        }

        let state = build_encryption_state(&doc, &options.strength, &options.user_password, owner)?;
        doc.encrypt(&state).map_err(|e| format!("Couldn't protect {name}: {e}"))?;
        doc.save(&out_path).map_err(|e| format!("Couldn't save {name}: {e}"))?;

        files.push(out_file(&out_path, &name));
    }

    let _ = on_progress.send(Progress::new(total, total, "Done"));
    Ok(OperationResult { files, out_dir })
}

pub fn decrypt_pdfs(
    paths: Vec<String>,
    password: String,
    out_dir: String,
    on_progress: &Channel<Progress>,
) -> Result<OperationResult, String> {
    if paths.is_empty() {
        return Err("No PDFs to unlock.".to_string());
    }

    let total = paths.len() as u32;
    let mut files = Vec::new();

    for (i, path) in paths.iter().enumerate() {
        let name = format!("{} (unlocked).pdf", stem(Path::new(path)));
        let _ = on_progress.send(Progress::new(i as u32, total, format!("Unlocking {name}")));
        let out_path = unique_path(Path::new(&out_dir), &name);

        let mut doc = Document::load_with_options(path, LoadOptions::with_password(&password))
            .map_err(|e| map_crypto_error(e, &name))?;

        if doc.is_encrypted() {
            doc.decrypt(&password).map_err(|e| map_crypto_error(e, &name))?;
        }

        doc.save(&out_path).map_err(|e| format!("Couldn't save {name}: {e}"))?;
        files.push(out_file(&out_path, &name));
    }

    let _ = on_progress.send(Progress::new(total, total, "Done"));
    Ok(OperationResult { files, out_dir })
}

fn out_file(out_path: &Path, name: &str) -> OutputFile {
    OutputFile {
        name: out_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(name)
            .to_string(),
        path: out_path.to_string_lossy().to_string(),
        size: file_size(out_path),
        badge: None,
    }
}
