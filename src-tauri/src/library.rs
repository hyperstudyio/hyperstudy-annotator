//! The library: importing bundles, recording where their videos are, and reading their files.
//!
//! Plain functions over a database connection and the app's data folder, so they can be tested without a running
//! app; `commands.rs` wraps them for the frontend.

use crate::bundle;
use crate::error::{Error, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
pub struct BundleSummary {
    pub id: String,
    pub title: String,
    pub video_sha256: String,
    pub schema_version: String,
    pub created_at: Option<String>,
    pub imported_at: String,
    /// layer name -> licence mode, as the manifest records it
    pub layers: BTreeMap<String, String>,
    /// where the video was last verified, if the file is still there
    pub video_path: Option<String>,
}

struct Row {
    id: String,
    title: String,
    video_sha256: String,
    schema_version: String,
    bundle_dir: String,
    imported_at: String,
}

const SELECT: &str = "SELECT id, title, video_sha256, schema_version, bundle_dir, imported_at FROM bundles";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Row> {
    Ok(Row { id: r.get(0)?, title: r.get(1)?, video_sha256: r.get(2)?, schema_version: r.get(3)?,
             bundle_dir: r.get(4)?, imported_at: r.get(5)? })
}

fn get_row(conn: &Connection, id: &str) -> Result<Row> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), params![id], row).optional()?
        .ok_or_else(|| Error::NotFound(format!("no bundle {id}")))
}

pub fn bundle_dir(conn: &Connection, id: &str) -> Result<PathBuf> {
    Ok(PathBuf::from(get_row(conn, id)?.bundle_dir))
}

fn video_path(conn: &Connection, sha: &str) -> Result<Option<String>> {
    let path: Option<String> = conn.query_row("SELECT path FROM videos WHERE sha256 = ?1", params![sha], |r| r.get(0)).optional()?;
    Ok(path.filter(|p| Path::new(p).is_file()))
}

fn summary(conn: &Connection, r: Row) -> Result<BundleSummary> {
    let manifest = bundle::read_manifest(Path::new(&r.bundle_dir))?;
    let layers = manifest["layers"].as_object().map(|m| m.iter()
        .map(|(k, v)| (k.clone(), v["licence_mode"].as_str().unwrap_or("").to_string())).collect()).unwrap_or_default();
    Ok(BundleSummary {
        video_path: video_path(conn, &r.video_sha256)?,
        created_at: manifest["created_at"].as_str().map(String::from),
        id: r.id, title: r.title, video_sha256: r.video_sha256, schema_version: r.schema_version,
        imported_at: r.imported_at, layers,
    })
}

pub fn get(conn: &Connection, id: &str) -> Result<BundleSummary> {
    summary(conn, get_row(conn, id)?)
}

pub fn list(conn: &Connection) -> Result<Vec<BundleSummary>> {
    let rows: Vec<Row> = conn.prepare(&format!("{SELECT} ORDER BY imported_at DESC"))?
        .query_map([], row)?.collect::<rusqlite::Result<_>>()?;
    rows.into_iter().map(|r| summary(conn, r)).collect()
}

/// The id of an already imported copy of this bundle, if any (bundles are matched by their manifest's checksum).
pub fn find_imported(conn: &Connection, src: &Path) -> Result<Option<String>> {
    let manifest_sha = bundle::sha256_bytes(&fs::read(src.join("manifest.json"))?);
    Ok(conn.query_row("SELECT id FROM bundles WHERE manifest_sha256 = ?1", params![manifest_sha], |r| r.get(0)).optional()?)
}

/// Check a bundle and copy it into `data_dir/bundles/<new id>`. Slow for large bundles (hashes every file): call it
/// off the main thread, then `record_import` with the result.
pub fn prepare_import(src: &Path, data_dir: &Path) -> Result<(String, Value, PathBuf)> {
    let manifest = bundle::read_manifest(src)?;
    bundle::verify_files(src, &manifest)?;
    let id = uuid::Uuid::new_v4().to_string();
    let dst = data_dir.join("bundles").join(&id);
    bundle::copy_listed(src, &dst, &manifest)?;
    Ok((id, manifest, dst))
}

pub fn record_import(conn: &Connection, src: &Path, id: &str, manifest: &Value, dst: &Path) -> Result<BundleSummary> {
    let manifest_sha = bundle::sha256_bytes(&fs::read(src.join("manifest.json"))?);
    let title = manifest["video"]["filename"].as_str()
        .map(|f| Path::new(f).file_stem().unwrap_or_default().to_string_lossy().into_owned())
        .unwrap_or_else(|| src.file_name().unwrap_or_default().to_string_lossy().into_owned());
    conn.execute(
        "INSERT INTO bundles (id, manifest_sha256, title, video_sha256, schema_version, bundle_dir, source_dir, imported_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, manifest_sha, title, manifest["video"]["sha256"].as_str().unwrap_or_default(),
                manifest["schema_version"].as_str().unwrap_or(""), dst.to_string_lossy(), src.to_string_lossy(),
                chrono::Utc::now().to_rfc3339()],
    )?;
    get(conn, id)
}

pub fn expected_video(conn: &Connection, id: &str) -> Result<String> {
    Ok(get_row(conn, id)?.video_sha256)
}

/// Record that `path` holds the video with this checksum (the caller has already hashed it and compared).
pub fn record_video(conn: &Connection, sha: &str, path: &str) -> Result<()> {
    conn.execute("INSERT INTO videos (sha256, path, verified_at) VALUES (?1, ?2, ?3)
                  ON CONFLICT(sha256) DO UPDATE SET path = excluded.path, verified_at = excluded.verified_at",
                 params![sha, path, chrono::Utc::now().to_rfc3339()])?;
    Ok(())
}

pub fn check_video(expected: &str, path: &Path) -> Result<()> {
    let actual = bundle::sha256_file(path)?;
    if actual != expected {
        return Err(Error::VideoMismatch { expected: expected.to_string(), actual });
    }
    Ok(())
}

/// A layer file's JSON text. Only layers the manifest lists can be read.
pub fn read_layer(dir: &Path, name: &str) -> Result<String> {
    let manifest = bundle::read_manifest(dir)?;
    let file = manifest["layers"][name]["file"].as_str()
        .ok_or_else(|| Error::NotFound(format!("this bundle has no {name} layer")))?;
    Ok(fs::read_to_string(dir.join(file))?)
}

/// A file the manifest lists (a side file such as `layers/faces_detail.json`), as text. Nothing else in the bundle
/// folder can be read this way.
pub fn read_bundle_file(dir: &Path, rel: &str) -> Result<String> {
    let manifest = bundle::read_manifest(dir)?;
    if !bundle::listed_files(&manifest).iter().any(|(file, _, _)| file == rel) {
        return Err(Error::NotFound(format!("{rel} is not a file this bundle lists")));
    }
    Ok(fs::read_to_string(dir.join(rel))?)
}

/// The folder a bundle was imported from.
pub fn source_dir(conn: &Connection, id: &str) -> Result<PathBuf> {
    let dir: String = conn.query_row("SELECT source_dir FROM bundles WHERE id = ?1", params![id], |r| r.get(0)).optional()?
        .ok_or_else(|| Error::NotFound(format!("no bundle {id}")))?;
    Ok(PathBuf::from(dir))
}

/// The annotator prototype saved its corrections as `perception_corrections.json` in the run folder, which holds the
/// converted bundle as `bundle/`. When that file exists next to the folder a bundle was imported from, the viewer
/// offers to import it. Returns (path, text).
pub fn prototype_corrections(source: &Path) -> Result<Option<(String, String)>> {
    let Some(run) = source.parent() else { return Ok(None) };
    let path = run.join("perception_corrections.json");
    if !path.is_file() {
        return Ok(None);
    }
    Ok(Some((path.to_string_lossy().into_owned(), fs::read_to_string(&path)?)))
}

/// A corrections file the user picked to import (JSON only).
pub fn read_corrections_file(path: &Path) -> Result<String> {
    if path.extension().and_then(|e| e.to_str()) != Some("json") {
        return Err(Error::Bundle("a corrections file is a .json file".into()));
    }
    Ok(fs::read_to_string(path)?)
}

/// Write an exported corrections file where the user chose to save it.
pub fn write_corrections_file(path: &Path, text: &str) -> Result<()> {
    if path.extension().and_then(|e| e.to_str()) != Some("json") {
        return Err(Error::Bundle("save corrections as a .json file".into()));
    }
    Ok(fs::write(path, text)?)
}

// --- corrections: an append-only op log per bundle (the frontend folds it over the bundle) ---

/// The bundle's correction ops, oldest first.
pub fn load_corrections(conn: &Connection, bundle_id: &str) -> Result<Vec<Value>> {
    get_row(conn, bundle_id)?;
    let texts: Vec<String> = conn.prepare("SELECT op FROM corrections WHERE bundle_id = ?1 ORDER BY id")?
        .query_map(params![bundle_id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    texts.iter().map(|t| serde_json::from_str(t).map_err(|e| Error::Bundle(format!("stored correction is not JSON: {e}")))).collect()
}

fn insert_ops(conn: &Connection, bundle_id: &str, ops: &[Value]) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let mut stmt = conn.prepare("INSERT INTO corrections (bundle_id, op, created_at) VALUES (?1, ?2, ?3)")?;
    for op in ops {
        stmt.execute(params![bundle_id, op.to_string(), op["at"].as_str().unwrap_or(&now)])?;
    }
    Ok(())
}

/// Append ops; returns how many the log holds now.
pub fn append_corrections(conn: &Connection, bundle_id: &str, ops: &[Value]) -> Result<usize> {
    get_row(conn, bundle_id)?;
    let tx = conn.unchecked_transaction()?;
    insert_ops(&tx, bundle_id, ops)?;
    tx.commit()?;
    count_corrections(conn, bundle_id)
}

/// Keep only the oldest `keep` ops (undo removes the newest).
pub fn truncate_corrections(conn: &Connection, bundle_id: &str, keep: usize) -> Result<usize> {
    conn.execute("DELETE FROM corrections WHERE bundle_id = ?1 AND id NOT IN
                    (SELECT id FROM corrections WHERE bundle_id = ?1 ORDER BY id LIMIT ?2)",
                 params![bundle_id, keep as i64])?;
    count_corrections(conn, bundle_id)
}

/// Replace the whole log (importing a corrections file).
pub fn replace_corrections(conn: &Connection, bundle_id: &str, ops: &[Value]) -> Result<usize> {
    get_row(conn, bundle_id)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM corrections WHERE bundle_id = ?1", params![bundle_id])?;
    insert_ops(&tx, bundle_id, ops)?;
    tx.commit()?;
    count_corrections(conn, bundle_id)
}

fn count_corrections(conn: &Connection, bundle_id: &str) -> Result<usize> {
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM corrections WHERE bundle_id = ?1", params![bundle_id], |r| r.get(0))?;
    Ok(n as usize)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use serde_json::json;

    /// A one-layer bundle in `dir` whose video is `video_bytes`.
    fn make_bundle(dir: &Path, video_bytes: &[u8]) {
        let layer = br#"{"layer":"shots","shots":[]}"#;
        fs::create_dir_all(dir.join("layers")).unwrap();
        fs::write(dir.join("layers/shots.json"), layer).unwrap();
        let manifest = json!({
            "format": bundle::FORMAT, "schema_version": "0.1.0", "created_at": "2026-10-23T00:00:00Z",
            "video": {"sha256": bundle::sha256_bytes(video_bytes), "duration": 1.0, "fps": 25.0, "width": 2, "height": 2,
                      "filename": "clip.mp4"},
            "pipeline": {"name": "test", "version": "0"},
            "layers": {"shots": {"file": "layers/shots.json", "sha256": bundle::sha256_bytes(layer), "bytes": layer.len(),
                                  "licence_mode": "commercial-ok", "stage": "extract"}}
        });
        fs::write(dir.join("manifest.json"), manifest.to_string()).unwrap();
    }

    fn setup() -> (Connection, tempfile::TempDir, tempfile::TempDir) {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        let data = tempfile::tempdir().unwrap();
        let src = tempfile::tempdir().unwrap();
        make_bundle(src.path(), b"video bytes");
        (conn, data, src)
    }

    #[test]
    fn import_copies_records_and_lists_the_bundle() {
        let (conn, data, src) = setup();
        let (id, manifest, dst) = prepare_import(src.path(), data.path()).unwrap();
        let s = record_import(&conn, src.path(), &id, &manifest, &dst).unwrap();
        assert_eq!(s.title, "clip");
        assert_eq!(s.layers.get("shots").map(String::as_str), Some("commercial-ok"));
        assert!(s.video_path.is_none());
        assert!(dst.join("layers/shots.json").is_file());
        assert_eq!(list(&conn).unwrap().len(), 1);
        assert_eq!(find_imported(&conn, src.path()).unwrap(), Some(id.clone()));
        assert!(read_layer(&dst, "shots").unwrap().contains("\"shots\""));
        assert!(read_layer(&dst, "faces").unwrap_err().to_string().contains("no faces layer"));
    }

    #[test]
    fn only_the_matching_video_is_accepted_and_remembered() {
        let (conn, data, src) = setup();
        let (id, manifest, dst) = prepare_import(src.path(), data.path()).unwrap();
        record_import(&conn, src.path(), &id, &manifest, &dst).unwrap();
        let expected = expected_video(&conn, &id).unwrap();

        let wrong = src.path().join("other.mp4");
        fs::write(&wrong, b"something else").unwrap();
        assert!(matches!(check_video(&expected, &wrong), Err(Error::VideoMismatch { .. })));

        let right = src.path().join("clip.mp4");
        fs::write(&right, b"video bytes").unwrap();
        check_video(&expected, &right).unwrap();
        record_video(&conn, &expected, right.to_str().unwrap()).unwrap();
        assert_eq!(get(&conn, &id).unwrap().video_path.as_deref(), right.to_str());

        fs::remove_file(&right).unwrap(); // a moved or deleted video is reported as missing, not served
        assert!(get(&conn, &id).unwrap().video_path.is_none());
    }

    #[test]
    fn only_listed_files_can_be_read() {
        let (conn, data, src) = setup();
        let (id, manifest, dst) = prepare_import(src.path(), data.path()).unwrap();
        record_import(&conn, src.path(), &id, &manifest, &dst).unwrap();
        assert!(read_bundle_file(&dst, "layers/shots.json").unwrap().contains("shots"));
        assert!(read_bundle_file(&dst, "manifest.json").is_err());
        assert!(read_bundle_file(&dst, "../annotator.db").is_err());
        assert_eq!(source_dir(&conn, &id).unwrap(), src.path());
    }

    #[test]
    fn a_prototype_corrections_file_next_to_the_bundle_folder_is_found() {
        let run = tempfile::tempdir().unwrap();
        let bundle_dir = run.path().join("bundle");
        fs::create_dir_all(&bundle_dir).unwrap();
        assert!(prototype_corrections(&bundle_dir).unwrap().is_none());
        fs::write(run.path().join("perception_corrections.json"), r#"{"format":"perception-corrections/1"}"#).unwrap();
        let (path, text) = prototype_corrections(&bundle_dir).unwrap().unwrap();
        assert!(path.ends_with("perception_corrections.json"));
        assert!(text.contains("perception-corrections/1"));
    }

    #[test]
    fn corrections_files_must_be_json() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("c.json");
        write_corrections_file(&out, "{}").unwrap();
        assert_eq!(read_corrections_file(&out).unwrap(), "{}");
        assert!(write_corrections_file(&dir.path().join("c.txt"), "{}").is_err());
        assert!(read_corrections_file(&dir.path().join("c.txt")).is_err());
    }

    #[test]
    fn corrections_append_undo_and_replace_in_order() {
        let (conn, data, src) = setup();
        let (id, manifest, dst) = prepare_import(src.path(), data.path()).unwrap();
        record_import(&conn, src.path(), &id, &manifest, &dst).unwrap();
        let op = |n: u32| json!({"op": "person.rename", "person": "person:Person A", "name": format!("n{n}"), "at": format!("t{n}")});

        assert_eq!(append_corrections(&conn, &id, &[op(1), op(2)]).unwrap(), 2);
        assert_eq!(append_corrections(&conn, &id, &[op(3)]).unwrap(), 3);
        assert_eq!(load_corrections(&conn, &id).unwrap(), vec![op(1), op(2), op(3)]);

        assert_eq!(truncate_corrections(&conn, &id, 1).unwrap(), 1);   // undo keeps the oldest
        assert_eq!(load_corrections(&conn, &id).unwrap(), vec![op(1)]);

        assert_eq!(replace_corrections(&conn, &id, &[op(7), op(8)]).unwrap(), 2);
        assert_eq!(load_corrections(&conn, &id).unwrap(), vec![op(7), op(8)]);
        assert!(load_corrections(&conn, "no-such-bundle").is_err());
    }
}
