//! HEIC/HEIF still-image decoding.
//!
//! `heif-oxide` is a pure-Rust decoder: no C library, no `unsafe` in this app,
//! and an MIT or Apache-2.0 licence. It applies the file's rotation and converts
//! Display P3 to sRGB, so these images must not go through the EXIF orientation
//! pass used for the `image` crate formats.

use std::path::Path;

use image::{DynamicImage, RgbaImage};

use super::util::short_filename;

pub fn is_heif(path: &str) -> bool {
    let ext = Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    ext == "heic" || ext == "heif"
}

/// Decodes a HEIC/HEIF file to a display-ready image.
pub fn decode(path: &str) -> Result<DynamicImage, String> {
    let decoded = heif_oxide::decode_file(path)
        .map_err(|e| format!("Couldn't read {}: {e}", short_filename(path)))?;
    let rgba = decoded.to_rgba8();
    let buffer = RgbaImage::from_raw(decoded.width, decoded.height, rgba).ok_or_else(|| {
        format!("Couldn't read {}: decoded image has an unexpected size.", short_filename(path))
    })?;
    Ok(DynamicImage::ImageRgba8(buffer))
}

pub fn dimensions(path: &str) -> Result<(u32, u32), String> {
    heif_oxide::decode_file(path)
        .map(|image| (image.width, image.height))
        .map_err(|e| format!("Couldn't read {}: {e}", short_filename(path)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 64×64 red still image from the decoder's own test data.
    const FIXTURE: &[u8] = include_bytes!("../../tests/fixtures/flat_red_64.heic");

    #[test]
    fn decodes_a_heic_fixture() {
        let path = std::env::temp_dir().join("pdf-toolbox-heic-fixture.heic");
        std::fs::write(&path, FIXTURE).unwrap();
        let image = decode(path.to_str().unwrap()).unwrap();
        assert_eq!((image.width(), image.height()), (64, 64));
        assert_eq!(dimensions(path.to_str().unwrap()).unwrap(), (64, 64));
        let _ = std::fs::remove_file(path);
    }
}
