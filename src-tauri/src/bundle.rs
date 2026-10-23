//! Reading and checking track bundles (hyperstudy-perception `schema/README.md`).
//!
//! Import checks what the app relies on: the format marker, a schema major version this app reads, and that every
//! layer, side file and asset listed in the manifest exists with the recorded size and sha256. Full schema validation
//! is the pipeline's job (`pipeline/bundle/validate.py`); the app trusts a bundle whose files match its manifest.
//!
//! Bundles come from other people, so their paths are untrusted. Every listed entry must be complete (an entry the
//! checks skipped could still be read later), and every path is checked with `safe_path` each time it is used, on
//! import and on every read: plain relative components only, and nothing that resolves outside the bundle folder.

use crate::error::{Error, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

pub const FORMAT: &str = "hyperstudy-perception-bundle";
/// Schema major versions this app can read.
pub const SUPPORTED_MAJOR: &[u32] = &[0];

pub fn read_manifest(dir: &Path) -> Result<Value> {
    let path = dir.join("manifest.json");
    let text = fs::read_to_string(&path).map_err(|e| Error::Bundle(format!("no manifest.json in {}: {e}", dir.display())))?;
    let manifest: Value = serde_json::from_str(&text).map_err(|e| Error::Bundle(format!("manifest.json is not JSON: {e}")))?;
    if manifest["format"] != FORMAT {
        return Err(Error::Bundle(format!("not a perception bundle (format is {})", manifest["format"])));
    }
    let version = manifest["schema_version"].as_str().unwrap_or("");
    let major: u32 = version.split('.').next().and_then(|m| m.parse().ok())
        .ok_or_else(|| Error::Bundle(format!("unreadable schema_version {version:?}")))?;
    if !SUPPORTED_MAJOR.contains(&major) {
        return Err(Error::Bundle(format!("schema {version} is newer than this app reads; update the app")));
    }
    if manifest["video"]["sha256"].as_str().map_or(true, |s| s.len() != 64) {
        return Err(Error::Bundle("manifest has no video sha256".into()));
    }
    for (file, _, _) in listed_files(&manifest)? {
        relative_components(&file)?;
    }
    Ok(manifest)
}

/// Every file the manifest lists (layers, side files and assets), as (relative path, bytes, sha256). An entry missing
/// any of the three is an error, never skipped.
pub fn listed_files(manifest: &Value) -> Result<Vec<(String, u64, String)>> {
    let mut entries: Vec<(String, &Value)> = Vec::new();
    for (name, entry) in manifest["layers"].as_object().into_iter().flatten() {
        entries.push((format!("layer {name}"), entry));
        for side in entry["side_files"].as_array().into_iter().flatten() {
            entries.push((format!("a side file of layer {name}"), side));
        }
    }
    for asset in manifest["assets"].as_array().into_iter().flatten() {
        entries.push(("an asset".to_string(), asset));
    }
    entries.into_iter().map(|(what, f)| match (f["file"].as_str(), f["bytes"].as_u64(), f["sha256"].as_str()) {
        (Some(file), Some(bytes), Some(sha)) => Ok((file.to_string(), bytes, sha.to_string())),
        _ => Err(Error::Bundle(format!("manifest entry for {what} lacks file, bytes or sha256"))),
    }).collect()
}

/// A manifest path made only of plain relative components: no root, drive prefix, `.` or `..`.
fn relative_components(rel: &str) -> Result<()> {
    let path = Path::new(rel);
    if rel.is_empty() || !path.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(Error::Bundle(format!("manifest lists a path outside the bundle: {rel:?}")));
    }
    Ok(())
}

/// `rel` inside `dir`, checked: relative components only, and if the file exists, its real location (symlinks
/// resolved) must be inside `dir`'s real location.
pub fn safe_path(dir: &Path, rel: &str) -> Result<PathBuf> {
    relative_components(rel)?;
    let path = dir.join(rel);
    if path.exists() {
        let real = path.canonicalize()?;
        if !real.starts_with(dir.canonicalize()?) {
            return Err(Error::Bundle(format!("{rel} resolves outside the bundle")));
        }
    }
    Ok(path)
}

pub fn verify_files(dir: &Path, manifest: &Value) -> Result<()> {
    for (file, bytes, sha) in listed_files(manifest)? {
        let path = safe_path(dir, &file)?;
        let meta = fs::metadata(&path).map_err(|_| Error::Bundle(format!("missing {file}")))?;
        if meta.len() != bytes || sha256_file(&path)? != sha {
            return Err(Error::Bundle(format!("{file} does not match its manifest checksum")));
        }
    }
    Ok(())
}

pub fn sha256_file(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

pub fn sha256_bytes(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Copy the manifest and every file it lists (nothing else) into `dst`.
pub fn copy_listed(src: &Path, dst: &Path, manifest: &Value) -> Result<()> {
    fs::create_dir_all(dst)?;
    fs::copy(src.join("manifest.json"), dst.join("manifest.json"))?;
    for (file, _, _) in listed_files(manifest)? {
        let from = safe_path(src, &file)?;
        let target = dst.join(&file);   // the same checked relative path, under a folder the app made
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(from, target)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn bundle(dir: &Path, layer_bytes: &[u8], recorded_sha: Option<&str>) -> Value {
        fs::create_dir_all(dir.join("layers")).unwrap();
        fs::write(dir.join("layers/shots.json"), layer_bytes).unwrap();
        let sha = recorded_sha.map(String::from).unwrap_or_else(|| sha256_bytes(layer_bytes));
        let manifest = json!({
            "format": FORMAT, "schema_version": "0.1.0", "created_at": "2026-10-23T00:00:00Z",
            "video": {"sha256": "a".repeat(64), "duration": 1.0, "fps": 25.0, "width": 2, "height": 2},
            "pipeline": {"name": "test", "version": "0"},
            "layers": {"shots": {"file": "layers/shots.json", "sha256": sha, "bytes": layer_bytes.len(),
                                  "licence_mode": "commercial-ok", "stage": "extract"}}
        });
        fs::write(dir.join("manifest.json"), manifest.to_string()).unwrap();
        manifest
    }

    #[test]
    fn a_matching_bundle_verifies_and_copies() {
        let src = tempfile::tempdir().unwrap();
        let manifest = bundle(src.path(), br#"{"layer":"shots"}"#, None);
        let read = read_manifest(src.path()).unwrap();
        verify_files(src.path(), &read).unwrap();
        let dst = tempfile::tempdir().unwrap();
        copy_listed(src.path(), dst.path(), &manifest).unwrap();
        verify_files(dst.path(), &manifest).unwrap();
    }

    #[test]
    fn assets_are_verified_and_copied_with_the_layers() {
        let src = tempfile::tempdir().unwrap();
        let mut manifest = bundle(src.path(), br#"{"layer":"shots"}"#, None);
        let crop = b"jpeg bytes";
        fs::create_dir_all(src.path().join("assets/crops")).unwrap();
        fs::write(src.path().join("assets/crops/face_0.jpg"), crop).unwrap();
        manifest["assets"] = json!([{"file": "assets/crops/face_0.jpg", "sha256": sha256_bytes(crop), "bytes": crop.len()}]);
        verify_files(src.path(), &manifest).unwrap();
        let dst = tempfile::tempdir().unwrap();
        copy_listed(src.path(), dst.path(), &manifest).unwrap();
        assert_eq!(fs::read(dst.path().join("assets/crops/face_0.jpg")).unwrap(), crop);

        fs::write(src.path().join("assets/crops/face_0.jpg"), b"changed").unwrap();
        assert!(verify_files(src.path(), &manifest).unwrap_err().to_string().contains("face_0.jpg"));
    }

    #[test]
    fn a_listed_file_without_a_checksum_is_rejected_not_skipped() {
        // An entry missing bytes/sha256 used to be skipped by verification, yet still readable by path later.
        let src = tempfile::tempdir().unwrap();
        let mut manifest = bundle(src.path(), br#"{"layer":"shots"}"#, None);
        manifest["layers"]["faces"] = json!({"file": "../outside.json", "licence_mode": "commercial-ok", "stage": "faces"});
        fs::write(src.path().join("manifest.json"), manifest.to_string()).unwrap();
        let err = read_manifest(src.path()).unwrap_err().to_string();
        assert!(err.contains("faces"), "{err}");
    }

    #[test]
    fn paths_that_leave_the_bundle_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        for bad in ["../x.json", "layers/../../x.json", "/etc/passwd", "./x.json", ""] {
            assert!(safe_path(dir.path(), bad).is_err(), "{bad} was accepted");
        }
        assert!(safe_path(dir.path(), "layers/shots.json").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_bundle_is_rejected_at_import() {
        let outside = tempfile::tempdir().unwrap();
        let secret = br#"{"secret":true}"#;
        fs::write(outside.path().join("secret.json"), secret).unwrap();
        let src = tempfile::tempdir().unwrap();
        let mut manifest = bundle(src.path(), br#"{"layer":"shots"}"#, None);
        std::os::unix::fs::symlink(outside.path().join("secret.json"), src.path().join("layers/faces.json")).unwrap();
        manifest["layers"]["faces"] = json!({"file": "layers/faces.json", "sha256": sha256_bytes(secret), "bytes": secret.len(),
                                             "licence_mode": "commercial-ok", "stage": "faces"});
        let err = verify_files(src.path(), &manifest).unwrap_err().to_string();
        assert!(err.contains("outside the bundle"), "{err}");
    }

    #[test]
    fn a_changed_layer_file_is_rejected() {
        let src = tempfile::tempdir().unwrap();
        bundle(src.path(), b"{}", Some(&"0".repeat(64)));
        let read = read_manifest(src.path()).unwrap();
        let err = verify_files(src.path(), &read).unwrap_err().to_string();
        assert!(err.contains("does not match"), "{err}");
    }

    #[test]
    fn an_unknown_major_version_is_rejected() {
        let src = tempfile::tempdir().unwrap();
        bundle(src.path(), b"{}", None);
        let mut m: Value = serde_json::from_str(&fs::read_to_string(src.path().join("manifest.json")).unwrap()).unwrap();
        m["schema_version"] = json!("7.0.0");
        fs::write(src.path().join("manifest.json"), m.to_string()).unwrap();
        assert!(read_manifest(src.path()).unwrap_err().to_string().contains("newer"));
    }

    #[test]
    fn file_hash_matches_bytes_hash() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("v.bin");
        let data: Vec<u8> = (0..3_000_000u32).map(|i| (i % 251) as u8).collect(); // spans several 1 MiB reads
        fs::write(&path, &data).unwrap();
        assert_eq!(sha256_file(&path).unwrap(), sha256_bytes(&data));
    }
}
