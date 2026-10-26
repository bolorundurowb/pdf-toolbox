//! Page decoration applied while an organised PDF is saved: watermark, page
//! numbers, header/footer text, and cropping.

use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId};

use super::model::OrganizeOptions;

/// Applies the enabled decorations to each page in `page_ids`, in output order.
pub fn apply(doc: &mut Document, page_ids: &[ObjectId], options: &OrganizeOptions) -> Result<(), String> {
    let wants_watermark = !options.watermark_text.trim().is_empty();
    let wants_numbers = options.page_numbers;
    let wants_header = !options.header_text.trim().is_empty();
    let wants_footer = !options.footer_text.trim().is_empty();
    let wants_text = wants_watermark || wants_numbers || wants_header || wants_footer;
    let crop = options.crop_margin.max(0.0);
    if !wants_text && crop <= 0.0 {
        return Ok(());
    }

    let font_id = if wants_text {
        Some(doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
            "Encoding" => "WinAnsiEncoding",
        }))
    } else {
        None
    };
    let opacity = options.watermark_opacity.clamp(0.02, 1.0);
    let gs_id = if wants_watermark && opacity < 0.999 {
        Some(doc.add_object(dictionary! {
            "Type" => "ExtGState",
            "ca" => opacity,
            "CA" => opacity,
        }))
    } else {
        None
    };

    for (index, page_id) in page_ids.iter().enumerate() {
        let page = doc
            .get_dictionary(*page_id)
            .map_err(|e| format!("Invalid page {}: {e}", index + 1))?
            .clone();
        let (x0, y0, x1, y1) = media_box(doc, &page).unwrap_or((0.0, 0.0, 595.276, 841.89));
        let width = (x1 - x0).abs();
        let height = (y1 - y0).abs();

        if crop > 0.0 && width > 2.0 * crop && height > 2.0 * crop {
            let crop_box = vec![
                real(x0 + crop),
                real(y0 + crop),
                real(x1 - crop),
                real(y1 - crop),
            ];
            if let Ok(dict) = doc.get_dictionary_mut(*page_id) {
                dict.set("CropBox", crop_box);
            }
        }

        if !wants_text {
            continue;
        }
        let font = font_id.unwrap();
        add_text_resources(doc, *page_id, font, gs_id)?;

        let mut ops: Vec<Operation> = Vec::new();
        if wants_watermark {
            let text = options.watermark_text.trim();
            let longest = text.chars().count().max(1) as f64;
            let size = (width.min(height) * 0.11).min(width / (longest * 0.58)).clamp(12.0, 96.0);
            let text_width = longest * size * 0.5;
            let (cos, sin) = if options.watermark_placement == "horizontal" {
                (1.0, 0.0)
            } else {
                (std::f64::consts::FRAC_1_SQRT_2, std::f64::consts::FRAC_1_SQRT_2)
            };
            let cx = x0 + width / 2.0;
            let cy = y0 + height / 2.0;
            if gs_id.is_some() {
                ops.push(Operation::new("q", vec![]));
                ops.push(Operation::new("gs", vec![Object::Name(b"GS1".to_vec())]));
            }
            ops.extend(text_block(
                text,
                size,
                (0.45, 0.45, 0.45),
                [cos, sin, -sin, cos, cx, cy],
                (-(text_width / 2.0) * cos, -(size / 3.0)),
            ));
            if gs_id.is_some() {
                ops.push(Operation::new("Q", vec![]));
            }
        }

        if wants_numbers {
            let number = options.page_number_start + index as i64;
            let label = number.to_string();
            let size = 10.0;
            let text_width = label.chars().count() as f64 * size * 0.5;
            let margin = 24.0;
            let (tx, ty) = if options.page_number_placement == "centre" {
                (x0 + (width - text_width) / 2.0, y0 + margin)
            } else {
                (x1 - margin - text_width, y0 + margin)
            };
            ops.extend(text_block(&label, size, (0.25, 0.25, 0.25), [1.0, 0.0, 0.0, 1.0, tx, ty], (0.0, 0.0)));
        }
        if wants_header {
            let text = options.header_text.trim();
            let size = 10.0;
            let text_width = text.chars().count() as f64 * size * 0.5;
            ops.extend(text_block(
                text,
                size,
                (0.25, 0.25, 0.25),
                [1.0, 0.0, 0.0, 1.0, x0 + (width - text_width) / 2.0, y1 - 30.0],
                (0.0, 0.0),
            ));
        }
        if wants_footer {
            let text = options.footer_text.trim();
            let size = 10.0;
            let text_width = text.chars().count() as f64 * size * 0.5;
            ops.extend(text_block(
                text,
                size,
                (0.25, 0.25, 0.25),
                [1.0, 0.0, 0.0, 1.0, x0 + (width - text_width) / 2.0, y0 + 18.0],
                (0.0, 0.0),
            ));
        }

        if ops.is_empty() {
            continue;
        }
        let content = Content { operations: ops };
        let bytes = content.encode().map_err(|e| format!("Couldn't add page decorations: {e}"))?;
        doc.add_page_contents(*page_id, bytes)
            .map_err(|e| format!("Couldn't add page decorations: {e}"))?;
    }
    Ok(())
}

/// A full `BT … ET` text run at a given text matrix.
fn text_block(
    text: &str,
    size: f64,
    colour: (f64, f64, f64),
    matrix: [f64; 6],
    offset: (f64, f64),
) -> Vec<Operation> {
    vec![
        Operation::new("BT", vec![]),
        Operation::new("Tf", vec![Object::Name(b"F1".to_vec()), real(size)]),
        Operation::new("rg", vec![real(colour.0), real(colour.1), real(colour.2)]),
        Operation::new(
            "Tm",
            vec![
                real(matrix[0]),
                real(matrix[1]),
                real(matrix[2]),
                real(matrix[3]),
                real(matrix[4]),
                real(matrix[5]),
            ],
        ),
        Operation::new("Td", vec![real(offset.0), real(offset.1)]),
        Operation::new("Tj", vec![Object::string_literal(clean_text(text))]),
        Operation::new("ET", vec![]),
    ]
}

/// Standard-14 fonts use WinAnsi; a few characters outside it are replaced so
/// the content stream stays valid.
fn clean_text(text: &str) -> Vec<u8> {
    text.chars()
        .map(|c| if (c as u32) < 256 { c as u8 } else { b'?' })
        .collect()
}

/// Adds `F1` (and `GS1` when needed) to the page's resource dictionary.
fn add_text_resources(doc: &mut Document, page_id: ObjectId, font_id: ObjectId, gs_id: Option<ObjectId>) -> Result<(), String> {
    let page = doc
        .get_dictionary(page_id)
        .map_err(|e| format!("Invalid page: {e}"))?
        .clone();
    let mut resources = match page.get(b"Resources").ok() {
        Some(Object::Reference(id)) => doc
            .get_dictionary(*id)
            .map_err(|e| format!("Invalid page resources: {e}"))?
            .clone(),
        Some(Object::Dictionary(dict)) => dict.clone(),
        _ => Dictionary::new(),
    };

    let mut fonts = nested_dict(doc, &resources, b"Font")?;
    fonts.set("F1", Object::Reference(font_id));
    resources.set("Font", Object::Dictionary(fonts));

    if let Some(gs) = gs_id {
        let mut states = nested_dict(doc, &resources, b"ExtGState")?;
        states.set("GS1", Object::Reference(gs));
        resources.set("ExtGState", Object::Dictionary(states));
    }

    let resources_id = doc.add_object(Object::Dictionary(resources));
    if let Ok(dict) = doc.get_dictionary_mut(page_id) {
        dict.set("Resources", Object::Reference(resources_id));
    }
    Ok(())
}

fn nested_dict(doc: &Document, parent: &Dictionary, key: &[u8]) -> Result<Dictionary, String> {
    match parent.get(key).ok() {
        Some(Object::Reference(id)) => doc
            .get_dictionary(*id)
            .map(|d| d.clone())
            .map_err(|e| format!("Invalid resource dictionary: {e}")),
        Some(Object::Dictionary(dict)) => Ok(dict.clone()),
        _ => Ok(Dictionary::new()),
    }
}

fn media_box(doc: &Document, page: &Dictionary) -> Option<(f64, f64, f64, f64)> {
    let object = page.get(b"MediaBox").ok()?;
    let resolved = match object {
        Object::Reference(id) => doc.get_object(*id).ok()?,
        other => other,
    };
    let array = resolved.as_array().ok()?;
    if array.len() < 4 {
        return None;
    }
    let value = |i: usize| -> Option<f64> {
        let o = &array[i];
        o.as_float().ok().map(|v| v as f64).or_else(|| o.as_i64().ok().map(|v| v as f64))
    };
    Some((value(0)?, value(1)?, value(2)?, value(3)?))
}

fn real(v: f64) -> Object {
    Object::Real(v as f32)
}
