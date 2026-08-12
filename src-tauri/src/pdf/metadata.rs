//! Read and write PDF document information (the Info dictionary).

use std::path::Path;

use lopdf::{Dictionary, Document, Object, StringFormat};

use super::model::{OperationResult, OutputFile, PdfMetadata};
use super::util::{check_file_limits, file_size, stem, unique_path};

fn decode_text(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        let u16s: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&u16s)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

/// Non-ASCII strings are encoded as UTF-16BE with a BOM so they survive PDF round-trips.
fn encode_text(s: &str) -> Object {
    if s.is_ascii() {
        Object::String(s.as_bytes().to_vec(), StringFormat::Literal)
    } else {
        let mut bytes = vec![0xFE, 0xFF];
        for u in s.encode_utf16() {
            bytes.extend_from_slice(&u.to_be_bytes());
        }
        Object::String(bytes, StringFormat::Literal)
    }
}

fn read_field(dict: &Dictionary, key: &[u8]) -> String {
    dict.get(key)
        .ok()
        .and_then(|o| o.as_str().ok())
        .map(decode_text)
        .unwrap_or_default()
}

pub fn get_metadata(path: &str) -> Result<PdfMetadata, String> {
    check_file_limits(Path::new(path))?;
    let doc = Document::load(path).map_err(|e| format!("Couldn't read this PDF: {e}"))?;
    let info = doc
        .trailer
        .get(b"Info")
        .ok()
        .and_then(|o| match o {
            Object::Reference(id) => doc.get_object(*id).ok(),
            other => Some(other),
        })
        .and_then(|o| o.as_dict().ok());

    Ok(match info {
        Some(d) => PdfMetadata {
            title: read_field(d, b"Title"),
            author: read_field(d, b"Author"),
            subject: read_field(d, b"Subject"),
            keywords: read_field(d, b"Keywords"),
            creator: read_field(d, b"Creator"),
            producer: read_field(d, b"Producer"),
        },
        None => PdfMetadata::default(),
    })
}

pub fn set_metadata(path: &str, meta: PdfMetadata, out_dir: &str) -> Result<OperationResult, String> {
    check_file_limits(Path::new(path))?;
    let mut doc = Document::load(path).map_err(|e| format!("Couldn't read this PDF: {e}"))?;

    let entries: [(&[u8], &str); 5] = [
        (b"Title", &meta.title),
        (b"Author", &meta.author),
        (b"Subject", &meta.subject),
        (b"Keywords", &meta.keywords),
        (b"Creator", &meta.creator),
    ];

    let info_id = match doc.trailer.get(b"Info") {
        Ok(Object::Reference(id)) => Some(*id),
        _ => None,
    };

    if let Some(id) = info_id {
        if let Ok(obj) = doc.get_object_mut(id) {
            if let Ok(dict) = obj.as_dict_mut() {
                for (k, v) in entries {
                    dict.set(k.to_vec(), encode_text(v));
                }
            }
        }
    } else {
        let mut dict = Dictionary::new();
        for (k, v) in entries {
            dict.set(k.to_vec(), encode_text(v));
        }
        let id = doc.add_object(Object::Dictionary(dict));
        doc.trailer.set("Info", Object::Reference(id));
    }

    let name = format!("{} (metadata).pdf", stem(Path::new(path)));
    let out_path = unique_path(Path::new(out_dir), &name);
    doc.save(&out_path).map_err(|e| format!("Couldn't save PDF: {e}"))?;

    Ok(OperationResult {
        files: vec![OutputFile {
            name: out_path.file_name().and_then(|s| s.to_str()).unwrap_or(&name).to_string(),
            path: out_path.to_string_lossy().to_string(),
            size: file_size(&out_path),
            badge: None,
        }],
        out_dir: out_dir.to_string(),
    })
}
