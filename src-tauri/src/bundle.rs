//! Reading and checking track bundles (hyperstudy-perception `schema/README.md`).
//!
//! Import checks what the app relies on: the format marker, a schema major version this app reads, and that every
//! layer and side file listed in the manifest exists with the recorded size and sha256. Full schema validation is
//! the pipeline's job (`pipeline/bundle/validate.py`); the app trusts a bundle whose files match its manifest.

use crate::error::{Error, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::Path;

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
    Ok(manifest)
}

/// Every file the manifest lists (layers, side files and assets), as (relative path, bytes, sha256).
pub fn listed_files(manifest: &Value) -> Vec<(String, u64, String)> {
    let layer_files = manifest["layers"].as_object().into_iter().flat_map(|m| m.values())
        .flat_map(|entry| std::iter::once(entry).chain(entry["side_files"].as_array().into_iter().flatten()));
    let assets = manifest["assets"].as_array().into_iter().flatten();
    layer_files.chain(assets)
        .filter_map(|f| Some((f["file"].as_str()?.to_string(), f["bytes"].as_u64()?, f["sha256"].as_str()?.to_string())))
        .collect()
}

pub fn verify_files(dir: &Path, manifest: &Value) -> Result<()> {
    for (file, bytes, sha) in listed_files(manifest) {
        if file.contains("..") || Path::new(&file).is_absolute() {
            return Err(Error::Bundle(format!("manifest lists a path outside the bundle: {file}")));
        }
        let path = dir.join(&file);
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
    for (file, _, _) in listed_files(manifest) {
        let target = dst.join(&file);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(src.join(&file), target)?;
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
