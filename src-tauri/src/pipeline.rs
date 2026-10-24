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
    let (f, d) = (folder.canonicalize()?, data_dir.canonicalize().unwrap_or_else(|_| data_dir.to_path_buf()));
    if f.starts_with(&d) {
        return Err(Error::Bundle(format!("{} is inside the app's own data; choose your hyperstudy-perception folder", folder.display())));
    }
    Ok(())
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
    pub fn run_to_end(&self, args: &[&str], mut on: impl FnMut(&Value)) -> Result<Option<(String, String)>> {
        let mut child = self.command(args).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
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
