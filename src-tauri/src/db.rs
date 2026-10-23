//! The local library: imported bundles, located videos, and (from phase 3) the corrections op log.
//!
//! Migrations are numbered and applied in order; `PRAGMA user_version` records the last one applied
//! (the same scheme as Flowmail).

use rusqlite::Connection;
use std::path::Path;

struct Migration {
    version: u32,
    name: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    name: "library",
    sql: r#"
        -- One row per imported bundle. The bundle's files are copied, read-only, into bundle_dir.
        CREATE TABLE bundles (
            id              TEXT PRIMARY KEY,          -- uuid
            manifest_sha256 TEXT NOT NULL UNIQUE,      -- the same bundle is imported once
            title           TEXT NOT NULL,
            video_sha256    TEXT NOT NULL,
            schema_version  TEXT NOT NULL,
            bundle_dir      TEXT NOT NULL,
            source_dir      TEXT NOT NULL,
            imported_at     TEXT NOT NULL
        );
        -- Where each video was found. Bundles reference videos by checksum, never by path.
        CREATE TABLE videos (
            sha256      TEXT PRIMARY KEY,
            path        TEXT NOT NULL,
            verified_at TEXT NOT NULL
        );
        -- Append-only op log of corrections and added data over a bundle (used from phase 3).
        CREATE TABLE corrections (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            bundle_id  TEXT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
            op         TEXT NOT NULL,               -- JSON
            created_at TEXT NOT NULL
        );
        CREATE INDEX corrections_by_bundle ON corrections(bundle_id, id);
    "#,
}];

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    migrate(&conn)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let current: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    for m in MIGRATIONS.iter().filter(|m| m.version > current) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(m.sql)?;
        tx.pragma_update(None, "user_version", m.version)?;
        tx.commit()?;
        eprintln!("database migrated to v{} ({})", m.version, m.name);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_apply_once_and_record_the_version() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap(); // second run is a no-op
        let v: u32 = conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
        assert_eq!(v, MIGRATIONS.last().unwrap().version);
        conn.execute("INSERT INTO videos VALUES ('abc', '/tmp/v.mp4', 'now')", []).unwrap();
    }
}
