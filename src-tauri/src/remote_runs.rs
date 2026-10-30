//! Runs coordinated on a lab server (`perception remote run`) that this app started (the `remote_runs` table): one is
//! `running` from just before it is started (the app names it: `--run-id`) until it is imported into the library
//! (`imported`), ends without a bundle (`failed`, `canceled`), or is put away (`dismissed`). While one path fetches and
//! imports it, it is `importing` (claim): the page following it and the listing of runs never both import one run. A
//! fetch or import that fails puts it back to `running` with the reason, so the next look tries again. Extract lists
//! the ones not imported, and one that went on there while the app was closed is fetched when it is opened again.
use crate::error::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RemoteRun {
    pub run: String,
    pub host: String,
    pub video: String,
    /// what was chosen for it, as Extract asked: {graph, only, settings, max_cost_usd}
    pub choices: serde_json::Value,
    pub state: String,
    pub problem: Option<String>,
    pub started_at: String,
}

const SELECT: &str = "SELECT run, host, video, choices, state, problem, started_at FROM remote_runs";

fn row(r: &rusqlite::Row) -> rusqlite::Result<RemoteRun> {
    let choices: String = r.get(3)?;
    Ok(RemoteRun { run: r.get(0)?, host: r.get(1)?, video: r.get(2)?, choices: serde_json::from_str(&choices).unwrap_or_default(),
                   state: r.get(4)?, problem: r.get(5)?, started_at: r.get(6)? })
}

/// A run about to be started under this id: `running`. Recorded again, it is left as it is.
pub fn record(conn: &Connection, run: &str, host: &str, video: &str, choices: &serde_json::Value) -> Result<()> {
    conn.execute("INSERT OR IGNORE INTO remote_runs (run, host, video, choices, state, started_at) VALUES (?1, ?2, ?3, ?4, 'running', ?5)",
                 params![run, host, video, choices.to_string(), chrono::Utc::now().to_rfc3339()])?;
    Ok(())
}

pub fn set_state(conn: &Connection, run: &str, state: &str, problem: Option<&str>) -> Result<()> {
    conn.execute("UPDATE remote_runs SET state = ?2, problem = ?3 WHERE run = ?1", params![run, state, problem])?;
    Ok(())
}

/// Take a run that has ended there for fetching and importing (`importing`): true for the one caller that gets it.
pub fn claim(conn: &Connection, run: &str) -> Result<bool> {
    Ok(conn.execute("UPDATE remote_runs SET state = 'importing' WHERE run = ?1 AND state = 'running'", params![run])? == 1)
}

/// At start: a run that was being imported when the app was quit is `running` again, so its import is tried again.
pub fn recover(conn: &Connection) -> Result<()> {
    conn.execute("UPDATE remote_runs SET state = 'running' WHERE state = 'importing'", [])?;
    Ok(())
}

pub fn get(conn: &Connection, run: &str) -> Result<Option<RemoteRun>> {
    Ok(conn.query_row(&format!("{SELECT} WHERE run = ?1"), params![run], row).optional()?)
}

/// The runs Extract lists: running there (or being imported), or failed and not put away; newest first.
pub fn open(conn: &Connection) -> Result<Vec<RemoteRun>> {
    let mut stmt = conn.prepare(&format!("{SELECT} WHERE state IN ('running', 'importing', 'failed') ORDER BY started_at DESC"))?;
    let rows = stmt.query_map([], row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_run_is_listed_until_it_is_imported_or_a_failure_is_put_away() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        let choices = serde_json::json!({"graph": "full.yaml", "only": ["faces"]});
        record(&conn, "20261029-120000-aaaaaa", "lab", "/v/a.mp4", &choices).unwrap();
        record(&conn, "20261029-130000-bbbbbb", "lab", "/v/b.mp4", &choices).unwrap();
        record(&conn, "20261029-120000-aaaaaa", "other", "/v/x.mp4", &choices).unwrap();   // named again: unchanged
        let runs = open(&conn).unwrap();
        assert_eq!(runs.iter().map(|r| r.run.as_str()).collect::<Vec<_>>(), ["20261029-130000-bbbbbb", "20261029-120000-aaaaaa"]);
        assert_eq!((runs[1].host.as_str(), runs[1].choices["only"][0].as_str()), ("lab", Some("faces")));
        set_state(&conn, "20261029-120000-aaaaaa", "imported", None).unwrap();
        set_state(&conn, "20261029-130000-bbbbbb", "failed", Some("Faces failed")).unwrap();
        assert_eq!(open(&conn).unwrap().iter().map(|r| (r.run.as_str(), r.problem.as_deref())).collect::<Vec<_>>(),
                   [("20261029-130000-bbbbbb", Some("Faces failed"))]);
        set_state(&conn, "20261029-130000-bbbbbb", "dismissed", None).unwrap();
        assert!(open(&conn).unwrap().is_empty());
        assert_eq!(get(&conn, "20261029-120000-aaaaaa").unwrap().unwrap().state, "imported");
        assert!(set_state(&conn, "20261029-120000-aaaaaa", "lost", None).is_err());   // not a state
    }

    #[test]
    fn a_run_is_fetched_and_imported_by_one_caller_and_a_failure_is_tried_again() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        record(&conn, "20261029-120000-aaaaaa", "lab", "/v/a.mp4", &serde_json::json!({})).unwrap();
        assert!(claim(&conn, "20261029-120000-aaaaaa").unwrap());
        assert!(!claim(&conn, "20261029-120000-aaaaaa").unwrap());   // the page and the listing: one of them imports it
        assert_eq!(open(&conn).unwrap()[0].state, "importing");          // still listed meanwhile
        set_state(&conn, "20261029-120000-aaaaaa", "running", Some("not imported yet: disk full")).unwrap();
        assert!(claim(&conn, "20261029-120000-aaaaaa").unwrap());     // tried again
        set_state(&conn, "20261029-120000-aaaaaa", "imported", None).unwrap();
        assert!(!claim(&conn, "20261029-120000-aaaaaa").unwrap());
    }
}
