# Annotator backend: running the pipeline, keeping corrections, analysis, HyperStudy

Status: plan, 2026-10-24. Follows the Svelte port (PORT_PLAN.md: steps 1-8 done; step 9, checking the native
dialogs by hand, is still open).

## Decisions (2026-10-24)

- **Audience.** The standalone app is for independent researchers. It must also be able to augment HyperStudy
  (open a study's videos, send results back), but a HyperStudy account is never required.
- **Where the master copy lives.** Data that belongs to a HyperStudy study is kept on HyperStudy (videos, bundles,
  corrections of record). Everything else is kept locally, in the app's library. Local-only users never sync.
- **Pipeline UI.** Users choose where each node runs (this machine, a cloud GPU, a model API) and see an estimated
  price and duration for each choice before anything starts.
- **User-owned servers.** A third kind of compute next to local and cloud: a machine the user can SSH to (a lab GPU
  server, a DGX Spark). Price 0, duration from measurements on that machine.
- **HyperStudy connection.** A Settings page where the user pastes an API key created in HyperStudy. Stored in the
  OS keychain; nothing else is needed to connect.

## What exists

- Import of a bundle folder: checked, copied read-only into the app's data folder, deduplicated by manifest checksum.
- Videos are never copied: bundles name them by sha256 and the `videos` table records where each was found.
- SQLite library (`src-tauri/src/db.rs`): `bundles`, `videos`, and `corrections`, an append-only op log per bundle.
  The bundle is never modified; the viewer shows bundle + ops.

## Steps

1. **Corrections that survive a re-run.** Each op records its author and the bundle version it was made against.
   When a new version of a video's bundle arrives (a re-run), ops are carried over: re-anchored to the new tracks by
   time and box overlap, and anything that does not match cleanly is listed for review rather than dropped or
   guessed. Bundles of one video form a lineage (same video sha256), so the library shows one entry per video with
   its versions. Needed before anyone annotates in earnest: it is also what makes corrections usable as labels for
   evaluating new model versions.
   - **The stored log is never rewritten.** Only an explicit undo (truncate) or import (replace) changes a log, as
     now. Carrying over appends the re-anchored ops to the *new* version's log, each pointing back to the op it came
     from; the old version's log and bundle are left as they were. Because `corrections.bundle_id` cascades on
     delete, removing an old version must not be the only thing that kept an op: carried-over ops are copies, and
     the ops left for review are stored with the new version's carry-over record, which has no foreign key to the
     old version.
   - **Carried ops never override newer edits.** A carry-over goes only onto an empty log, as one batch (one undo
     takes it all back), so `fold`'s last-write-wins cannot put an old correction over a newer one.
   - **Older ops keep loading.** Ops in SQLite and in `perception-corrections/2` files (and `/1`, through
     `opFromV1`) have no author or base version. They load with base version = the bundle whose log holds them and
     author = unknown, never as unmatched or rejected. If the fields change the file format, it becomes `/3`, and
     `/2` is converted on import as `/1` is now.
   - **Schema change by migration.** Lineages and versions are a new migration (version 2) appended to
     `MIGRATIONS` in `db.rs`; version 1 is not edited.
2. **Run the pipeline from the app.** The app drives the `perception` CLI as a sidecar: a machine-readable mode
   (`--json`, one event per line) for plan, run, status, cancel, resume and `rerun --from`. "Add video" runs the
   chosen stages and imports the bundle when it finishes. The stage picker comes from the node manifests (choosing
   a stage adds its upstream stages).
   - **Placement and estimates.** For each node, the choices it can run on here (its manifest runners against this
     machine's probe, plus the cloud backend, SSH servers and API nodes), each with an estimated duration and price,
     and the privacy consequence (what would leave the machine). An SSH server shows it too: its price is 0, but the
     video and crops still leave this machine. Estimates come from measured runs: every task already
     records its seconds and usage; adding the device or instance type and the input's duration gives seconds per
     video minute per node per device, and price from that times the hourly rate (cloud) or per-unit cost (APIs).
     Until a node has measurements on a device, the estimate says so instead of guessing.
   - **SSH servers.** An orchestrator backend that sends single nodes to a user's machine over SSH, using the
     node file protocol as is: rsync the node, its uv environment definition and its inputs; run it; rsync `out/`
     and `response.json` back and check them like any other result. The server needs uv, ffmpeg, the
     drivers and a copy of the perception orchestrator (for `perception doctor` and the node SDK), and no root. Hosts come from the user's `~/.ssh/config` and keys from their ssh-agent: the app never
     stores private keys or passwords. The server is probed once (`perception doctor --json` over SSH) so placement
     knows its platform and accelerators. SkyPilot's SSH Node Pools were considered: they install k3s on each
     machine, which needs root and is heavy for a shared lab server.
     - **Nothing left behind on a shared server.** Each attempt gets a private workdir (mode 0700, created with
       umask 077), deleted once `out/` is fetched and checked, and also on cancel or failure. Study videos are often
       copyrighted or identifiable, and other accounts on a lab server could otherwise read them.
     - **Secrets** reach the remote node in its environment through the SSH channel (sent on stdin), never as
       command-line arguments (visible to every account in `ps`) or as files on the server.
     - **Dropped connections and crashes.** Each workdir holds a lease file renewed while the laptop is connected.
       The next connection to that server removes workdirs whose lease has expired, so an interrupted run leaves
       nothing behind beyond the next run.
     - **Fetched results are untrusted.** rsync runs without copying links (`--no-links`), and `out/` then goes
       through the same checks as an import: no links or special files, every path through `bundle::safe_path`, and
       manifest entries without `file`, `bytes` and `sha256` rejected.
   - Model downloads and missing secrets are shown before the run (the dry run already reports both). Secrets live
     in the OS keychain.
3. **Analysis export and a Python bundle reader.** In hyperstudy-perception: load a bundle, apply the op log, and
   return tables (faces, speakers, captions, ...), raw and corrected side by side. No HyperStudy dependency. It is a
   second implementation of rules the app enforces, so it carries them over:
   - paths resolved as `bundle::safe_path` does (relative components only, no symlink out of the bundle), and
     manifest entries without `file`, `bytes` and `sha256` rejected: analysts will point it at bundles from anywhere;
   - `perception-corrections/1` (with the `opFromV1` id mapping), `/2` and whatever the app writes next accepted,
     unknown fields ignored;
   - `fold` giving what `corrections.ts` gives. Both implementations are tested against shared fixtures (a bundle,
     an op log and the expected folded result), so neither can drift. The fixtures are synthetic: real bundles carry
     face crops and frames of study videos.
4. **HyperStudy integration (paused, to be designed).** Endpoints for bundles and corrections of record, the
   Python SDK building on the reader of step 3, and `Workspace.svelte` embedded in HyperStudy through a third
   `BundleSource`. Design questions: where bundles are stored (next to the videos, keyed by sha256?), how the
   correction log of record is kept (Firestore documents are limited to 1 MB, so a subcollection or a file), how the
   desktop app authenticates (decided: an API key created in HyperStudy, pasted into Settings), and how a local edit
   becomes a HyperStudy edit (and the reverse).

## Also to sort out

- Long films: per-frame samples in a binary sidecar (Parquet) instead of JSON (2 minutes of faces is ~14 MB of
  JSON); timeline performance at 2 hours.
- Playback: webview codec support differs by platform; a re-encoded H.264 proxy when a video does not play.
- Licences: academic-only layers carry a warning when exported or shared.
- Distribution: macOS signing and notarisation, Windows build, auto-update, bundle schema migrations.
- Several annotators on one video: merging op logs, agreement statistics.
