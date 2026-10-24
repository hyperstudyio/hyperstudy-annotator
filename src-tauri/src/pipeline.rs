//! Running the perception pipeline from the app: the `perception` CLI of a hyperstudy-perception folder, run with uv
//! and read through its `--json` output (one versioned JSON object per line; docs/cli-json.md in that repository).
//!
//! The app runs the uv it bundles (scripts/fetch-uv.sh, tauri.conf.json bundle.externalBin), never one found on the
//! machine. The pipeline folder is a setting (a lab checkout, for now; packaging the pipeline itself with the app is a
//! distribution question).
//! Plain functions over paths and processes, so they can be tested without a running app; `commands.rs` wraps them.
use crate::error::{Error, Result};
use serde::Serialize;
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

/// The `--json` protocol this app reads; a CLI speaking another version is refused rather than misread.
pub const PROTOCOL: u64 = 1;

/// The uv bundled with the app, next to `exe`: Tauri puts external binaries beside the executable, in the app bundle
/// and in `tauri dev` builds alike.
pub fn bundled_uv(exe: &Path) -> Result<PathBuf> {
    let uv = exe.with_file_name(if cfg!(windows) { "uv.exe" } else { "uv" });
    if uv.is_file() {
        Ok(uv)
    } else {
        Err(Error::Bundle(format!("the app's own uv is missing ({}); run scripts/fetch-uv.sh and build again", uv.display())))
    }
}

/// One line of `--json` output.
pub fn parse_line(line: &str) -> Result<Value> {
    let v: Value = serde_json::from_str(line)
        .map_err(|_| Error::Bundle(format!("the pipeline printed something that is not JSON: {}", line.chars().take(200).collect::<String>())))?;
    match (v["v"].as_u64(), v["type"].as_str()) {
        (Some(PROTOCOL), Some(_)) => Ok(v),
        (Some(other), _) => Err(Error::Bundle(format!("the pipeline speaks --json protocol {other}; this app reads {PROTOCOL}"))),
        _ => Err(Error::Bundle(format!("the pipeline printed JSON without a protocol version: {}", line.chars().take(200).collect::<String>()))),
    }
}

/// A run id as the CLI makes them (`20261024-095828-1ad462`). It names a folder the app later deletes, so nothing
/// else (a `..`, a path) is ever accepted from the CLI's output.
pub fn run_id(id: &str) -> Result<&str> {
    let b = id.as_bytes();
    let ok = b.len() == 22 && b[8] == b'-' && b[15] == b'-'
        && b[..8].iter().chain(&b[9..15]).all(u8::is_ascii_digit)
        && b[16..].iter().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(c));
    if ok { Ok(id) } else { Err(Error::Bundle(format!("the pipeline reported a run id that is not one: {id:?}"))) }
}

/// A pipeline folder must not be inside the app's own data (the library's bundle copies are made from files a bundle
/// lists, so a bundle could otherwise supply the code this app runs with uv).
pub fn check_folder(folder: &Path, data_dir: &Path) -> Result<()> {
    let (f, d) = (folder.canonicalize()?, data_dir.canonicalize()?);   // the data folder exists (made at start-up)
    if f.starts_with(&d) {
        return Err(Error::Bundle(format!("{} is inside the app's own data; choose your hyperstudy-perception folder", folder.display())));
    }
    Ok(())
}

/// `path`, resolved, if it is inside `dir` (the CLI reports where it wrote an export; it must be where it was asked).
pub fn inside(path: &Path, dir: &Path) -> Result<PathBuf> {
    let (p, d) = (path.canonicalize()?, dir.canonicalize()?);
    if p.starts_with(&d) { Ok(p) } else { Err(Error::Bundle(format!("the pipeline wrote to {}, not inside {}", path.display(), dir.display()))) }
}

/// Stop a CLI process and everything it started (its process group on Unix, its tree on Windows). Its exit then ends
/// `run_to_end`, which reports it.
pub fn stop_process(pid: u32) -> Result<()> {
    let status = if cfg!(windows) {
        Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).status()?
    } else {
        Command::new("kill").args(["-TERM", "--", &format!("-{pid}")]).status()?   // the group the CLI leads
    };
    if status.success() { Ok(()) } else { Err(Error::Bundle(format!("could not stop the pipeline process {pid}"))) }
}

/// What the user agreed may leave this machine: node id -> the kinds of data it sends and where to (what the plan on
/// screen showed for the features they turned on).
pub type Uploads = std::collections::BTreeMap<String, Agreed>;

#[derive(Debug, Default, Clone, serde::Deserialize, PartialEq)]
pub struct Agreed {
    pub kinds: Vec<String>,
    /// where it sends them: the hosted API (the plan's `service`) or the other machine it runs on (`upload_to`), or none
    pub service: Option<String>,
}

/// The app's own check, against a fresh plan of what is about to run, that nothing leaves this machine beyond what the
/// user agreed to: a node that sends a kind of data not agreed for it, or sends anything to a place not agreed for it
/// (a node on another machine always sends its inputs there, even holding none of the kinds), is refused. Every node
/// counts, cached ones too (a cache can be gone by the time the run starts), and a plan that does not say what a node
/// sends (a CLI from before plans carried `uploads`) is refused.
pub fn upload_gate(plan: &Value, allowed: &Uploads) -> Result<()> {
    let nodes = plan["nodes"].as_array().ok_or_else(|| Error::Bundle("the pipeline's plan lists no nodes; nothing could be checked".into()))?;
    for n in nodes {
        let id = n["id"].as_str().unwrap_or("?");
        let Some(uploads) = n["uploads"].as_array() else {
            return Err(Error::Bundle(format!("the pipeline does not say what {id} sends off this machine; update hyperstudy-perception")));
        };
        let agreed = allowed.get(id).map(|a| a.kinds.as_slice()).unwrap_or_default();
        // an entry that is not a kind's name is not something that was agreed to: the plan is refused, not read around
        let kinds = uploads.iter().map(|u| u.as_str()).collect::<Option<Vec<&str>>>()
            .ok_or_else(|| Error::Bundle(format!("the pipeline's plan does not say plainly what {id} sends off this machine")))?;
        let beyond: Vec<&str> = kinds.iter().copied().filter(|k| !agreed.iter().any(|a| a == k)).collect();
        if !beyond.is_empty() {
            return Err(Error::Bundle(format!("{id} would send {} off this machine, which was not agreed to", beyond.join(", "))));
        }
        // where to: `upload_to` (perception #15), else the API's `service` for a node that sends kinds
        let to = match n.get("upload_to") {
            Some(Value::Null) => None,
            Some(Value::String(s)) => Some(s.as_str()),
            Some(_) => return Err(Error::Bundle(format!("the pipeline's plan does not say plainly where {id} sends its data"))),
            None if !kinds.is_empty() => n["service"].as_str(),
            None => None,
        };
        // the same data sent somewhere else is not what was agreed to either
        if (to.is_some() || !kinds.is_empty()) && allowed.get(id).map(|a| a.service.as_deref()) != Some(to) {
            return Err(Error::Bundle(format!("{id} would send its data to {}, which was not agreed to", to.unwrap_or("another place"))));
        }
    }
    Ok(())
}

/// `--max-cost-usd N` for the run's spending cap (the graph's, raised by what a cloud machine costs: the dialog
/// computes it), checked as a plain amount.
pub fn cost_args(cap: Option<f64>) -> Result<Vec<String>> {
    match cap {
        None => Ok(vec![]),
        Some(c) if c.is_finite() && (0.0..10_000.0).contains(&c) => Ok(vec!["--max-cost-usd".into(), format!("{c:.2}")]),
        Some(c) => Err(Error::Bundle(format!("not a spending cap: {c}"))),
    }
}

/// The run in progress: whether there is one, its CLI process, and a cancel asked for before that existed, all under
/// one lock. Whichever comes second, the cancel or the CLI starting (or the run ending), sees the other, so a cancel is
/// never lost and never outlives its run.
#[derive(Default)]
pub struct RunControl(std::sync::Mutex<RunProc>);

#[derive(Default)]
struct RunProc {
    active: bool,
    pid: Option<u32>,
    cancel: bool,
}

/// What a cancel does.
#[derive(Debug, PartialEq)]
pub enum Cancel {
    /// stop this process (the CLI is running)
    Stop(u32),
    /// the CLI has not started: it will not (or is stopped the moment it does)
    WillNotStart,
    /// no run is in progress
    Nothing,
}

impl RunControl {
    fn lock(&self) -> std::sync::MutexGuard<'_, RunProc> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// A run begins (before its consent check).
    pub fn start(&self) {
        *self.lock() = RunProc { active: true, ..RunProc::default() };
    }

    /// Just before spawning the CLI: an error if the run was canceled meanwhile (nothing starts).
    pub fn before_start(&self) -> Result<()> {
        if std::mem::take(&mut self.lock().cancel) {
            return Err(Error::Bundle("the run was canceled before it started".into()));
        }
        Ok(())
    }

    /// The CLI started as `pid`; true when a cancel came first, and the caller stops it.
    pub fn spawned(&self, pid: u32) -> bool {
        let mut p = self.lock();
        p.pid = Some(pid);
        std::mem::take(&mut p.cancel)
    }

    /// A cancel, with no run id yet.
    pub fn cancel(&self) -> Cancel {
        let mut p = self.lock();
        match p.pid {
            Some(pid) => Cancel::Stop(pid),
            None if p.active => {
                p.cancel = true;
                Cancel::WillNotStart
            }
            None => Cancel::Nothing,
        }
    }

    /// The run is over: no process, and no request carried over to the next run.
    pub fn clear(&self) {
        *self.lock() = RunProc::default();
    }
}

/// Runs its closure only if the thread is panicking (a run thread's crash clears the run state; a normal end clears it
/// itself, before its last event).
pub struct OnPanic<F: FnMut()>(pub F);

impl<F: FnMut()> Drop for OnPanic<F> {
    fn drop(&mut self) {
        if std::thread::panicking() {
            (self.0)();
        }
    }
}

/// `--place NODE=PLACE` arguments for where the user chose nodes run. Node ids and places must have the CLI's own form,
/// so nothing else reaches its command line: a node id, never an option (no leading '-'); a place `backend:target`, the
/// target as cloud or SSH places will name theirs (cloud:a100, ssh:lab-gpu.local).
pub fn place_args(places: &std::collections::BTreeMap<String, String>) -> Result<Vec<String>> {
    let starts = |s: &str| s.chars().next().is_some_and(|c| c.is_ascii_alphanumeric());
    let id_ok = |s: &str| starts(s) && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    let backend_ok = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_lowercase());
    let target_ok = |s: &str| starts(s) && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || ".-_".contains(c));
    let mut out = vec![];
    for (node, place) in places {
        let ok = id_ok(node) && place.split_once(':').is_some_and(|(b, t)| backend_ok(b) && target_ok(t));
        if !ok {
            return Err(Error::Bundle(format!("not a node and a place: {node:?} = {place:?}")));
        }
        out.extend(["--place".to_string(), format!("{node}={place}")]);
    }
    Ok(out)
}

/// `--set node.key=value` for the settings the user chose (node -> key -> value). Only the fixed choices a plan offers
/// are chosen in the app (a model name, an effort), so a value is a plain word: letters, digits and `.`, `_`, `-`.
pub fn set_args(settings: &std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>) -> Result<Vec<String>> {
    let starts = |s: &str| s.chars().next().is_some_and(|c| c.is_ascii_alphanumeric());
    let id_ok = |s: &str| starts(s) && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    let key_ok = |s: &str| s.chars().next().is_some_and(|c| c.is_ascii_lowercase()) && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    let value_ok = |s: &str| starts(s) && s.len() <= 100 && s.chars().all(|c| c.is_ascii_alphanumeric() || ".-_".contains(c));
    let mut out = vec![];
    for (node, keys) in settings {
        for (key, value) in keys {
            if !(id_ok(node) && key_ok(key) && value_ok(value)) {
                return Err(Error::Bundle(format!("not a node's setting: {node:?}.{key:?} = {value:?}")));
            }
            out.extend(["--set".to_string(), format!("{node}.{key}={value}")]);
        }
    }
    Ok(out)
}

/// `--only` for the steps the user picked (empty: the whole graph). Node ids only, in the CLI's own form.
pub fn only_args(nodes: &[String]) -> Result<Vec<String>> {
    let ok = |s: &str| s.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if let Some(bad) = nodes.iter().find(|n| !ok(n)) {
        return Err(Error::Bundle(format!("not a node id: {bad:?}")));
    }
    Ok(if nodes.is_empty() { vec![] } else { vec!["--only".to_string(), nodes.join(",")] })
}

/// The problems of an `error` object, as one message.
pub fn problems(v: &Value) -> String {
    v["problems"].as_array().map(|p| p.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join("; ")).unwrap_or_default()
}

#[derive(Debug, Serialize, PartialEq)]
pub struct GraphPreset {
    /// the file name in the pipeline's graphs/ folder
    pub file: String,
    pub pipeline: String,
    /// the graph's leading comment
    pub description: String,
}

#[derive(Debug)]
pub struct Pipeline {
    pub uv: PathBuf,
    pub repo: PathBuf,
    /// the store the CLI uses (PERCEPTION_HOME); None: its default, shared with command-line use
    pub home: Option<PathBuf>,
}

impl Pipeline {
    pub fn new(repo: &Path, uv: PathBuf) -> Result<Self> {
        if !repo.join("orchestrator").join("pyproject.toml").is_file() {
            return Err(Error::Bundle(format!("{} is not a hyperstudy-perception folder (no orchestrator/pyproject.toml)", repo.display())));
        }
        Ok(Pipeline { uv, repo: repo.to_path_buf(), home: None })
    }

    fn command(&self, args: &[&str]) -> Command {
        let orchestrator = self.repo.join("orchestrator");
        let mut c = Command::new(&self.uv);
        #[cfg(unix)]
        {
            // its own process group: stopping it stops what it started too (uv runs Python as a child, which would
            // otherwise live on, holding the output pipes open)
            use std::os::unix::process::CommandExt;
            c.process_group(0);
        }
        c.arg("run").arg("--quiet").arg("--project").arg(&orchestrator).arg("perception").arg("--json").args(args)
            .current_dir(&orchestrator).stdin(Stdio::null());
        if let Some(home) = &self.home {
            c.env("PERCEPTION_HOME", home);
        }
        c
    }

    /// Run a command to the end; its objects, in order. A command that ends in an `error` object is an error.
    pub fn call(&self, args: &[&str]) -> Result<Vec<Value>> {
        let out = self.command(args).stderr(Stdio::piped()).output()?;
        let text = String::from_utf8_lossy(&out.stdout);
        let objects: Vec<Value> = text.lines().filter(|l| !l.trim().is_empty()).map(parse_line).collect::<Result<_>>()?;
        if let Some(err) = objects.iter().find(|o| o["type"] == "error") {
            return Err(Error::Bundle(problems(err)));
        }
        if objects.is_empty() && !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(Error::Bundle(format!("the pipeline failed: {}", stderr.lines().last().unwrap_or("no output"))));
        }
        Ok(objects)
    }

    /// The single object a command prints (doctor, plan, status, exported...), of the expected type.
    pub fn one(&self, args: &[&str], kind: &str) -> Result<Value> {
        self.call(args)?.into_iter().find(|o| o["type"] == kind)
            .ok_or_else(|| Error::Bundle(format!("the pipeline printed no {kind}")))
    }

    /// Run `run` (or `resume`, `rerun`) to its end, calling `on` for each object as it arrives. Returns the run's id
    /// and status, or None when the CLI refused it in its own objects (a plan that cannot run, an error object: `on`
    /// has seen them). A CLI that ends any other way (uv could not sync, a crash) is an error with its last words.
    #[cfg(test)]
    pub fn run_to_end(&self, args: &[&str], on: impl FnMut(&Value)) -> Result<Option<(String, String)>> {
        self.run_to_end_with(args, |_| {}, on)
    }

    /// `run_to_end`, telling `on_spawn` the CLI's process id as soon as it starts (so it can be stopped early).
    pub fn run_to_end_with(&self, args: &[&str], on_spawn: impl FnOnce(u32), mut on: impl FnMut(&Value)) -> Result<Option<(String, String)>> {
        let mut child = self.command(args).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
        on_spawn(child.id());
        let stderr = child.stderr.take().map(|e| std::thread::spawn(move || {   // read apart: a full pipe would block
            let mut tail = std::collections::VecDeque::with_capacity(6);   // only the last lines are kept
            for line in BufReader::new(e).lines().map_while(|l| l.ok()) {
                if tail.len() == 5 { tail.pop_front(); }
                tail.push_back(line);
            }
            Vec::from(tail).join(" | ")
        }));
        let (mut run, mut finished, mut refused) = (None::<String>, None::<String>, false);
        let read = lines(&mut child, |o| {
            match o["type"].as_str() {
                Some("run.created") => run = o["run"].as_str().map(String::from),
                Some("run.finished") => finished = o["status"].as_str().map(String::from),
                Some("error") => refused = true,
                Some("plan") if o["ok"] == false => refused = true,
                _ => {}
            }
            on(&o);
        });
        if read.is_err() {
            let _ = stop_process(child.id());   // no longer read: stopped (with what it started), not left unobserved
        }
        let status = child.wait()?;
        let last_words = stderr.and_then(|h| h.join().ok()).unwrap_or_default();
        read?;
        match (run, finished) {
            (Some(run), Some(finished)) => Ok(Some((run, finished))),
            _ if refused => Ok(None),
            _ => Err(Error::Bundle(format!("the pipeline ended without finishing the run ({status}){}",
                                           if last_words.is_empty() { String::new() } else { format!(": {last_words}") }))),
        }
    }

    /// A graph of the pipeline's graphs/ folder, by file name only: nothing outside that folder can be named.
    pub fn graph(&self, file: &str) -> Result<PathBuf> {
        // one plain file name: no separators, no `..`, no drive (`C:x.yaml` is relative to a drive on Windows)
        let plain = matches!(Path::new(file).components().collect::<Vec<_>>()[..], [std::path::Component::Normal(_)]);
        let ok = plain && file.ends_with(".yaml") && !file.contains(['/', '\\', ':']) && !file.starts_with('.');
        let path = self.repo.join("graphs").join(file);
        if !ok || !path.is_file() {
            return Err(Error::NotFound(format!("the pipeline has no graph {file:?}")));
        }
        Ok(path)
    }

    /// The graphs a user can run, with the comment each starts with.
    pub fn graphs(&self) -> Result<Vec<GraphPreset>> {
        let mut out = vec![];
        for entry in std::fs::read_dir(self.repo.join("graphs"))? {
            let path = entry?.path();
            if path.extension().and_then(|e| e.to_str()) != Some("yaml") {
                continue;
            }
            let text = std::fs::read_to_string(&path)?;
            let description = text.lines().take_while(|l| l.starts_with('#')).map(|l| l.trim_start_matches('#').trim())
                .filter(|l| !l.is_empty()).collect::<Vec<_>>().join(" ");
            let pipeline = text.lines().find_map(|l| l.strip_prefix("pipeline:")).map(|p| p.trim().to_string()).unwrap_or_default();
            out.push(GraphPreset { file: path.file_name().unwrap().to_string_lossy().into_owned(), pipeline, description });
        }
        out.sort_by(|a, b| a.file.cmp(&b.file));
        Ok(out)
    }
}

/// Read a running command's objects as they arrive, calling `on` for each; ends when the command closes its output.
pub fn lines(child: &mut Child, mut on: impl FnMut(Value)) -> Result<()> {
    let stdout = child.stdout.take().ok_or_else(|| Error::Bundle("the pipeline's output was not captured".into()))?;
    for line in BufReader::new(stdout).lines() {
        let line = line?;
        if !line.trim().is_empty() {
            on(parse_line(&line)?);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn only_protocol_1_json_lines_are_read() {
        assert_eq!(parse_line(r#"{"v": 1, "type": "plan", "ok": true}"#).unwrap()["ok"], true);
        assert!(parse_line("run 2026 (store /x)").unwrap_err().to_string().contains("not JSON"));
        assert!(parse_line(r#"{"v": 2, "type": "plan"}"#).unwrap_err().to_string().contains("protocol 2"));
        assert!(parse_line(r#"{"type": "plan"}"#).unwrap_err().to_string().contains("without a protocol version"));
    }

    #[test]
    fn the_bundled_uv_is_the_one_beside_the_executable_and_nothing_else() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("hyperstudy-annotator");
        assert!(bundled_uv(&exe).unwrap_err().to_string().contains("fetch-uv.sh"));   // no PATH search, no fallback
        fs::write(dir.path().join("uv"), "").unwrap();
        assert_eq!(bundled_uv(&exe).unwrap(), dir.path().join("uv"));
    }

    /// The uv scripts/fetch-uv.sh put in src-tauri/binaries for this machine, if it has run.
    fn fetched_uv() -> Option<PathBuf> {
        fs::read_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries")).ok()?
            .filter_map(|e| e.ok().map(|e| e.path())).find(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("uv-")))
    }

    fn repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("orchestrator")).unwrap();
        fs::write(dir.path().join("orchestrator/pyproject.toml"), "").unwrap();
        fs::create_dir_all(dir.path().join("graphs")).unwrap();
        fs::write(dir.path().join("graphs/faces.yaml"), "# Decode and face tracks.\n#   perception run ...\nschema_version: 1\npipeline: perception-faces\n").unwrap();
        fs::write(dir.path().join("graphs/notes.txt"), "not a graph").unwrap();
        dir
    }

    #[test]
    fn graphs_are_listed_with_their_comment_and_only_named_inside_the_graphs_folder() {
        let dir = repo();
        let p = Pipeline::new(dir.path(), PathBuf::from("/bin/uv")).unwrap();
        assert_eq!(p.graphs().unwrap(), vec![GraphPreset { file: "faces.yaml".into(), pipeline: "perception-faces".into(),
                                                           description: "Decode and face tracks. perception run ...".into() }]);
        assert!(p.graph("faces.yaml").is_ok());
        for bad in ["../faces.yaml", "/etc/passwd", "sub/faces.yaml", "notes.txt", ".hidden.yaml", "missing.yaml", "C:faces.yaml", "C:\\faces.yaml"] {
            assert!(p.graph(bad).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn a_folder_that_is_not_the_pipeline_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        assert!(Pipeline::new(dir.path(), PathBuf::from("/bin/uv")).unwrap_err().to_string().contains("not a hyperstudy-perception folder"));
    }

    #[test]
    fn only_a_run_id_in_the_clis_own_form_is_used_in_a_path() {
        assert!(run_id("20261024-095828-1ad462").is_ok());
        for bad in ["..", "../library", "/", "20261024-095828-1ad462/..", "", "20261024-095828-1AD462", "x"] {
            assert!(run_id(bad).is_err(), "{bad:?} should be refused");
        }
    }

    #[test]
    fn the_pipeline_folder_cannot_be_inside_the_apps_own_data() {
        let data = tempfile::tempdir().unwrap();
        let inside = data.path().join("bundles").join("some-bundle");
        fs::create_dir_all(&inside).unwrap();
        assert!(check_folder(&inside, data.path()).unwrap_err().to_string().contains("inside the app's own data"));
        let elsewhere = tempfile::tempdir().unwrap();
        assert!(check_folder(elsewhere.path(), data.path()).is_ok());
    }

    #[test]
    fn a_run_can_be_stopped_by_its_process_before_it_has_an_id() {
        let dir = repo();
        let script = dir.path().join("slow-uv");
        fs::write(&script, "#!/bin/sh\nsleep 30\n").unwrap();   // a first environment sync that does not end
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        let p = Pipeline::new(dir.path(), script).unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let started = std::time::Instant::now();
        let run = std::thread::spawn(move || p.run_to_end_with(&["run"], |pid| tx.send(pid).unwrap(), |_| {}));
        stop_process(rx.recv().unwrap()).unwrap();
        let err = run.join().unwrap().unwrap_err().to_string();
        assert!(err.contains("ended without finishing the run"), "{err}");
        assert!(started.elapsed() < std::time::Duration::from_secs(10));
    }

    #[test]
    fn an_export_must_be_inside_the_folder_it_was_asked_for() {
        let out = tempfile::tempdir().unwrap();
        fs::create_dir_all(out.path().join("bundle")).unwrap();
        assert!(inside(&out.path().join("bundle"), out.path()).is_ok());
        let elsewhere = tempfile::tempdir().unwrap();
        assert!(inside(elsewhere.path(), out.path()).is_err());
    }

    #[test]
    fn a_run_is_refused_when_data_would_leave_beyond_what_was_agreed_or_the_plan_does_not_say() {
        let plan = |uploads: Value| serde_json::json!({"v": 1, "type": "plan", "ok": true, "nodes": [
            {"id": "decode", "cached": false, "uploads": []},
            {"id": "captions", "cached": true, "uploads": uploads}]});
        let agreed = |pairs: &[(&str, &[&str])]| -> Uploads {
            pairs.iter().map(|(n, ks)| (n.to_string(), Agreed { kinds: ks.iter().map(|k| k.to_string()).collect(), service: None })).collect()
        };
        assert!(upload_gate(&plan(serde_json::json!(["frames"])), &agreed(&[("captions", &["frames"])])).is_ok());
        // a cached node can still run (its cache can be gone by then): it needs the agreement too
        assert!(upload_gate(&plan(serde_json::json!(["frames"])), &agreed(&[])).unwrap_err().to_string().contains("captions would send frames"));
        // agreeing to frames is not agreeing to the transcript, nor is agreeing for another node
        assert!(upload_gate(&plan(serde_json::json!(["frames", "transcript"])), &agreed(&[("captions", &["frames"])])).unwrap_err().to_string().contains("send transcript"));
        assert!(upload_gate(&plan(serde_json::json!(["frames"])), &agreed(&[("decode", &["frames"])])).is_err());
        assert!(upload_gate(&plan(serde_json::json!([])), &agreed(&[])).is_ok());
        // the same kinds sent to another service than agreed are refused
        let to = |service: Option<&str>| serde_json::json!({"v": 1, "type": "plan", "ok": true, "nodes": [
            {"id": "captions", "cached": false, "uploads": ["frames"], "service": service}]});
        let agreed_to = |service: Option<&str>| -> Uploads {
            [("captions".to_string(), Agreed { kinds: vec!["frames".into()], service: service.map(String::from) })].into_iter().collect()
        };
        assert!(upload_gate(&to(Some("Anthropic API")), &agreed_to(Some("Anthropic API"))).is_ok());
        assert!(upload_gate(&to(Some("Other API")), &agreed_to(Some("Anthropic API"))).unwrap_err().to_string().contains("to Other API"));
        assert!(upload_gate(&to(None), &agreed_to(Some("Anthropic API"))).is_err());
        // an entry that is not a kind's name is refused, not skipped (fail closed)
        assert!(upload_gate(&plan(serde_json::json!(["frames", 1])), &agreed(&[("captions", &["frames"])])).unwrap_err().to_string().contains("plainly"));
        assert!(upload_gate(&plan(serde_json::json!([{"kind": "video"}])), &agreed(&[])).is_err());
        let older = serde_json::json!({"v": 1, "type": "plan", "ok": true, "nodes": [{"id": "captions", "cached": false}]});
        assert!(upload_gate(&older, &agreed(&[("captions", &["frames"])])).unwrap_err().to_string().contains("does not say what captions sends"));
        let empty = serde_json::json!({"v": 1, "type": "plan", "ok": true});   // no node list: nothing was checked
        assert!(upload_gate(&empty, &agreed(&[])).unwrap_err().to_string().contains("no nodes"));
    }

    #[test]
    fn a_node_on_another_machine_needs_that_machine_agreed_to_even_when_its_inputs_hold_no_kinds() {
        let on = |to: Value, kinds: Value| serde_json::json!({"v": 1, "type": "plan", "ok": true, "nodes": [
            {"id": "faces", "cached": false, "uploads": kinds, "upload_to": to, "service": null}]});
        let agreed_to = |to: &str, kinds: &[&str]| -> Uploads {
            [("faces".to_string(), Agreed { kinds: kinds.iter().map(|k| k.to_string()).collect(), service: Some(to.into()) })].into_iter().collect()
        };
        assert!(upload_gate(&on(serde_json::json!("lab (SSH)"), serde_json::json!([])), &Uploads::new()).unwrap_err().to_string().contains("to lab (SSH)"));
        assert!(upload_gate(&on(serde_json::json!("lab (SSH)"), serde_json::json!([])), &agreed_to("lab (SSH)", &[])).is_ok());
        assert!(upload_gate(&on(serde_json::json!("lab (SSH)"), serde_json::json!(["video"])), &agreed_to("lab (SSH)", &["video"])).is_ok());
        // another machine than the one agreed to, or more than was agreed, is refused
        assert!(upload_gate(&on(serde_json::json!("gpu2 (SSH)"), serde_json::json!(["video"])), &agreed_to("lab (SSH)", &["video"])).is_err());
        assert!(upload_gate(&on(serde_json::json!("lab (SSH)"), serde_json::json!(["video", "audio"])), &agreed_to("lab (SSH)", &["video"])).is_err());
        // nothing leaves: no agreement needed; an answer that is not a place is refused (fail closed)
        assert!(upload_gate(&on(Value::Null, serde_json::json!([])), &Uploads::new()).is_ok());
        assert!(upload_gate(&on(serde_json::json!({"host": "lab"}), serde_json::json!([])), &agreed_to("lab (SSH)", &[])).unwrap_err().to_string().contains("plainly"));
    }

    #[test]
    fn the_spending_cap_is_a_plain_amount() {
        assert_eq!(cost_args(None).unwrap(), Vec::<String>::new());
        assert_eq!(cost_args(Some(0.989)).unwrap(), vec!["--max-cost-usd", "0.99"]);
        for bad in [f64::NAN, f64::INFINITY, -1.0, 1e6] {
            assert!(cost_args(Some(bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_cli_that_prints_something_else_is_stopped_not_left_running_unobserved() {
        let dir = repo();
        let script = dir.path().join("chatty-uv");
        fs::write(&script, "#!/bin/sh\necho 'Resolved 12 packages in 3ms'\nsleep 30\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        let p = Pipeline::new(dir.path(), script).unwrap();
        let started = std::time::Instant::now();
        let mut pid = 0;
        let err = p.run_to_end_with(&["run"], |id| pid = id, |_| {}).unwrap_err().to_string();
        assert!(err.contains("not JSON"), "{err}");
        assert!(started.elapsed() < std::time::Duration::from_secs(10), "it waited for the CLI instead of stopping it");
        let alive = Command::new("kill").args(["-0", &pid.to_string()]).status().unwrap().success();
        assert!(!alive, "the CLI is still running");
    }

    #[test]
    fn a_cancel_is_never_lost_whichever_comes_first_the_cancel_or_the_cli_starting() {
        // cancel before the CLI exists: the run must not start, and if it already spawned, it is stopped at once
        let c = RunControl::default();
        c.start();
        assert_eq!(c.cancel(), Cancel::WillNotStart);
        assert!(c.before_start().is_err(), "checked before spawning: it does not start");
        let c = RunControl::default();
        c.start();
        assert_eq!(c.cancel(), Cancel::WillNotStart);
        assert!(c.spawned(42), "spawned after the cancel: the caller stops it");
        // the CLI started first: cancel stops that process
        let c = RunControl::default();
        c.start();
        assert!(!c.spawned(42));
        assert_eq!(c.cancel(), Cancel::Stop(42));
    }

    #[test]
    fn a_cancel_that_races_the_end_of_a_run_does_not_refuse_the_next_one() {
        let c = RunControl::default();
        c.start();
        c.clear();                                   // the run ended
        assert_eq!(c.cancel(), Cancel::Nothing);     // the late cancel finds nothing, and sets nothing
        c.start();
        assert!(c.before_start().is_ok(), "the next run starts");
        c.cancel();
        c.clear();
        c.start();
        assert!(c.before_start().is_ok(), "a request does not carry over");
    }

    #[test]
    fn the_crash_guard_runs_only_when_the_thread_panics() {
        let ran = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = ran.clone();
        std::thread::spawn(move || { let _g = OnPanic(move || flag.store(true, std::sync::atomic::Ordering::SeqCst)); }).join().unwrap();
        assert!(!ran.load(std::sync::atomic::Ordering::SeqCst), "a normal end clears nothing");
        let flag = ran.clone();
        let _ = std::thread::spawn(move || { let _g = OnPanic(move || flag.store(true, std::sync::atomic::Ordering::SeqCst)); panic!("boom"); }).join();
        assert!(ran.load(std::sync::atomic::Ordering::SeqCst), "a panic clears the run state");
    }

    #[test]
    fn places_become_place_arguments_and_only_in_their_own_form() {
        let mut places = std::collections::BTreeMap::new();
        places.insert("faces".to_string(), "native:cpu".to_string());
        assert_eq!(place_args(&places).unwrap(), vec!["--place".to_string(), "faces=native:cpu".to_string()]);
        let mut later = std::collections::BTreeMap::new();   // the places cloud and SSH backends will offer
        later.insert("faces".to_string(), "cloud:a100".to_string());
        later.insert("asr".to_string(), "ssh:lab-gpu.local".to_string());
        assert!(place_args(&later).is_ok());
        for (node, place) in [("faces", "native:cpu --allow-downloads"), ("../x", "native:cpu"), ("faces", "NATIVE:CPU"), ("faces", "native"),
                              ("--allow-downloads", "native:cpu"), ("-x", "native:cpu")] {
            let mut bad = std::collections::BTreeMap::new();
            bad.insert(node.to_string(), place.to_string());
            assert!(place_args(&bad).is_err(), "{node}={place}");
        }
    }

    #[test]
    fn settings_become_set_arguments_only_as_plain_words() {
        let one = |node: &str, key: &str, value: &str| {
            let mut m = std::collections::BTreeMap::new();
            m.insert(node.to_string(), std::collections::BTreeMap::from([(key.to_string(), value.to_string())]));
            m
        };
        assert_eq!(set_args(&one("captions", "model", "claude-opus-5-5")).unwrap(), vec!["--set".to_string(), "captions.model=claude-opus-5-5".to_string()]);
        for (node, key, value) in [("captions", "model", "x --allow-uploads"), ("captions", "model", "-x"), ("captions", "model", ""),
                                   ("captions", "Model", "a"), ("captions", "model.x", "a"), ("../x", "model", "a"), ("captions", "model", "{a: b}")] {
            assert!(set_args(&one(node, key, value)).is_err(), "{node}.{key}={value}");
        }
    }

    #[test]
    fn only_arguments_name_nodes_and_nothing_else() {
        assert_eq!(only_args(&["decode".into(), "asr".into()]).unwrap(), vec!["--only".to_string(), "decode,asr".to_string()]);
        assert!(only_args(&[]).unwrap().is_empty());
        for bad in ["--allow-downloads", "a,b", "../x", ""] {
            assert!(only_args(&[bad.to_string()]).is_err(), "{bad}");
        }
    }

    /// A stand-in for uv that prints what the CLI would and ends as told (it ignores the arguments).
    fn fake_uv(dir: &Path, stdout: &str, stderr: &str, code: i32) -> PathBuf {
        let path = dir.join("fake-uv");
        fs::write(&path, format!("#!/bin/sh\ncat <<'EOF'\n{stdout}\nEOF\necho '{stderr}' >&2\nexit {code}\n")).unwrap();
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[test]
    fn a_run_that_ends_without_finishing_is_an_error_that_says_why() {
        let dir = repo();
        let created = r#"{"v": 1, "type": "run.created", "run": "r1", "store": "/s"}"#;
        let p = Pipeline::new(dir.path(), fake_uv(dir.path(), created, "error: uv could not sync the environment", 1)).unwrap();
        let mut seen = 0;
        let err = p.run_to_end(&["run", "g.yaml"], |_| seen += 1).unwrap_err().to_string();
        assert!(err.contains("ended without finishing the run") && err.contains("uv could not sync"), "{err}");
        assert_eq!(seen, 1);
    }

    #[test]
    fn a_run_reports_its_id_and_status_and_one_the_cli_refused_says_so_in_its_own_objects() {
        let dir = repo();
        let finished = "{\"v\": 1, \"type\": \"run.created\", \"run\": \"r1\", \"store\": \"/s\"}\n{\"v\": 1, \"type\": \"run.finished\", \"run\": \"r1\", \"status\": \"succeeded\"}";
        let p = Pipeline::new(dir.path(), fake_uv(dir.path(), finished, "", 0)).unwrap();
        assert_eq!(p.run_to_end(&["run"], |_| {}).unwrap(), Some(("r1".into(), "succeeded".into())));
        let refused = r#"{"v": 1, "type": "plan", "ok": false, "nodes": [], "estimated_usd": 0}"#;   // printed, then exit 1
        let p = Pipeline::new(dir.path(), fake_uv(dir.path(), refused, "", 1)).unwrap();
        assert_eq!(p.run_to_end(&["run"], |_| {}).unwrap(), None);
    }

    /// The real CLI end to end, through the uv the app bundles: a synthetic clip decoded, exported and imported into a
    /// library. Needs the pipeline folder (PERCEPTION_REPO), the fetched uv and ffmpeg; skipped without them.
    #[test]
    fn a_run_streams_events_then_exports_a_bundle_the_library_imports() {
        let Some(repo) = std::env::var_os("PERCEPTION_REPO").map(PathBuf::from) else { return eprintln!("skipped: set PERCEPTION_REPO") };
        let work = tempfile::tempdir().unwrap();
        let video = work.path().join("clip.mp4");
        let made = Command::new("ffmpeg").args(["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=4",
                                                "-f", "lavfi", "-i", "sine=duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"])
            .arg(&video).status();
        if !made.map(|s| s.success()).unwrap_or(false) {
            return eprintln!("skipped: ffmpeg could not make a clip");
        }
        let Some(uv) = fetched_uv() else { return eprintln!("skipped: run scripts/fetch-uv.sh") };
        let mut p = Pipeline::new(&repo, uv).unwrap();
        p.home = Some(work.path().join("home"));
        let doctor = p.one(&["doctor"], "doctor").unwrap();
        assert!(doctor["nodes"].as_array().unwrap().iter().any(|n| n["ref"] == "core.decode@1.0.0"));

        let graph = p.graph("decode.yaml").unwrap();
        let input = format!("video={}", video.display());
        let plan = p.one(&["plan", graph.to_str().unwrap(), "--input", &input], "plan").unwrap();
        assert_eq!(plan["ok"], true);

        let mut seen = vec![];
        let (run, status) = p.run_to_end(&["run", graph.to_str().unwrap(), "--input", &input], |o| seen.push(o.clone())).unwrap().unwrap();
        assert_eq!(seen[0]["type"], "run.created");
        assert_eq!(status, "succeeded");
        assert_eq!(seen.last().unwrap()["type"], "run.finished");
        let run = run.as_str();
        eprintln!("run {run}: {} objects, ended {status}", seen.len());
        let out = work.path().join("export");
        let exported = p.one(&["export", run, "--output", out.to_str().unwrap()], "exported").unwrap();
        let bundle_dir = PathBuf::from(exported["path"].as_str().unwrap());
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        let data = work.path().join("data");
        let (id, manifest, dst) = crate::library::prepare_import(&bundle_dir, &data).unwrap();
        let summary = crate::library::record_import(&conn, &bundle_dir, &id, &manifest, &dst).unwrap();
        assert!(summary.layers.contains_key("shots"));
        crate::library::check_video(&summary.video_sha256, &video).unwrap();   // the bundle names the clip it was made from
    }
}
