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
    /// how many ops the bundle's corrections log holds
    pub corrections: usize,
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
        corrections: count_corrections(conn, &r.id)?,
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
    Ok(fs::read_to_string(bundle::safe_path(dir, file)?)?)
}

/// A file the manifest lists (a side file such as `layers/faces_detail.json`), as text. Nothing else in the bundle
/// folder can be read this way.
pub fn read_bundle_file(dir: &Path, rel: &str) -> Result<String> {
    let manifest = bundle::read_manifest(dir)?;
    if !bundle::listed_files(&manifest)?.iter().any(|(file, _, _)| file == rel) {
        return Err(Error::NotFound(format!("{rel} is not a file this bundle lists")));
    }
    Ok(fs::read_to_string(bundle::safe_path(dir, rel)?)?)
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

// --- versions of one video, and carrying corrections over to a re-run ---

/// When a bundle was made, as an instant: its manifest's created_at, or when it was imported if the manifest has
/// none (or one that does not parse). Compared as instants: a Mac run and a cloud run write different UTC offsets.
fn made_at(s: &BundleSummary) -> chrono::DateTime<chrono::FixedOffset> {
    let parse = |t: &str| chrono::DateTime::parse_from_rfc3339(t).ok();
    s.created_at.as_deref().and_then(parse).or_else(|| parse(&s.imported_at)).unwrap_or_default()
}

/// The newest version of this bundle's video made before it that holds corrections: what a re-run would start from.
pub fn previous_version(conn: &Connection, id: &str) -> Result<Option<BundleSummary>> {
    let this = get(conn, id)?;
    let ids: Vec<String> = conn.prepare("SELECT id FROM bundles WHERE video_sha256 = ?1 AND id != ?2")?
        .query_map(params![this.video_sha256, id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    let mut earlier: Vec<BundleSummary> = ids.iter().map(|i| get(conn, i)).collect::<Result<_>>()?;
    earlier.retain(|b| b.corrections > 0 && made_at(b) < made_at(&this));
    earlier.sort_by_key(|b| std::cmp::Reverse(made_at(b)));
    Ok(earlier.into_iter().next())
}

#[derive(Debug, Serialize)]
pub struct Carryover {
    pub from_bundle_id: String,
    pub status: String,
    pub carried: usize,
    /// [{index, op, reason, span}]: ops of the earlier log that could not be carried, until the user dismisses them
    pub unmatched: Value,
    pub created_at: String,
}

pub fn get_carryover(conn: &Connection, id: &str) -> Result<Option<Carryover>> {
    let row: Option<(String, String, i64, String, String)> = conn.query_row(
        "SELECT from_bundle_id, status, carried, unmatched, created_at FROM carryovers WHERE bundle_id = ?1", params![id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).optional()?;
    row.map(|(from_bundle_id, status, carried, unmatched, created_at)| Ok(Carryover {
        unmatched: serde_json::from_str(&unmatched).map_err(|e| Error::Bundle(format!("stored carry-over is not JSON: {e}")))?,
        from_bundle_id, status, carried: carried as usize, created_at,
    })).transpose()
}

/// Checks before a carry-over is recorded: another version of the same video, this bundle without corrections of its
/// own, and not started fresh. An undone carry-over (record 'carried', log empty) can be carried again or declined.
fn check_carry(conn: &Connection, id: &str, from_id: &str) -> Result<()> {
    let (this, from) = (get_row(conn, id)?, get_row(conn, from_id)?);
    if id == from_id || this.video_sha256 != from.video_sha256 {
        return Err(Error::Bundle("corrections carry over only between versions of the same video".into()));
    }
    if get_carryover(conn, id)?.is_some_and(|c| c.status == "declined") {
        return Err(Error::Bundle("this version was started without the earlier corrections (declined)".into()));
    }
    if count_corrections(conn, id)? > 0 {
        return Err(Error::Bundle("this version already has corrections of its own".into()));
    }
    Ok(())
}

/// Start this bundle's log with ops the app re-anchored from an earlier version's log, and record what it could not
/// carry. Only onto an empty log; the earlier version's log is not touched. Returns the log's length.
pub fn carry_over(conn: &Connection, id: &str, from_id: &str, ops: &[Value], unmatched: &Value) -> Result<usize> {
    check_carry(conn, id, from_id)?;
    let tx = conn.unchecked_transaction()?;
    insert_ops(&tx, id, ops)?;
    tx.execute("INSERT OR REPLACE INTO carryovers (bundle_id, from_bundle_id, status, carried, unmatched, created_at) VALUES (?1, ?2, 'carried', ?3, ?4, ?5)",
               params![id, from_id, ops.len() as i64, unmatched.to_string(), chrono::Utc::now().to_rfc3339()])?;
    tx.commit()?;
    count_corrections(conn, id)
}

/// The user chose to start this version without the earlier corrections (so the app does not offer them again).
pub fn decline_carryover(conn: &Connection, id: &str, from_id: &str) -> Result<()> {
    check_carry(conn, id, from_id)?;
    conn.execute("INSERT OR REPLACE INTO carryovers (bundle_id, from_bundle_id, status, carried, unmatched, created_at) VALUES (?1, ?2, 'declined', 0, '[]', ?3)",
                 params![id, from_id, chrono::Utc::now().to_rfc3339()])?;
    Ok(())
}

/// Take one op (by its index in the earlier log) off the review list.
pub fn dismiss_unmatched(conn: &Connection, id: &str, index: u64) -> Result<Carryover> {
    let c = get_carryover(conn, id)?.ok_or_else(|| Error::NotFound("this version carried nothing over".into()))?;
    let left: Vec<Value> = c.unmatched.as_array().map(|a| a.iter().filter(|u| u["index"].as_u64() != Some(index)).cloned().collect()).unwrap_or_default();
    conn.execute("UPDATE carryovers SET unmatched = ?2 WHERE bundle_id = ?1", params![id, Value::Array(left).to_string()])?;
    get_carryover(conn, id)?.ok_or_else(|| Error::NotFound("the carry-over record disappeared".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use serde_json::json;

    /// A one-layer bundle in `dir` whose video is `video_bytes`.
    fn make_bundle(dir: &Path, video_bytes: &[u8]) {
        make_version(dir, video_bytes, "2026-10-23T00:00:00Z");
    }

    /// The same, made at `created_at` (a re-run of a video is another bundle of it, made later).
    fn make_version(dir: &Path, video_bytes: &[u8], created_at: &str) {
        let layer = br#"{"layer":"shots","shots":[]}"#;
        fs::create_dir_all(dir.join("layers")).unwrap();
        fs::write(dir.join("layers/shots.json"), layer).unwrap();
        let manifest = json!({
            "format": bundle::FORMAT, "schema_version": "0.1.0", "created_at": created_at,
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

    #[test]
    fn a_layer_path_cannot_read_files_outside_the_bundle() {
        // An imported copy whose manifest names a path outside it (as a crafted bundle could, before import rejected it).
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("secret.txt"), "private").unwrap();
        let dir = root.path().join("bundle");
        make_bundle(&dir, b"video bytes");
        let mut m: Value = serde_json::from_str(&fs::read_to_string(dir.join("manifest.json")).unwrap()).unwrap();
        m["layers"]["faces"] = json!({"file": "../secret.txt", "sha256": "0".repeat(64), "bytes": 7,
                                      "licence_mode": "commercial-ok", "stage": "faces"});
        fs::write(dir.join("manifest.json"), m.to_string()).unwrap();
        assert!(read_layer(&dir, "faces").is_err());
        assert!(read_bundle_file(&dir, "../secret.txt").is_err());
    }

    fn import_version(conn: &Connection, data: &Path, video: &[u8], created_at: &str) -> (String, tempfile::TempDir) {
        let src = tempfile::tempdir().unwrap();
        make_version(src.path(), video, created_at);
        let (id, manifest, dst) = prepare_import(src.path(), data).unwrap();
        record_import(conn, src.path(), &id, &manifest, &dst).unwrap();
        (id, src)
    }

    #[test]
    fn a_rerun_starts_from_the_newest_earlier_version_with_corrections() {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        let data = tempfile::tempdir().unwrap();
        let (v1, _a) = import_version(&conn, data.path(), b"video", "2026-10-01T00:00:00Z");
        let (v2, _b) = import_version(&conn, data.path(), b"video", "2026-10-10T00:00:00Z");
        let (v3, _c) = import_version(&conn, data.path(), b"video", "2026-10-20T00:00:00Z");
        let (other, _d) = import_version(&conn, data.path(), b"another video", "2026-10-15T00:00:00Z");
        append_corrections(&conn, &v1, &[json!({"op": "a"})]).unwrap();
        append_corrections(&conn, &other, &[json!({"op": "b"})]).unwrap();
        assert_eq!(previous_version(&conn, &v3).unwrap().map(|b| b.id), Some(v1.clone()));   // v2 has none
        append_corrections(&conn, &v2, &[json!({"op": "c"})]).unwrap();
        assert_eq!(previous_version(&conn, &v3).unwrap().map(|b| b.id), Some(v2.clone()));
        assert!(previous_version(&conn, &v1).unwrap().is_none());                            // nothing earlier
    }

    #[test]
    fn carrying_over_appends_to_the_new_log_once_and_leaves_the_earlier_log_alone() {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        let data = tempfile::tempdir().unwrap();
        let (v1, _a) = import_version(&conn, data.path(), b"video", "2026-10-01T00:00:00Z");
        let (v2, _b) = import_version(&conn, data.path(), b"video", "2026-10-10T00:00:00Z");
        let (other, _c) = import_version(&conn, data.path(), b"another video", "2026-10-15T00:00:00Z");
        let earlier = vec![json!({"op": "shot.caption", "shot": "shot:1"}), json!({"op": "entity.include", "id": "face:3"})];
        append_corrections(&conn, &v1, &earlier).unwrap();

        let carried = vec![json!({"op": "shot.caption", "shot": "shot:11", "carried_from": {"bundle": v1, "index": 0}})];
        let unmatched = json!([{"index": 1, "op": earlier[1], "reason": "3 has no counterpart", "span": null}]);
        assert!(carry_over(&conn, &v2, &other, &carried, &unmatched).unwrap_err().to_string().contains("same video"));
        assert_eq!(carry_over(&conn, &v2, &v1, &carried, &unmatched).unwrap(), 1);
        assert_eq!(load_corrections(&conn, &v1).unwrap(), earlier);
        assert_eq!(load_corrections(&conn, &v2).unwrap(), carried);
        assert!(carry_over(&conn, &v2, &v1, &carried, &unmatched).unwrap_err().to_string().contains("of its own"));
        assert!(decline_carryover(&conn, &v2, &v1).is_err());

        let c = get_carryover(&conn, &v2).unwrap().unwrap();
        assert_eq!((c.status.as_str(), c.carried, c.unmatched.as_array().unwrap().len()), ("carried", 1, 1));
        assert!(dismiss_unmatched(&conn, &v2, 1).unwrap().unmatched.as_array().unwrap().is_empty());

        // deleting the earlier version keeps the newer one's carried ops and its record
        conn.execute("DELETE FROM bundles WHERE id = ?1", params![v1]).unwrap();
        assert_eq!(load_corrections(&conn, &v2).unwrap(), carried);
        assert!(get_carryover(&conn, &v2).unwrap().is_some());
    }

    #[test]
    fn a_version_with_its_own_corrections_or_a_declined_offer_is_not_carried_into() {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        let data = tempfile::tempdir().unwrap();
        let (v1, _a) = import_version(&conn, data.path(), b"video", "2026-10-01T00:00:00Z");
        let (v2, _b) = import_version(&conn, data.path(), b"video", "2026-10-10T00:00:00Z");
        let (v3, _c) = import_version(&conn, data.path(), b"video", "2026-10-20T00:00:00Z");
        append_corrections(&conn, &v1, &[json!({"op": "a"})]).unwrap();
        append_corrections(&conn, &v2, &[json!({"op": "mine"})]).unwrap();
        assert!(carry_over(&conn, &v2, &v1, &[], &json!([])).unwrap_err().to_string().contains("of its own"));
        decline_carryover(&conn, &v3, &v1).unwrap();
        assert_eq!(get_carryover(&conn, &v3).unwrap().unwrap().status, "declined");
        assert!(carry_over(&conn, &v3, &v1, &[], &json!([])).is_err());
    }

    #[test]
    fn versions_are_ordered_by_instant_not_by_how_their_times_are_written() {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        let data = tempfile::tempdir().unwrap();
        // 13:00 UTC, then 12:00 in New York (16:00 UTC): as text the first sorts later
        let (v1, _a) = import_version(&conn, data.path(), b"video", "2026-10-10T13:00:00+00:00");
        let (v2, _b) = import_version(&conn, data.path(), b"video", "2026-10-10T12:00:00-04:00");
        append_corrections(&conn, &v1, &[json!({"op": "a"})]).unwrap();
        append_corrections(&conn, &v2, &[json!({"op": "b"})]).unwrap();
        assert_eq!(previous_version(&conn, &v2).unwrap().map(|b| b.id), Some(v1.clone()));
        assert!(previous_version(&conn, &v1).unwrap().is_none());
    }

    #[test]
    fn an_undone_carry_over_can_be_carried_again_or_declined_until_the_version_has_its_own_corrections() {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        let data = tempfile::tempdir().unwrap();
        let (v1, _a) = import_version(&conn, data.path(), b"video", "2026-10-01T00:00:00Z");
        let (v2, _b) = import_version(&conn, data.path(), b"video", "2026-10-10T00:00:00Z");
        append_corrections(&conn, &v1, &[json!({"op": "a"})]).unwrap();
        let carried = [json!({"op": "a", "carried_from": {"bundle": v1, "index": 0}})];
        carry_over(&conn, &v2, &v1, &carried, &json!([])).unwrap();
        truncate_corrections(&conn, &v2, 0).unwrap();                              // undo takes the whole carry-over
        assert_eq!(carry_over(&conn, &v2, &v1, &carried, &json!([])).unwrap(), 1);
        truncate_corrections(&conn, &v2, 0).unwrap();
        decline_carryover(&conn, &v2, &v1).unwrap();
        assert!(carry_over(&conn, &v2, &v1, &carried, &json!([])).unwrap_err().to_string().contains("declined"));
    }
}
