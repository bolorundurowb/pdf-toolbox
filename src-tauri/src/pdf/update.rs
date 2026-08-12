//! Checks GitHub releases so users know when a newer version is available.
//! Runs on `spawn_blocking` so a slow or failed request never stalls the UI.

use serde::Deserialize;

/// Shape of the GitHub `GET /repos/{owner}/{repo}/releases/latest` response.
#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
    body:    Option<String>,
    prerelease: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version:  Option<String>,
    pub update_available: bool,
    pub release_url:     Option<String>,
    pub release_notes:   Option<String>,
}

const REPO_URL: &str = "https://api.github.com/repos/bolorundurowb/pdf-toolbox/releases/latest";

pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

pub fn check_update() -> Result<UpdateInfo, String> {
    let current = app_version();

    let response = ureq::get(REPO_URL)
        .header("User-Agent", "pdf-toolbox-update-check/1")
        .header("Accept", "application/vnd.github.v3+json")
        .call()
        .map_err(|e| format!("Couldn't reach GitHub: {e}"))?;

    let body: String = response
        .into_body()
        .read_to_string()
        .map_err(|e| format!("Couldn't read response: {e}"))?;

    let release: Release = serde_json::from_str(&body)
        .map_err(|e| format!("Couldn't parse release info: {e}"))?;

    // GitHub tag names conventionally start with `v`, e.g. `v0.3.0`.
    let sem = release.tag_name.trim_start_matches('v');
    let is_newer = !release.prerelease && version_gt(sem, &current);

    Ok(UpdateInfo {
        current_version: current,
        latest_version:  Some(release.tag_name.clone()),
        update_available: is_newer,
        release_url:     Some(release.html_url),
        release_notes:   release.body,
    })
}

/// Returns true when `a` is strictly greater than `b` under simple semver-like
/// comparison (major.minor.patch).  Pre-release tags and other suffixes are
/// stripped so `2.0.0-beta.1` is treated as `2.0.0`.
fn version_gt(a: &str, b: &str) -> bool {
    fn nums(v: &str) -> Vec<u32> {
        v.split(|c: char| !c.is_ascii_digit())
            .filter(|s| !s.is_empty())
            .filter_map(|s| s.parse().ok())
            .collect()
    }
    nums(a) > nums(b)
}
