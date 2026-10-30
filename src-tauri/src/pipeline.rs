//! Running the perception pipeline from the app: the `perception` CLI of hyperstudy-perception, read through its
//! `--json` output (one versioned JSON object per line; docs/cli-json.md in that repository).
//!
//! The app runs the uv it bundles (scripts/fetch-uv.sh, tauri.conf.json bundle.externalBin), never one found on the
//! machine. With it, the app installs the pipeline from PyPI (`install_tool`) and upgrades it on each start to the
//! newest version it can read (COMPATIBLE); uv fetches the Python it runs on and every step's packages into the app's
//! own folders, so a Mac needs nothing installed (no Python, ffmpeg or developer tools). PERCEPTION_REPO, set when
//! starting the app, runs a checkout instead (pipeline development).
//! Plain functions over paths and processes, so they can be tested without a running app; `commands.rs` wraps them.
use crate::error::{Error, Result};
use serde::Serialize;
use serde_json::Value;
use std::ffi::{OsStr, OsString};
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

/// The pipeline versions this app reads: the newest is installed. Before 1.0 a minor version may change the `--json`
/// protocol or the bundle format, a patch version may not (hyperstudy-perception's RELEASING.md).
pub const COMPATIBLE: &str = "hyperstudy-perception>=0.1,<0.2";

/// Where uv keeps what it fetches for the app: the Python it runs (it never uses another, Homebrew's or the system's),
/// its cache of packages, and the pipeline it installs (`tools`, with its `perception` command in `bin`).
#[derive(Debug, Clone)]
pub struct UvDirs {
    pub python: PathBuf,
    pub cache: PathBuf,
    pub tools: PathBuf,
    pub bin: PathBuf,
}

impl UvDirs {
    /// The installed pipeline's command.
    pub fn perception(&self) -> PathBuf {
        self.bin.join(if cfg!(windows) { "perception.exe" } else { "perception" })
    }
}

/// What uv and the CLI it starts are given: the app's uv first on PATH (the CLI and its steps find uv by PATH, `uv run`
/// for each step's environment), then `path`; and with `dirs`, only uv's own Python, in the app's folders, and not the
/// user's uv.toml.
fn uv_env(c: &mut Command, uv: &Path, path: &OsStr, dirs: Option<&UvDirs>) {
    let uv_dir = uv.parent().map(Path::to_path_buf).unwrap_or_default();
    c.env("PATH", std::env::join_paths(std::iter::once(uv_dir).chain(std::env::split_paths(path))).unwrap_or_else(|_| path.to_owned()));
    if let Some(d) = dirs {
        c.env("UV_PYTHON_PREFERENCE", "only-managed").env("UV_PYTHON_INSTALL_DIR", &d.python).env("UV_CACHE_DIR", &d.cache)
            .env("UV_TOOL_DIR", &d.tools).env("UV_TOOL_BIN_DIR", &d.bin).env("UV_NO_CONFIG", "1");
    }
}

/// Install the pipeline (`spec`: COMPATIBLE, or a wheel's path in tests) into the app's folders, or upgrade it to the
/// newest version `spec` allows, on Python 3.12, which uv fetches the first time. Returns its `perception` command.
pub fn install_tool(uv: &Path, path: &OsStr, dirs: &UvDirs, spec: &str) -> Result<PathBuf> {
    let mut c = Command::new(uv);
    c.args(["tool", "install", "--upgrade", "--quiet", "--python", "3.12", spec]).stdin(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        c.process_group(0);   // its own, as the CLI's: quitting the app stops uv and the Python it runs (`Procs`)
    }
    uv_env(&mut c, uv, path, Some(dirs));
    let child = c.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    let _live = PROCS.live(&child);
    let out = child.wait_with_output()?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let last: Vec<&str> = stderr.lines().filter(|l| !l.trim().is_empty()).collect();
        return Err(Error::Bundle(format!("uv could not install the pipeline: {}", last[last.len().saturating_sub(3)..].join(" | "))));
    }
    let perception = dirs.perception();
    if !perception.is_file() {
        return Err(Error::Bundle(format!("uv installed the pipeline but {} is missing", perception.display())));
    }
    Ok(perception)
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

/// The commands the app has started and not yet seen end (the CLI's, and uv installing it), each by the process group
/// it leads: what quitting the app stops (`stop_all`). Without it they outlived the app: a setup went on with no app
/// to report to, and from a mounted DMG the bundled uv it ran kept the disk image from ejecting. The app keeps one
/// (`PROCS`); a test gives its pipeline its own, so stopping them stops no other test's.
#[derive(Debug, Default)]
pub struct Procs {
    state: std::sync::Mutex<Kept>,
    /// told each time a command ends (`Live` dropped)
    ended: std::sync::Condvar,
}

#[derive(Debug, Default)]
struct Kept {
    live: std::collections::BTreeSet<u32>,
    /// the app is quitting: a command kept from now on is stopped at once
    closed: bool,
}

pub static PROCS: Procs = Procs {
    state: std::sync::Mutex::new(Kept { live: std::collections::BTreeSet::new(), closed: false }),
    ended: std::sync::Condvar::new(),
};

/// A started command, in its `Procs` until this is dropped: after its `wait`, so a group that has ended is not
/// stopped (its id may be another's by then).
struct Live<'a>(&'a Procs, u32);

impl Drop for Live<'_> {
    fn drop(&mut self) {
        self.0.lock().live.remove(&self.1);
        self.0.ended.notify_all();
    }
}

impl Procs {
    fn lock(&self) -> std::sync::MutexGuard<'_, Kept> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Keep `child` while it runs. Once the app is quitting, it is stopped as it is kept: the thread that started it
    /// goes on after its last command was stopped (an upgrade stopped while one is installed goes on to `doctor`; a run
    /// that ended goes on to `export`), and a command started then, or started before `stop_all` but kept after, would
    /// otherwise outlive the app.
    fn live(&self, child: &Child) -> Live<'_> {
        let mut kept = self.lock();
        kept.live.insert(child.id());
        if kept.closed {
            let _ = stop_process(child.id());
        }
        Live(self, child.id())
    }

    /// Wait up to `limit` for the command `pid` to end by itself; whether it did.
    pub fn wait_for(&self, pid: u32, limit: std::time::Duration) -> bool {
        let kept = self.lock();
        let (kept, _) = self.ended.wait_timeout_while(kept, limit, |k| k.live.contains(&pid)).unwrap_or_else(|e| e.into_inner());
        !kept.live.contains(&pid)
    }

    /// The app is quitting: stop every command still running, with what it started (TERM to its group, as
    /// `stop_process`), and kill a group still there after `grace`. Returns the groups that had to be killed. Closed
    /// first, so one started from here on is stopped too (`live`). A run is canceled before (`stop_for_quit`): its
    /// nodes and cloud drivers are in sessions of their own, out of reach.
    pub fn stop_all(&self, grace: std::time::Duration) -> Vec<u32> {
        let deadline = std::time::Instant::now() + grace;
        let mut stopped = std::collections::BTreeSet::new();
        let mut kept = self.lock();
        kept.closed = true;
        loop {
            for &g in &kept.live {
                if stopped.insert(g) {
                    let _ = stop_process(g);
                }
            }
            // done when every command has ended and nothing is left of its group (what it started, too)
            if kept.live.is_empty() && !stopped.iter().any(|&g| group_alive(g)) {
                return vec![];
            }
            let now = std::time::Instant::now();
            if now >= deadline {
                break;
            }
            // a poll, woken early when a command ends: what it started is not the app's child, to wait on
            kept = self.ended.wait_timeout(kept, (deadline - now).min(std::time::Duration::from_millis(50)))
                .unwrap_or_else(|e| e.into_inner()).0;
        }
        let left: Vec<u32> = stopped.into_iter().filter(|&g| group_alive(g)).collect();
        for &g in &left {
            let _ = Command::new("kill").args(["-KILL", "--", &format!("-{g}")]).status();
        }
        left
    }
}

/// Whether any process of the group `g` is still running (on Windows, `stop_process` already ended the whole tree,
/// forcibly).
fn group_alive(g: u32) -> bool {
    cfg!(unix) && running(|_, pgid| pgid == g)
}

/// Whether a process that `which(pid, pgid)` picks is running. A zombie is not: it has ended and waits only to be
/// reaped, and one whose parent was killed with it waits for the system to reap it, in its own time (`kill -0`, which
/// succeeds on a zombie, held quitting for the whole grace and took a group TERM had ended for one it had to kill).
fn running(which: impl Fn(u32, u32) -> bool) -> bool {
    let Ok(out) = Command::new("ps").args(["-A", "-o", "pid=,pgid=,stat="]).stderr(Stdio::null()).output() else { return false };
    String::from_utf8_lossy(&out.stdout).lines().any(|l| {
        let mut f = l.split_whitespace();
        match (f.next().and_then(|x| x.parse().ok()), f.next().and_then(|x| x.parse().ok()), f.next()) {
            (Some(pid), Some(pgid), Some(stat)) => which(pid, pgid) && !stat.starts_with('Z'),
            _ => false,
        }
    })
}

/// The app is quitting (`commands::stop_on_exit`): a run in progress is canceled as Cancel does, then every command the
/// app started is stopped. A named run through `perception cancel` (`p`), which records it canceled, then stops its
/// nodes and cloud drivers (in sessions of their own, out of reach of the CLI's group; a driver deletes its machine), so
/// nothing is taken for a crash and retried. Then its CLI is left `grace` to end by itself: it stops, on its next tick,
/// a node it was starting as the cancel came, which the cancel could not see; stopped at once, that node would live on.
/// A run not named yet has started no node: stopping its CLI is its cancel. Returns the groups that had to be killed.
pub fn stop_for_quit(p: Option<&Pipeline>, named: Option<&str>, control: &RunControl, procs: &Procs,
                     grace: std::time::Duration) -> Vec<u32> {
    match named {
        Some(run) => {
            let canceled = match p.map(|p| p.one(&["cancel", run], "canceled")) {
                Some(Ok(_)) => true,
                // nothing else to do while quitting: said where the app's output goes, as a run left to its nodes
                Some(Err(e)) => { eprintln!("quitting: could not cancel run {run} ({e}); its nodes may go on"); false }
                None => { eprintln!("quitting: no pipeline to cancel run {run} with; its nodes may go on"); false }
            };
            if let (true, Some(cli)) = (canceled, control.pid()) {
                procs.wait_for(cli, grace);   // not ended by then (or the cancel failed): stopped with the rest
            }
        }
        None => {
            if let Cancel::Stop(cli) = control.cancel() {
                let _ = stop_process(cli);
            }
        }
    }
    procs.stop_all(grace)
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
            // kinds that leave for nowhere: a plan that contradicts itself is refused, not read as sending nothing
            Some(Value::Null) if !kinds.is_empty() => return Err(Error::Bundle(format!("the pipeline's plan does not say plainly where {id} sends its data"))),
            Some(Value::Null) => None,
            Some(Value::String(s)) => Some(s.as_str()),
            Some(_) => return Err(Error::Bundle(format!("the pipeline's plan does not say plainly where {id} sends its data"))),
            None if !kinds.is_empty() => n["service"].as_str(),
            None => None,
        };
        // a node on another machine (as the plan's `places` say, perception #15) sends its inputs there: the plan must
        // say where, plainly
        if here(plan, n) == Some(false) && to.is_none() {
            return Err(Error::Bundle(format!("the pipeline's plan does not say plainly where {id} sends its data")));
        }
        // the same data sent somewhere else is not what was agreed to either
        if (to.is_some() || !kinds.is_empty()) && allowed.get(id).map(|a| a.service.as_deref()) != Some(to) {
            return Err(Error::Bundle(format!("{id} would send its data to {}, which was not agreed to", to.unwrap_or("another place"))));
        }
    }
    Ok(())
}

/// Whether the plan's node `n` runs on this machine, as the plan's `places` say (perception #15): only a place they say
/// is not remote is (or no place). A place they do not list, or one that is not plainly a place, is not taken to be
/// this machine. None for a plan without `places` (a CLI from before other machines).
fn here(plan: &Value, n: &Value) -> Option<bool> {
    let places = plan.get("places").filter(|p| !p.is_null())?;
    Some(n["place"].as_str().map(|p| places[p]["remote"] == Value::Bool(false)).unwrap_or(n["place"].is_null()))
}

/// The other machines a plan puts nodes on (lab servers, cloud GPUs), by the plan's titles for them, as `upload_gate`
/// reads the plan (`here`). Cached nodes count too: a cache can be gone by the time the run reaches them.
pub fn remote_places(plan: &Value) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for n in plan["nodes"].as_array().into_iter().flatten().filter(|n| here(plan, n) == Some(false)) {
        let title = match n["place"].as_str() {
            Some(p) => plan["places"][p]["title"].as_str().unwrap_or(p),
            None => "another machine",
        };
        if !out.iter().any(|t| t == title) {
            out.push(title.to_string());
        }
    }
    out
}

/// The Mac kept from idle sleep (`awake.rs`) during a run with nodes on other machines (`remote`, from its plan): from
/// when the CLI names the run, before which it has started no node, until this is dropped as the run ends (succeeded,
/// failed, canceled, or its thread crashed).
pub struct AwakeForRun {
    remote: Vec<String>,
    held: Option<crate::awake::Awake>,
}

impl AwakeForRun {
    pub fn new(remote: Vec<String>) -> Self {
        AwakeForRun { remote, held: None }
    }

    /// One of the run's objects, as it arrives.
    pub fn see(&mut self, o: &Value) {
        if o["type"] != "run.created" || self.remote.is_empty() || self.held.is_some() {
            return;
        }
        let run = o["run"].as_str().and_then(|r| run_id(r).ok()).unwrap_or("starting");
        self.held = crate::awake::Awake::hold(&format!("HyperStudy Annotator: run {run} has steps on {}", self.remote.join(", ")));
    }

    #[cfg(test)]
    pub fn held(&self) -> bool {
        self.held.is_some()
    }
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

    /// The run's CLI process, once it has started.
    pub fn pid(&self) -> Option<u32> {
        self.lock().pid
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
/// so nothing else reaches its command line: a node id, never an option (no leading '-'); a place `backend:accelerator`
/// as the plan offers them, the backend one of the pipeline's (native, self, cloud, runpod) or `ssh-NAME` for a lab
/// server added as NAME, which is checked as `hosts add` checks it (host_args): ssh-liquidswords2:cuda.
pub fn place_args(places: &std::collections::BTreeMap<String, String>) -> Result<Vec<String>> {
    let starts = |s: &str| s.chars().next().is_some_and(|c| c.is_ascii_alphanumeric());
    let id_ok = |s: &str| starts(s) && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    let host_ok = |s: &str| (1..=31).contains(&s.len()) && starts(s) && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    let backend_ok = |s: &str| match s.strip_prefix("ssh-") {
        Some(host) => host_ok(host),
        None => ["native", "self", "cloud", "runpod"].contains(&s),
    };
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

/// What a host is reached with over what ~/.ssh/config says for it (`hosts add|probe --user --port --identity`).
#[derive(Debug, Default, Clone, serde::Deserialize)]
pub struct SshOverrides {
    pub user: Option<String>,
    pub port: Option<u16>,
    /// a private key file on this machine
    pub identity: Option<String>,
}

/// An ssh destination that cannot be read as an option: user@host, a host, or a name from ~/.ssh/config.
fn ssh_dest_ok(dest: &str) -> bool {
    dest.starts_with(|c: char| c.is_ascii_alphanumeric() || c == '_')
        && dest.chars().all(|c| c.is_ascii_alphanumeric() || "_.@%+:[]-".contains(c))
}

/// `hosts ACTION` for a lab server, checked as the CLI checks them (hosts.py) before they reach it: a name of lower-case
/// letters, digits and `-` (and not a word the CLI keeps for itself), an ssh destination that cannot be an option, a
/// plain folder, and overrides ssh cannot misread. The positional words follow `--`, so none can be read as a flag.
/// `probe` takes the destination for `name`: it reaches it and says what it has, adding nothing (a connection test).
/// `keys` takes `on` or `off` for `dest`: whether whole runs coordinated there may hold the keys their steps declare.
pub fn host_args(action: &str, name: &str, dest: Option<&str>, root: Option<&str>, ov: &SshOverrides) -> Result<Vec<String>> {
    let name_ok = !name.is_empty() && name.len() <= 31 && name.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !["native", "self", "cloud", "runpod", "local"].contains(&name);
    if !["add", "check", "remove", "clean", "probe", "keys"].contains(&action) {
        return Err(Error::Bundle(format!("not something to do with a host: {action:?}")));
    }
    if action == "probe" && !ssh_dest_ok(name) {
        return Err(Error::Bundle(format!("not an ssh destination: {name:?} (user@host, or a name from ~/.ssh/config)")));
    }
    if action != "probe" && !name_ok {
        return Err(Error::Bundle(format!("not a host's name: {name:?} (lower-case letters, digits and -)")));
    }
    let mut out = vec!["hosts".to_string(), action.to_string()];
    if action == "add" || action == "probe" {
        if let Some(user) = ov.user.as_deref().filter(|u| !u.is_empty()) {
            let ok = user.len() <= 64 && user.starts_with(|c: char| c.is_ascii_alphanumeric() || "._".contains(c))
                && user.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
            if !ok {
                return Err(Error::Bundle(format!("not a user name: {user:?}")));
            }
            out.extend(["--user".to_string(), user.to_string()]);
        }
        if let Some(port) = ov.port {
            if port == 0 {
                return Err(Error::Bundle("not a port: 0".to_string()));
            }
            out.extend(["--port".to_string(), port.to_string()]);
        }
        if let Some(identity) = ov.identity.as_deref().filter(|i| !i.is_empty()) {
            if identity.starts_with('-') || identity.chars().any(|c| c.is_control()) {
                return Err(Error::Bundle(format!("not a plain path: {identity:?}")));
            }
            out.extend(["--identity".to_string(), identity.to_string()]);
        }
    }
    if let Some(root) = root.filter(|r| !r.is_empty()) {
        // as the CLI checks it (hosts.check_names): plain characters, `~` only as a leading `~/`, no `..`, and a folder of
        // its own below / or the home (not `/`, `~` or `.`): `hosts clean` empties it
        let rest = root.strip_prefix("~/").unwrap_or(root);
        let parts: Vec<&str> = rest.split('/').filter(|p| !p.is_empty() && *p != ".").collect();
        let plain = root.chars().all(|c| c.is_ascii_alphanumeric() || "_./~-".contains(c)) && !root.starts_with('-')
            && !rest.contains('~') && !parts.is_empty() && !parts.contains(&"..");
        if !plain {
            return Err(Error::Bundle(format!("not a plain folder: {root:?}")));
        }
        out.extend(["--root".to_string(), root.to_string()]);
    }
    out.extend(["--".to_string(), name.to_string()]);
    if action == "add" {
        let dest = dest.unwrap_or_default();
        if !ssh_dest_ok(dest) {
            return Err(Error::Bundle(format!("not an ssh destination: {dest:?} (user@host, or a name from ~/.ssh/config)")));
        }
        out.push(dest.to_string());
    }
    if action == "keys" {
        let on = dest.filter(|d| ["on", "off"].contains(d)).ok_or_else(|| Error::Bundle(format!("keys on a host: on or off, not {dest:?}")))?;
        out.push(on.to_string());
    }
    Ok(out)
}

/// The keys `perception keys check` can test with their providers (keycheck.py).
pub const CHECKED_KEYS: [&str; 3] = ["ANTHROPIC_API_KEY", "HF_TOKEN", "RUNPOD_API_KEY"];

/// `keys check NAME`: whether the provider accepts the key, by a request that costs nothing.
pub fn key_check_args(name: &str) -> Result<Vec<&'static str>> {
    let known: &'static str = CHECKED_KEYS.iter().copied().find(|k| *k == name).ok_or_else(|| Error::Bundle(format!("no check for {name:?}")))?;
    Ok(vec!["keys", "check", "--", known])
}

/// `cloud check [runpod]`: whether a provider could be used now, changing nothing. AWS is the CLI's default, unnamed.
pub fn cloud_check_args(provider: &str) -> Result<Vec<&'static str>> {
    match provider {
        "aws" => Ok(vec!["cloud", "check"]),
        "runpod" => Ok(vec!["cloud", "check", "runpod"]),
        other => Err(Error::Bundle(format!("not a cloud provider: {other:?}"))),
    }
}

/// The hosts an ssh config names (`Host a b`), without patterns (`*`, `?`, `!`): what the form to add a server offers.
/// Read here only; files it Includes are not followed.
pub fn ssh_config_hosts(text: &str) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for line in text.lines() {
        let line = line.trim();
        let (key, rest) = line.split_once(|c: char| c.is_whitespace() || c == '=').unwrap_or((line, ""));
        if !key.eq_ignore_ascii_case("host") {
            continue;
        }
        for name in rest.trim_start_matches(|c: char| c.is_whitespace() || c == '=').split_whitespace() {
            if !name.contains(['*', '?', '!']) && ssh_dest_ok(name) && !out.iter().any(|n| n == name) {
                out.push(name.to_string());
            }
        }
    }
    out
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

/// The CLI the app runs.
#[derive(Debug, Clone, PartialEq)]
pub enum Source {
    /// the package installed from PyPI: its `perception` command
    Installed(PathBuf),
    /// a checkout of hyperstudy-perception, run with `uv run` (PERCEPTION_REPO)
    Checkout(PathBuf),
}

#[derive(Debug)]
pub struct Pipeline {
    pub uv: PathBuf,
    pub source: Source,
    /// the store the CLI uses (PERCEPTION_HOME); None: its default, shared with command-line use
    pub home: Option<PathBuf>,
    /// the keys the user stored in the app (keys.rs), for the CLI's environment, where it looks first
    pub secrets: crate::keys::Secrets,
    /// the PATH the CLI starts with, after the folder of the app's uv. The app's own: an app started from the Finder
    /// has only /usr/bin:/bin:/usr/sbin:/sbin, so nothing a step needs may come from it.
    pub path: OsString,
    /// None: uv's own defaults, shared with command-line use (tests)
    pub uv_dirs: Option<UvDirs>,
    /// where its commands are kept while they run: the app's `PROCS`, or a test's own
    pub procs: &'static Procs,
}

impl Pipeline {
    fn with(source: Source, uv: PathBuf) -> Self {
        Pipeline { uv, source, home: None, secrets: Default::default(), path: std::env::var_os("PATH").unwrap_or_default(), uv_dirs: None,
                   procs: &PROCS }
    }

    /// The pipeline installed from PyPI (`install_tool`).
    pub fn installed(perception: &Path, uv: PathBuf) -> Result<Self> {
        if !perception.is_file() {
            return Err(Error::NotFound("the pipeline is not installed yet: the app installs it when it starts".into()));
        }
        Ok(Self::with(Source::Installed(perception.to_path_buf()), uv))
    }

    /// A checkout of hyperstudy-perception (PERCEPTION_REPO).
    pub fn checkout(repo: &Path, uv: PathBuf) -> Result<Self> {
        if !repo.join("orchestrator").join("pyproject.toml").is_file() {
            return Err(Error::Bundle(format!("{} is not a hyperstudy-perception folder (no orchestrator/pyproject.toml)", repo.display())));
        }
        Ok(Self::with(Source::Checkout(repo.to_path_buf()), uv))
    }

    fn command(&self, args: &[&str]) -> Command {
        // the folder it runs in holds no graph files: a graph is named, and the CLI takes a file of that name in its
        // folder before its own graph
        let (mut c, dir) = match &self.source {
            Source::Installed(perception) => (Command::new(perception), perception.parent().map(Path::to_path_buf).unwrap_or_default()),
            Source::Checkout(repo) => {
                let orchestrator = repo.join("orchestrator");
                let mut c = Command::new(&self.uv);
                c.arg("run").arg("--quiet").arg("--project").arg(&orchestrator).arg("perception");
                (c, orchestrator)
            }
        };
        #[cfg(unix)]
        {
            // its own process group: stopping it stops what it started too (uv runs Python as a child, which would
            // otherwise live on, holding the output pipes open)
            use std::os::unix::process::CommandExt;
            c.process_group(0);
        }
        c.arg("--json").args(args).current_dir(dir).stdin(Stdio::null());
        uv_env(&mut c, &self.uv, &self.path, self.uv_dirs.as_ref());
        if let Some(home) = &self.home {
            c.env("PERCEPTION_HOME", home);
        }
        c.envs(self.secrets.0.iter().map(|(k, v)| (k, v)));
        c
    }

    /// Run a command to the end; its objects, in order. A command that ends in an `error` object is an error.
    pub fn call(&self, args: &[&str]) -> Result<Vec<Value>> {
        let child = self.command(args).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
        let _live = self.procs.live(&child);
        let out = child.wait_with_output()?;
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
        let _live = self.procs.live(&child);
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

    /// `perception setup`: for each node that can run here, its environment synced from its lock and its weights
    /// fetched, so the first run does not wait for them. `on` gets each step as it ends. Ok when every step succeeded;
    /// else what failed, or how the CLI ended without saying.
    pub fn setup(&self, mut on: impl FnMut(&Value)) -> Result<()> {
        let mut child = self.command(&["setup"]).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
        let _live = self.procs.live(&child);
        let stderr = child.stderr.take().map(|e| std::thread::spawn(move || {   // read apart: a full pipe would block
            BufReader::new(e).lines().map_while(|l| l.ok()).last().unwrap_or_default()
        }));
        let (mut failed, mut ok) = (vec![], None);
        let read = lines(&mut child, |o| {
            match o["type"].as_str() {
                Some("setup.step") if o["ok"] == false => failed.push(format!("{} {}: {}", o["what"].as_str().unwrap_or("step"),
                    o["node"].as_str().unwrap_or("this machine"), o["message"].as_str().unwrap_or(""))),
                Some("setup") => ok = o["ok"].as_bool(),
                _ => {}
            }
            on(&o);
        });
        if read.is_err() {
            let _ = stop_process(child.id());
        }
        let status = child.wait()?;
        let last_words = stderr.and_then(|h| h.join().ok()).unwrap_or_default();
        read?;
        match ok {
            Some(true) => Ok(()),
            Some(false) => Err(Error::Bundle(failed.join("; "))),
            None => Err(Error::Bundle(format!("the pipeline's setup ended without finishing ({status}){}",
                                              if last_words.is_empty() { String::new() } else { format!(": {last_words}") }))),
        }
    }

    /// One of the pipeline's graphs, by its file name, which run and plan take: a plain name only (no folder, `..` or
    /// drive: `C:x.yaml` is relative to a drive on Windows). Whether there is such a graph is the CLI's to say.
    pub fn graph(&self, file: &str) -> Result<String> {
        let plain = matches!(Path::new(file).components().collect::<Vec<_>>()[..], [std::path::Component::Normal(_)]);
        if !(plain && file.ends_with(".yaml") && !file.contains(['/', '\\', ':']) && !file.starts_with('.')) {
            return Err(Error::NotFound(format!("the pipeline has no graph {file:?}")));
        }
        Ok(file.to_string())
    }

    /// The graphs a user can run, with the comment each starts with (`perception graphs`).
    pub fn graphs(&self) -> Result<Vec<GraphPreset>> {
        let v = self.one(&["graphs"], "graphs")?;
        let graphs = v["graphs"].as_array().ok_or_else(|| Error::Bundle("the pipeline listed no graphs".into()))?;
        Ok(graphs.iter().map(|g| GraphPreset {
            file: g["file"].as_str().unwrap_or_default().into(), pipeline: g["pipeline"].as_str().unwrap_or_default().into(),
            description: g["description"].as_str().unwrap_or_default().into(),
        }).collect())
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
    fn graphs_come_from_the_cli_and_only_a_plain_graph_name_reaches_it() {
        let dir = repo();
        let listed = r#"{"v": 1, "type": "graphs", "graphs": [{"file": "faces.yaml", "pipeline": "perception-faces", "description": "Decode and face tracks.", "path": "/x/graphs/faces.yaml"}]}"#;
        let p = Pipeline::checkout(dir.path(), fake_uv(dir.path(), listed, "", 0)).unwrap();
        assert_eq!(p.graphs().unwrap(), vec![GraphPreset { file: "faces.yaml".into(), pipeline: "perception-faces".into(),
                                                           description: "Decode and face tracks.".into() }]);
        assert_eq!(p.graph("faces.yaml").unwrap(), "faces.yaml");
        for bad in ["../faces.yaml", "/etc/passwd", "sub/faces.yaml", "notes.txt", ".hidden.yaml", "C:faces.yaml", "C:\\faces.yaml"] {
            assert!(p.graph(bad).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn a_folder_that_is_not_the_pipeline_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        assert!(Pipeline::checkout(dir.path(), PathBuf::from("/bin/uv")).unwrap_err().to_string().contains("not a hyperstudy-perception folder"));
    }

    #[test]
    fn only_a_run_id_in_the_clis_own_form_is_used_in_a_path() {
        assert!(run_id("20261024-095828-1ad462").is_ok());
        for bad in ["..", "../library", "/", "20261024-095828-1ad462/..", "", "20261024-095828-1AD462", "x"] {
            assert!(run_id(bad).is_err(), "{bad:?} should be refused");
        }
    }

    fn dirs(root: &Path) -> UvDirs {
        UvDirs { python: root.join("python"), cache: root.join("uv-cache"), tools: root.join("tools"), bin: root.join("bin") }
    }

    #[test]
    fn the_pipeline_is_installed_or_upgraded_from_pypi_into_the_apps_folders_on_its_own_python() {
        let dir = tempfile::tempdir().unwrap();
        // a stand-in for uv that records what it was asked and with what, and installs a `perception` where it was told
        let uv = executable(dir.path(), "uv", "#!/bin/sh\necho \"$* | $UV_TOOL_DIR | $UV_TOOL_BIN_DIR | $UV_PYTHON_PREFERENCE | $UV_NO_CONFIG\" > \"$UV_TOOL_DIR.args\"\n\
            mkdir -p \"$UV_TOOL_BIN_DIR\" && touch \"$UV_TOOL_BIN_DIR/perception\"\n");
        let d = dirs(dir.path());
        let perception = install_tool(&uv, OsStr::new("/usr/bin:/bin"), &d, COMPATIBLE).unwrap();
        assert_eq!(perception, d.perception());
        let args = fs::read_to_string(dir.path().join("tools.args")).unwrap();
        assert_eq!(args.trim(), format!("tool install --upgrade --quiet --python 3.12 {COMPATIBLE} | {} | {} | only-managed | 1",
                                        d.tools.display(), d.bin.display()));
        assert!(Pipeline::installed(&perception, uv.clone()).is_ok());
        // uv refusing (no network, no such version) is an error that says why
        let failing = executable(dir.path(), "uv-offline", "#!/bin/sh\necho 'error: Failed to fetch: https://pypi.org/simple/hyperstudy-perception/' >&2\nexit 2\n");
        let err = install_tool(&failing, OsStr::new("/usr/bin:/bin"), &dirs(&dir.path().join("other")), COMPATIBLE).unwrap_err().to_string();
        assert!(err.contains("could not install the pipeline") && err.contains("Failed to fetch"), "{err}");
        assert!(Pipeline::installed(&dirs(&dir.path().join("other")).perception(), uv).unwrap_err().to_string().contains("not installed yet"));
    }

    #[test]
    fn the_cli_finds_the_apps_uv_first_on_its_path_and_uv_keeps_python_and_packages_in_the_apps_folders() {
        let dir = repo();
        let uv = executable(dir.path(), "uv", "#!/bin/sh
printf '{\"v\": 1, \"type\": \"doctor\", \"path\": \"%s\", \"pref\": \"%s\", \"python\": \"%s\", \"cache\": \"%s\", \"noconfig\": \"%s\"}\\n' \
            \"$PATH\" \"$UV_PYTHON_PREFERENCE\" \"$UV_PYTHON_INSTALL_DIR\" \"$UV_CACHE_DIR\" \"$UV_NO_CONFIG\"\n");
        let mut p = Pipeline::checkout(dir.path(), uv).unwrap();
        p.path = "/usr/bin:/bin:/usr/sbin:/sbin".into();   // an app started from the Finder
        p.uv_dirs = Some(UvDirs { python: "/data/python".into(), cache: "/caches/uv".into(), tools: "/data/tools".into(), bin: "/data/bin".into() });
        let seen = p.one(&["doctor"], "doctor").unwrap();
        assert_eq!(seen["path"], format!("{}:/usr/bin:/bin:/usr/sbin:/sbin", dir.path().display()));
        assert_eq!((&seen["pref"], &seen["python"], &seen["cache"], &seen["noconfig"]),
                   (&"only-managed".into(), &"/data/python".into(), &"/caches/uv".into(), &"1".into()));
    }

    #[test]
    fn a_run_can_be_stopped_by_its_process_before_it_has_an_id() {
        let dir = repo();
        let script = executable(dir.path(), "slow-uv", "#!/bin/sh\nsleep 30\n");   // a first environment sync that does not end
        let p = Pipeline::checkout(dir.path(), script).unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let started = std::time::Instant::now();
        let run = std::thread::spawn(move || p.run_to_end_with(&["run"], |pid| tx.send(pid).unwrap(), |_| {}));
        stop_process(rx.recv().unwrap()).unwrap();
        let err = run.join().unwrap().unwrap_err().to_string();
        assert!(err.contains("ended without finishing the run"), "{err}");
        assert!(started.elapsed() < std::time::Duration::from_secs(10));
    }

    /// A pipeline whose commands are kept in a `Procs` of its own (stopping them stops no other test's).
    fn own_procs(mut p: Pipeline) -> (Pipeline, &'static Procs) {
        let procs: &'static Procs = Box::leak(Box::default());
        p.procs = procs;
        (p, procs)
    }

    /// A stand-in for uv that starts a child of its own (as uv runs Python) and waits for it; `trap` is run first.
    fn uv_with_a_child(dir: &Path, name: &str, trap: &str) -> (PathBuf, PathBuf) {
        let child_pid = dir.join(format!("{name}.child"));
        (executable(dir, name, &format!("#!/bin/sh\n{trap}\nsleep 30 &\necho $! > '{}'\nwait\n", child_pid.display())), child_pid)
    }

    fn started(child_pid: &Path) -> u32 {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            if let Some(pid) = fs::read_to_string(child_pid).ok().and_then(|t| t.trim().parse().ok()) {
                return pid;
            }
            assert!(std::time::Instant::now() < deadline, "the stand-in never started its child");
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }

    fn alive(pid: u32) -> bool {
        running(|p, _| p == pid)
    }

    #[test]
    fn a_zombie_is_not_running() {
        // exited and never waited for: a zombie, which `kill -0` still finds
        let mut child = Command::new("true").spawn().unwrap();
        let pid = child.id();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !String::from_utf8_lossy(&Command::new("ps").args(["-o", "stat=", "-p", &pid.to_string()]).output().unwrap().stdout).trim().starts_with('Z') {
            assert!(std::time::Instant::now() < deadline, "the child never ended");
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert!(Command::new("kill").args(["-0", &pid.to_string()]).status().unwrap().success(), "kill -0 finds a zombie");
        assert!(!alive(pid) && !group_alive(pid), "a zombie counted as running");
        child.wait().unwrap();
    }

    #[test]
    fn quitting_stops_a_setup_under_way_and_what_it_started() {
        let dir = repo();
        let (uv, child_pid) = uv_with_a_child(dir.path(), "slow-setup-uv", "");
        let (p, procs) = own_procs(Pipeline::checkout(dir.path(), uv).unwrap());
        let setup = std::thread::spawn(move || p.setup(|_| {}));
        let child = started(&child_pid);
        assert_eq!(procs.lock().live.len(), 1, "the setup's CLI is not kept while it runs");
        let stopping = std::time::Instant::now();
        assert_eq!(procs.stop_all(std::time::Duration::from_secs(10)), Vec::<u32>::new(), "TERM was enough: nothing killed");
        let err = setup.join().unwrap().unwrap_err().to_string();
        // its stand-in waits 30 s for its child: ended well before, it was stopped, not left to finish
        assert!(stopping.elapsed() < std::time::Duration::from_secs(5), "the setup was not stopped: it ran to its end");
        assert!(err.contains("setup ended without finishing"), "{err}");
        assert!(!alive(child), "what the CLI started outlived it");
        assert!(procs.lock().live.is_empty(), "an ended command is still kept");
    }

    #[test]
    fn a_command_that_ignores_term_is_killed_after_the_grace() {
        let dir = repo();
        let (uv, child_pid) = uv_with_a_child(dir.path(), "stubborn-uv", "trap '' TERM");   // its child ignores it too
        let (p, procs) = own_procs(Pipeline::checkout(dir.path(), uv).unwrap());
        let (tx, rx) = std::sync::mpsc::channel();
        let run = std::thread::spawn(move || p.run_to_end_with(&["run"], |pid| tx.send(pid).unwrap(), |_| {}));
        let cli = rx.recv().unwrap();
        let child = started(&child_pid);
        let stopping = std::time::Instant::now();
        assert_eq!(procs.stop_all(std::time::Duration::from_millis(500)), vec![cli], "the group outlasted TERM: killed");
        assert!(run.join().unwrap().is_err());
        assert!(stopping.elapsed() < std::time::Duration::from_secs(5), "the run was not stopped: it ran to its end");
        assert!(!alive(child) && !alive(cli));
    }

    #[test]
    fn quitting_during_a_named_run_cancels_it_and_lets_its_cli_end_by_itself() {
        let dir = repo();
        let canceled = dir.path().join("canceled");
        // the CLI's run polls for the cancel (as its scheduler does each tick) and ends by itself, `canceled`
        let uv = executable(dir.path(), "run-uv", &format!(r#"#!/bin/sh
case "$*" in
  *"--json cancel"*) touch '{0}'; echo '{{"v": 1, "type": "canceled", "run": "20261026-221500-abcdef"}}' ;;
  *"--json run"*) echo '{{"v": 1, "type": "run.created", "run": "20261026-221500-abcdef"}}'
    while [ ! -e '{0}' ]; do sleep 0.05; done
    echo '{{"v": 1, "type": "run.finished", "run": "20261026-221500-abcdef", "status": "canceled"}}' ;;
esac
"#, canceled.display()));
        let (p, procs) = own_procs(Pipeline::checkout(dir.path(), uv.clone()).unwrap());
        let control: &'static RunControl = Box::leak(Box::default());
        control.start();
        let (tx, rx) = std::sync::mpsc::channel();
        let run = std::thread::spawn(move || p.run_to_end_with(&["run"], |pid| { control.spawned(pid); }, |o| {
            if o["type"] == "run.created" { tx.send(()).unwrap() }
        }));
        rx.recv().unwrap();   // named
        let mut cancel = Pipeline::checkout(dir.path(), uv).unwrap();
        cancel.procs = procs;
        assert_eq!(stop_for_quit(Some(&cancel), Some("20261026-221500-abcdef"), control, procs, std::time::Duration::from_secs(5)),
                   Vec::<u32>::new());
        // it saw the cancel and ended by itself: not stopped before it could stop what it was starting
        assert_eq!(run.join().unwrap().unwrap(), Some(("20261026-221500-abcdef".to_string(), "canceled".to_string())));
        assert!(procs.lock().live.is_empty());
    }

    #[test]
    fn a_command_started_once_quitting_has_begun_is_stopped_too() {
        // as start_setup does: an upgrade stopped while a version is installed goes on to `doctor`. That second command
        // starts only once stop_all has returned, so only Procs being closed can stop it.
        let dir = repo();
        let uv = executable(dir.path(), "two-step-uv", "#!/bin/sh\ncase \"$*\" in\n  *\"--json upgrade\"*) sleep 30 ;;\n  *\"--json doctor\"*) sleep 37 & wait ;;\nesac\n");
        let (p, procs) = own_procs(Pipeline::checkout(dir.path(), uv).unwrap());
        let (go, wait_go) = std::sync::mpsc::channel::<()>();
        let thread = std::thread::spawn(move || {
            let _ = p.call(&["upgrade"]);   // stopped: carries on regardless
            wait_go.recv().unwrap();
            p.call(&["doctor"])
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while procs.lock().live.is_empty() {
            assert!(std::time::Instant::now() < deadline, "the first command never started");
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert_eq!(procs.stop_all(std::time::Duration::from_secs(5)), Vec::<u32>::new());
        assert!(procs.lock().live.is_empty() && procs.lock().closed);
        let started = std::time::Instant::now();
        go.send(()).unwrap();
        assert!(thread.join().unwrap().is_err(), "the second command ran to its end");
        assert!(started.elapsed() < std::time::Duration::from_secs(5), "the second command was not stopped: it ran to its end");
        let left = Command::new("pgrep").args(["-f", "sleep 37"]).stdout(Stdio::null()).status().unwrap().success();
        assert!(!left, "what the second command started outlived the quit");
    }

    #[test]
    fn a_command_that_ended_is_not_kept() {
        let dir = repo();
        let (p, procs) = own_procs(Pipeline::checkout(dir.path(), fake_uv(dir.path(), r#"{"v": 1, "type": "doctor"}"#, "", 0)).unwrap());
        p.one(&["doctor"], "doctor").unwrap();
        assert!(procs.lock().live.is_empty());
        assert_eq!(procs.stop_all(std::time::Duration::from_secs(1)), Vec::<u32>::new());
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
        // kinds that go nowhere: refused, whatever was agreed (it would hide the API's destination)
        let api = serde_json::json!({"v": 1, "type": "plan", "ok": true, "nodes": [
            {"id": "captions", "cached": false, "uploads": ["frames"], "upload_to": null, "service": "Anthropic API"}]});
        let none: Uploads = [("captions".to_string(), Agreed { kinds: vec!["frames".into()], service: None })].into_iter().collect();
        assert!(upload_gate(&api, &none).unwrap_err().to_string().contains("plainly"));
        // a plan that puts a node on another machine but does not say where its inputs go is refused, whatever else was
        // agreed (the run would get --allow-uploads for the agreed step)
        let placed = |place: &str, to: Option<Value>| {
            let mut node = serde_json::json!({"id": "faces", "cached": false, "uploads": [], "place": place});
            if let Some(to) = to { node["upload_to"] = to; }
            serde_json::json!({"v": 1, "type": "plan", "ok": true, "nodes": [node],
                "places": {"native:mps": {"title": "This machine", "remote": false, "accelerator": "mps"},
                           "ssh-lab:cuda": {"title": "lab (SSH)", "remote": true, "accelerator": "cuda"}}})
        };
        let other: Uploads = [("captions".to_string(), Agreed { kinds: vec!["frames".into()], service: Some("Anthropic API".into()) })].into_iter().collect();
        assert!(upload_gate(&placed("ssh-lab:cuda", None), &other).unwrap_err().to_string().contains("plainly"));
        assert!(upload_gate(&placed("ssh-lab:cuda", Some(Value::Null)), &other).unwrap_err().to_string().contains("plainly"));
        assert!(upload_gate(&placed("gpu9:cuda", None), &other).unwrap_err().to_string().contains("plainly"));   // not listed
        assert!(upload_gate(&placed("native:mps", None), &other).is_ok());
        assert!(upload_gate(&placed("ssh-lab:cuda", Some(serde_json::json!("lab (SSH)"))), &agreed_to("lab (SSH)", &[])).is_ok());   // said, and agreed
        assert!(upload_gate(&on(serde_json::json!({"host": "lab"}), serde_json::json!([])), &agreed_to("lab (SSH)", &[])).unwrap_err().to_string().contains("plainly"));
    }

    #[test]
    fn the_other_machines_a_run_uses_are_the_places_its_plan_does_not_say_are_this_one() {
        let plan = |nodes: Value| serde_json::json!({"v": 1, "type": "plan", "ok": true, "nodes": nodes,
            "places": {"native:mps": {"title": "This machine", "remote": false, "accelerator": "mps"},
                       "ssh-lab:cuda": {"title": "lab (SSH)", "remote": true, "accelerator": "cuda"},
                       "runpod:cuda": {"title": "Cloud GPU (RunPod)", "remote": true, "accelerator": "cuda"}}});
        let node = |id: &str, place: Value| serde_json::json!({"id": id, "cached": false, "place": place});
        assert!(remote_places(&plan(serde_json::json!([node("decode", "native:mps".into()), node("captions", Value::Null)]))).is_empty());
        assert_eq!(remote_places(&plan(serde_json::json!([node("decode", "native:mps".into()), node("faces", "ssh-lab:cuda".into()),
                                                          node("gaze", "ssh-lab:cuda".into()), node("objects", "runpod:cuda".into())]))),
                   ["lab (SSH)", "Cloud GPU (RunPod)"]);
        // a place the plan does not list is not taken to be this machine; a cached node may run after all
        assert_eq!(remote_places(&plan(serde_json::json!([node("faces", "ssh-gpu9:cuda".into())]))), ["ssh-gpu9:cuda"]);
        let mut cached = node("faces", "ssh-lab:cuda".into());
        cached["cached"] = true.into();
        assert_eq!(remote_places(&plan(serde_json::json!([cached]))), ["lab (SSH)"]);
        // a place that is not plainly one, or places that are not a map, are not taken to be this machine (as upload_gate)
        assert_eq!(remote_places(&plan(serde_json::json!([node("faces", serde_json::json!({"host": "lab"}))]))), ["another machine"]);
        assert_eq!(remote_places(&serde_json::json!({"nodes": [node("faces", "native:mps".into())], "places": []})), ["native:mps"]);
        // a CLI from before other machines places nothing elsewhere
        assert!(remote_places(&serde_json::json!({"nodes": [node("decode", "native:mps".into())]})).is_empty());
    }

    #[test]
    fn a_run_with_steps_elsewhere_keeps_the_mac_awake_from_when_it_is_named_until_it_ends() {
        let dir = repo();
        let objects = ["{\"v\": 1, \"type\": \"run.created\", \"run\": \"20261028-120000-abc123\", \"store\": \"/s\"}",
                       "{\"v\": 1, \"type\": \"event\", \"node\": \"faces\", \"kind\": \"task.started\"}",
                       "{\"v\": 1, \"type\": \"run.finished\", \"run\": \"20261028-120000-abc123\", \"status\": \"canceled\"}"];
        let p = Pipeline::checkout(dir.path(), fake_uv(dir.path(), &objects.join("\n"), "", 0)).unwrap();
        let lab = format!("lab {} (SSH)", uuid::Uuid::new_v4());   // its own name: other tests hold theirs meanwhile
        let mut awake = AwakeForRun::new(vec![lab.clone()]);
        #[cfg(target_os = "macos")]
        let reason = format!("HyperStudy Annotator: run 20261028-120000-abc123 has steps on {lab}");
        let mut during = vec![];
        assert!(!awake.held());
        p.run_to_end(&["run"], |o| {
            awake.see(o);
            during.push((o["type"].as_str().unwrap().to_string(), awake.held()));
            #[cfg(target_os = "macos")]
            if o["type"] == "event" {   // what the system sees while the run goes on
                assert!(crate::awake::tests::listed(&reason, true), "not listed during the run:\n{}", crate::awake::tests::assertions());
            }
        }).unwrap();
        // from the object that names the run (before it, the CLI has started no node) to the run's last
        assert_eq!(during, [("run.created".to_string(), true), ("event".into(), true), ("run.finished".into(), true)]);
        drop(awake);   // as run_and_import does when the run ends, however it ended
        #[cfg(target_os = "macos")]
        assert!(!crate::awake::tests::listed(&reason, false), "still listed after the run:\n{}", crate::awake::tests::assertions());

        // a run on this Mac alone holds nothing
        let mut awake = AwakeForRun::new(vec![]);
        p.run_to_end(&["run"], |o| awake.see(o)).unwrap();
        assert!(!awake.held());
    }

    #[test]
    fn a_hosts_name_destination_and_folder_are_checked_before_the_cli_sees_them() {
        assert_eq!(host_args("add", "lab", Some("me@lab.example.edu"), None, &SshOverrides::default()).unwrap(),
                   vec!["hosts", "add", "--", "lab", "me@lab.example.edu"]);
        assert_eq!(host_args("add", "gpu-2", Some("gpu2"), Some("scratch/perception"), &SshOverrides::default()).unwrap(),
                   vec!["hosts", "add", "--root", "scratch/perception", "--", "gpu-2", "gpu2"]);
        assert_eq!(host_args("remove", "lab", None, None, &SshOverrides::default()).unwrap(), vec!["hosts", "remove", "--", "lab"]);
        assert_eq!(host_args("keys", "lab", Some("on"), None, &SshOverrides::default()).unwrap(), vec!["hosts", "keys", "--", "lab", "on"]);
        assert_eq!(host_args("keys", "lab", Some("off"), None, &SshOverrides::default()).unwrap(), vec!["hosts", "keys", "--", "lab", "off"]);
        assert!(host_args("keys", "lab", Some("--yes"), None, &SshOverrides::default()).is_err());
        assert!(host_args("keys", "lab", None, None, &SshOverrides::default()).is_err());
        assert!(host_args("add", "lab", Some("lab"), Some("~/scratch/perception"), &SshOverrides::default()).is_ok());
        assert!(host_args("add", "lab", Some("lab"), Some("/scratch/me/perception"), &SshOverrides::default()).is_ok());   // its marker guards what clean empties
        for (name, dest, root) in [("Lab", "lab", ""), ("cloud", "lab", ""), ("-x", "lab", ""), ("lab", "-oProxyCommand=x", ""),
                                   ("lab", "lab;rm", ""), ("lab", "", ""), ("lab", "lab", "../etc"), ("lab", "lab", "-x"), ("lab", "lab", "a b"),
                                   ("lab", "lab", "/"), ("lab", "lab", "~"), ("lab", "lab", "."), ("lab", "lab", "~/"), ("lab", "lab", "a/~b")] {
            assert!(host_args("add", name, Some(dest), Some(root), &SshOverrides::default()).is_err(), "{name} {dest} {root}");
        }
        assert!(host_args("delete-everything", "lab", None, None, &SshOverrides::default()).unwrap_err().to_string().contains("not something to do"));
        assert!(host_args("add", "runpod", Some("lab"), None, &SshOverrides::default()).is_err());   // the CLI keeps it for itself
    }

    #[test]
    fn a_hosts_user_port_and_key_are_checked_and_go_before_the_destination() {
        let ov = SshOverrides { user: Some("ana".into()), port: Some(2222), identity: Some("~/.ssh/id_lab".into()) };
        assert_eq!(host_args("add", "lab", Some("lab.example.org"), None, &ov).unwrap(),
                   vec!["hosts", "add", "--user", "ana", "--port", "2222", "--identity", "~/.ssh/id_lab", "--", "lab", "lab.example.org"]);
        assert_eq!(host_args("probe", "lab.example.org", None, None, &ov).unwrap(),
                   vec!["hosts", "probe", "--user", "ana", "--port", "2222", "--identity", "~/.ssh/id_lab", "--", "lab.example.org"]);
        assert_eq!(host_args("check", "lab", None, None, &ov).unwrap(), vec!["hosts", "check", "--", "lab"]);   // only add and probe take them
        for bad in [SshOverrides { user: Some("-oProxyCommand=x".into()), ..Default::default() },
                    SshOverrides { user: Some("a b".into()), ..Default::default() },
                    SshOverrides { port: Some(0), ..Default::default() },
                    SshOverrides { identity: Some("-i/etc/x".into()), ..Default::default() },
                    SshOverrides { identity: Some("a\nb".into()), ..Default::default() }] {
            assert!(host_args("add", "lab", Some("lab"), None, &bad).is_err(), "{bad:?}");
        }
        assert!(host_args("probe", "-oProxyCommand=x", None, None, &SshOverrides::default()).is_err());
    }

    #[test]
    fn checks_name_only_what_the_cli_can_check() {
        assert_eq!(key_check_args("ANTHROPIC_API_KEY").unwrap(), vec!["keys", "check", "--", "ANTHROPIC_API_KEY"]);
        assert!(key_check_args("--help").is_err() && key_check_args("AWS_SECRET_ACCESS_KEY").is_err());
        assert_eq!(cloud_check_args("aws").unwrap(), vec!["cloud", "check"]);
        assert_eq!(cloud_check_args("runpod").unwrap(), vec!["cloud", "check", "runpod"]);
        assert!(cloud_check_args("gcp").is_err());
    }

    #[test]
    fn the_ssh_configs_hosts_are_its_named_hosts_without_patterns() {
        let config = "Include ~/.orbstack/ssh/config\n\nHost lab-gpu biowulf\n  HostName gpu.example.org\n  User ana\nhost=coder.ws\nHost *\n  ServerAliveInterval 30\nHost !bad ?x lab-gpu\nMatch host foo\n";
        assert_eq!(ssh_config_hosts(config), vec!["lab-gpu", "biowulf", "coder.ws"]);
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
        let script = executable(dir.path(), "chatty-uv", "#!/bin/sh\necho 'Resolved 12 packages in 3ms'\nsleep 30\n");
        let p = Pipeline::checkout(dir.path(), script).unwrap();
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
        // the places the pipeline's plan offers: its backends (native, self, cloud, runpod, and ssh-NAME for a lab
        // server added as NAME, hosts.py) and an accelerator
        for place in ["cloud:cuda", "runpod:cuda", "self:cpu", "ssh-liquidswords2:cuda", "ssh-lab:cpu", "ssh-a:mps", "ssh-a234567890123456789012345678901:cuda"] {
            let mut one = std::collections::BTreeMap::new();
            one.insert("faces".to_string(), place.to_string());
            assert_eq!(place_args(&one).unwrap(), vec!["--place".to_string(), format!("faces={place}")], "{place}");
        }
        for (node, place) in [("faces", "native:cpu --allow-downloads"), ("../x", "native:cpu"), ("faces", "NATIVE:CPU"), ("faces", "native"),
                              ("--allow-downloads", "native:cpu"), ("-x", "native:cpu"), ("faces", "ssh-:cuda"), ("faces", "ssh--x:cuda"),
                              ("faces", "ssh-Lab:cuda"), ("faces", "ssh-lab.local:cuda"), ("faces", "ssh-a2345678901234567890123456789012:cuda"),
                              ("faces", "lab-1:cuda"), ("faces", "ssh-lab:cuda=x"), ("faces", "foo:cuda"), ("faces", "ssh:cuda")] {
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
    /// A script tests run. A child process (`install`) writes the executable: had this process written it, another test
    /// thread forking at that moment would hold its write handle in the child until exec, and running the script would
    /// fail with "Text file busy" (ETXTBSY, seen in CI). The source it copies is never executed.
    fn executable(dir: &Path, name: &str, text: &str) -> PathBuf {
        let (path, src) = (dir.join(name), dir.join(format!("{name}.txt")));
        fs::write(&src, text).unwrap();
        let status = std::process::Command::new("install").args(["-m", "755"]).arg(&src).arg(&path).status().unwrap();
        assert!(status.success(), "install could not write {}", path.display());
        path
    }

    fn fake_uv(dir: &Path, stdout: &str, stderr: &str, code: i32) -> PathBuf {
        executable(dir, "fake-uv", &format!("#!/bin/sh\ncat <<'EOF'\n{stdout}\nEOF\necho '{stderr}' >&2\nexit {code}\n"))
    }

    #[test]
    fn a_run_that_ends_without_finishing_is_an_error_that_says_why() {
        let dir = repo();
        let created = r#"{"v": 1, "type": "run.created", "run": "r1", "store": "/s"}"#;
        let p = Pipeline::checkout(dir.path(), fake_uv(dir.path(), created, "error: uv could not sync the environment", 1)).unwrap();
        let mut seen = 0;
        let err = p.run_to_end(&["run", "g.yaml"], |_| seen += 1).unwrap_err().to_string();
        assert!(err.contains("ended without finishing the run") && err.contains("uv could not sync"), "{err}");
        assert_eq!(seen, 1);
    }

    #[test]
    fn the_keys_stored_in_the_app_reach_the_cli_in_its_environment_and_only_there() {
        let dir = repo();
        // the CLI stand-in says whether it got the key, and checks the value without printing it
        let uv = executable(dir.path(), "fake-uv", "#!/bin/sh\n[ \"$RUNPOD_API_KEY\" = sk-test-rp ] && got=true || got=false\n\
            printf '{\"v\": 1, \"type\": \"doctor\", \"got\": %s}\\n' \"$got\"\n");
        let mut p = Pipeline::checkout(dir.path(), uv).unwrap();
        assert_eq!(p.one(&["doctor"], "doctor").unwrap()["got"], false);
        p.secrets = crate::keys::Secrets(vec![("RUNPOD_API_KEY".into(), "sk-test-rp".into())]);
        assert_eq!(p.one(&["doctor"], "doctor").unwrap()["got"], true);
        assert!(!format!("{p:?}").contains("sk-test-rp"));   // a Pipeline in an error or a log shows names only
    }

    #[test]
    fn a_run_reports_its_id_and_status_and_one_the_cli_refused_says_so_in_its_own_objects() {
        let dir = repo();
        let finished = "{\"v\": 1, \"type\": \"run.created\", \"run\": \"r1\", \"store\": \"/s\"}\n{\"v\": 1, \"type\": \"run.finished\", \"run\": \"r1\", \"status\": \"succeeded\"}";
        let p = Pipeline::checkout(dir.path(), fake_uv(dir.path(), finished, "", 0)).unwrap();
        assert_eq!(p.run_to_end(&["run"], |_| {}).unwrap(), Some(("r1".into(), "succeeded".into())));
        let refused = r#"{"v": 1, "type": "plan", "ok": false, "nodes": [], "estimated_usd": 0}"#;   // printed, then exit 1
        let p = Pipeline::checkout(dir.path(), fake_uv(dir.path(), refused, "", 1)).unwrap();
        assert_eq!(p.run_to_end(&["run"], |_| {}).unwrap(), None);
    }

    #[test]
    fn setup_reports_each_step_as_it_ends_and_what_failed() {
        let dir = repo();
        let step = |what: &str, ok: bool, msg: &str| format!(r#"{{"v": 1, "type": "setup.step", "node": "core.decode@1.0.0", "what": "{what}", "ok": {ok}, "seconds": 1.0, "message": "{msg}"}}"#);
        let ok = format!("{}\n{}\n{{\"v\": 1, \"type\": \"setup\", \"ok\": true}}", step("environment", true, ""), step("models", true, ""));
        let p = Pipeline::checkout(dir.path(), fake_uv(dir.path(), &ok, "", 0)).unwrap();
        let mut seen = vec![];
        p.setup(|o| seen.push(o["type"].as_str().unwrap().to_string())).unwrap();
        assert_eq!(seen, ["setup.step", "setup.step", "setup"]);
        let failed = format!("{}\n{{\"v\": 1, \"type\": \"setup\", \"ok\": false}}", step("environment", false, "no network"));
        let p = Pipeline::checkout(dir.path(), fake_uv(dir.path(), &failed, "", 1)).unwrap();
        assert_eq!(p.setup(|_| {}).unwrap_err().to_string(), "environment core.decode@1.0.0: no network");
        let p = Pipeline::checkout(dir.path(), fake_uv(dir.path(), "", "error: no Python 3.12 could be fetched", 2)).unwrap();
        let err = p.setup(|_| {}).unwrap_err().to_string();
        assert!(err.contains("ended without finishing") && err.contains("no Python 3.12"), "{err}");
    }

    /// The real CLI end to end, as the app runs it: the pipeline installed with the uv the app bundles into folders of
    /// its own (from PyPI, or the wheel PERCEPTION_WHEEL names), with only the PATH an app started from the Finder has,
    /// on a Python uv fetches (nothing of this machine's is used). A small clip is decoded, exported and imported into a
    /// library. Needs the fetched uv and the network; PERCEPTION_REPO runs a checkout instead.
    #[test]
    fn a_run_streams_events_then_exports_a_bundle_the_library_imports() {
        let Some(uv) = fetched_uv() else { return eprintln!("skipped: run scripts/fetch-uv.sh") };
        let work = tempfile::tempdir().unwrap();
        let video = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/clip.mp4");
        let app = work.path().join("MacOS");   // laid out as in the app: `uv` beside the executable
        fs::create_dir_all(&app).unwrap();
        std::os::unix::fs::symlink(&uv, app.join("uv")).unwrap();
        let uv = bundled_uv(&app.join("hyperstudy-annotator")).unwrap();
        let (finder, d) = (OsStr::new("/usr/bin:/bin:/usr/sbin:/sbin"), dirs(work.path()));
        let mut p = match std::env::var_os("PERCEPTION_REPO") {
            Some(repo) => Pipeline::checkout(Path::new(&repo), uv).unwrap(),
            None => {
                let spec = std::env::var("PERCEPTION_WHEEL").unwrap_or_else(|_| COMPATIBLE.to_string());
                Pipeline::installed(&install_tool(&uv, finder, &d, &spec).unwrap(), uv).unwrap()
            }
        };
        p.home = Some(work.path().join("home"));
        p.path = finder.to_owned();
        p.uv_dirs = Some(d);
        let doctor = p.one(&["doctor"], "doctor").unwrap();
        assert!(doctor["nodes"].as_array().unwrap().iter().any(|n| n["ref"] == "core.decode@1.0.0"));

        assert!(p.graphs().unwrap().iter().any(|g| g.file == "decode.yaml"));
        let graph = p.graph("decode.yaml").unwrap();
        let input = format!("video={}", video.display());
        let plan = p.one(&["plan", &graph, "--input", &input], "plan").unwrap();
        assert_eq!(plan["ok"], true, "{plan}");

        let mut seen = vec![];
        let (run, status) = p.run_to_end(&["run", &graph, "--input", &input], |o| seen.push(o.clone())).unwrap().unwrap();
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
        if std::env::var_os("PERCEPTION_REPO").is_none() {   // the CLI ran on the Python uv fetched for the app
            let cfg = fs::read_to_string(work.path().join("tools/hyperstudy-perception/pyvenv.cfg")).unwrap();
            assert!(cfg.lines().any(|l| l.starts_with("home = ") && l.contains(&*work.path().join("python").to_string_lossy())), "{cfg}");
        }
    }
}
