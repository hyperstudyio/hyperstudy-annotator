//! The local library: imported bundles, located videos, the corrections op log, and carry-overs between versions.
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
}, Migration {
    version: 2,
    name: "carry-over",
    sql: r#"
        -- Bundles of one video (same video_sha256) are versions of it: a re-run is imported as a new bundle.
        CREATE INDEX bundles_by_video ON bundles(video_sha256);
        -- A newer version's log can start from an earlier version's, re-anchored to the new ids by the app. The earlier
        -- log is never changed: the carried ops are appended to the new bundle's log as copies (each names the op it came
        -- from), so deleting the earlier version loses nothing. from_bundle_id has no foreign key for the same reason.
        CREATE TABLE carryovers (
            bundle_id      TEXT PRIMARY KEY REFERENCES bundles(id) ON DELETE CASCADE,   -- the newer version
            from_bundle_id TEXT NOT NULL,
            status         TEXT NOT NULL CHECK (status IN ('carried', 'declined')),
            carried        INTEGER NOT NULL,
            unmatched      TEXT NOT NULL,            -- JSON [{index, op, reason, span}]: left for review until dismissed
            created_at     TEXT NOT NULL
        );
    "#,
}, Migration {
    version: 3,
    name: "settings",
    sql: r#"
        -- App settings (the pipeline folder, for now). Secrets never go here: they belong in the OS keychain.
        CREATE TABLE settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    "#,
}, Migration {
    version: 4,
    name: "remote runs",
    sql: r#"
        -- Runs coordinated on a lab server (`perception remote run`) that this app started: each kept until it is
        -- imported into the library, so one that went on there while the app was closed is fetched when it is opened.
        CREATE TABLE remote_runs (
            run        TEXT PRIMARY KEY,           -- the pipeline's id for it
            host       TEXT NOT NULL,              -- the lab server it runs on, as `perception hosts` names it
            video      TEXT NOT NULL,              -- the video's path here
            choices    TEXT NOT NULL,              -- JSON {graph, only, settings, max_cost_usd}: as Extract started it
            state      TEXT NOT NULL CHECK (state IN ('running', 'imported', 'failed', 'canceled', 'dismissed')),
            problem    TEXT,                       -- why it failed, or could not be fetched or imported
            started_at TEXT NOT NULL
        );
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

    #[test]
    fn a_version_1_library_keeps_its_corrections_through_migration_2() {
        let conn = Connection::open_in_memory().unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        tx.execute_batch(MIGRATIONS[0].sql).unwrap();
        tx.pragma_update(None, "user_version", 1).unwrap();
        tx.commit().unwrap();
        conn.execute("INSERT INTO bundles VALUES ('b', 'm', 't', 'v', '0.1.0', '/d', '/s', 'now')", []).unwrap();
        conn.execute("INSERT INTO corrections (bundle_id, op, created_at) VALUES ('b', '{\"op\":\"x\"}', 'now')", []).unwrap();
        migrate(&conn).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM corrections WHERE bundle_id = 'b'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        conn.execute("INSERT INTO carryovers VALUES ('b', 'a', 'declined', 0, '[]', 'now')", []).unwrap();
    }
}
