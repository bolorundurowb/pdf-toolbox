//! Read and write PDF document information (the Info dictionary).

use std::path::Path;

use lopdf::{Dictionary, Document, Object, StringFormat};

use super::model::{OperationResult, OutputFile, PdfMetadata};
use super::util::{check_file_limits, ensure_unlocked, file_size, output_path, stem, Clash};

fn decode_text(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        let u16s: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&u16s)
    } else if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        // PDF 2.0 allows UTF-8 text strings, marked with a BOM.
        String::from_utf8_lossy(rest).into_owned()
    } else {
        // Without a BOM a text string is PDFDocEncoding, not UTF-8: decoding it
        // as UTF-8 turned accented names into U+FFFD, and saving made that permanent.
        bytes.iter().map(|&b| pdf_doc_char(b)).collect()
    }
}

/// PDFDocEncoding (PDF 32000 Annex D.2): Latin-1 except for 0x18–0x1F and 0x80–0x9F.
fn pdf_doc_char(b: u8) -> char {
    const LOW: [char; 8] = ['\u{02D8}', '\u{02C7}', '\u{02C6}', '\u{02D9}', '\u{02DD}', '\u{02DB}', '\u{02DA}', '\u{02DC}'];
    const HIGH: [char; 32] = [
        '\u{2022}', '\u{2020}', '\u{2021}', '\u{2026}', '\u{2014}', '\u{2013}', '\u{0192}', '\u{2044}',
        '\u{2039}', '\u{203A}', '\u{2212}', '\u{2030}', '\u{201E}', '\u{201C}', '\u{201D}', '\u{2018}',
        '\u{2019}', '\u{201A}', '\u{2122}', '\u{FB01}', '\u{FB02}', '\u{0141}', '\u{0152}', '\u{0160}',
        '\u{0178}', '\u{017D}', '\u{0131}', '\u{0142}', '\u{0153}', '\u{0161}', '\u{017E}', '\u{FFFD}',
    ];
    match b {
        0x18..=0x1F => LOW[(b - 0x18) as usize],
        0x80..=0x9F => HIGH[(b - 0x80) as usize],
        0xA0 => '\u{20AC}',
        _ => b as char,
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
    ensure_unlocked(&doc, "This PDF")?;
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

pub fn set_metadata(path: &str, meta: PdfMetadata, on_conflict: Option<String>, out_dir: &str) -> Result<OperationResult, String> {
    super::cancel::reset();
    check_file_limits(Path::new(path))?;
    let mut doc = Document::load(path).map_err(|e| format!("Couldn't read this PDF: {e}"))?;
    ensure_unlocked(&doc, "This PDF")?;

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

    // Most readers prefer the XMP stream over the Info dictionary, so a stale XMP
    // kept showing the old title. Drop it; readers then fall back to Info.
    if let Ok(catalog) = doc.catalog_mut() {
        catalog.remove(b"Metadata");
    }

    if super::cancel::is_cancelled() {
        return Ok(OperationResult::stopped(Vec::new(), out_dir.to_string()));
    }

    let name = format!("{} (properties).pdf", stem(Path::new(path)));
    let out_path = output_path(Path::new(out_dir), &name, Clash::from_option(on_conflict.as_deref()));
    doc.save(&out_path).map_err(|e| format!("Couldn't save PDF: {e}"))?;

    Ok(OperationResult::new(
        vec![OutputFile {
            name: out_path.file_name().and_then(|s| s.to_str()).unwrap_or(&name).to_string(),
            path: out_path.to_string_lossy().to_string(),
            size: file_size(&out_path),
            badge: None,
        }],
        out_dir.to_string(),
    ))
}
