//! Cooperative cancellation for jobs that run inside a single Tauri command.
//!
//! Rust work cannot be killed mid-call, so commands check this flag between
//! files, parts, or pages and return a partial result instead.

use std::sync::atomic::{AtomicBool, Ordering};

static CANCELLED: AtomicBool = AtomicBool::new(false);

/// Clears the flag at the start of every job.
pub fn reset() {
    CANCELLED.store(false, Ordering::SeqCst);
}

/// Called by the `cancel_job` command when the user presses Cancel.
pub fn request() {
    CANCELLED.store(true, Ordering::SeqCst);
}

pub fn is_cancelled() -> bool {
    CANCELLED.load(Ordering::SeqCst)
}
