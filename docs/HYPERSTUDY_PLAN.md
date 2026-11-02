# HyperStudy integration: features on upload, one annotation of record, and video understanding for agents

Status: design, 2026-11-02; phase 2 built 2026-11-06 (`@hyperstudyio/annotator` 0.1.0 on npm, `perception-corrections/3`
in the app); the Python SDK added as goal 6, section 9 and phase 5c, 2026-11-07. Replaces BACKEND_PLAN.md step 4 ("HyperStudy
integration, paused, to be designed").
Spans four repos: **hyperstudy** (most of the work), **hyperstudy-annotator** (the annotator as a package, sync),
**hyperstudy-perception** (a runner image, the Python bundle reader, later delivery by URL) and
**hyperstudy-pythonsdk** (push and pull from Python). When implementation starts, this file is copied to
`hyperstudy/dev_docs/PERCEPTION_INTEGRATION_PLAN.md` and the TODO markers there point at it.

## Goal

1. Every video uploaded to HyperStudy can have its features extracted on a cloud GPU (RunPod): by hand first, then
   automatically on upload.
2. The result (bundle) and the people's edits to it (op log) are stored in HyperStudy, readable and editable by
   exactly the people who can view and edit the video.
3. Editing in HyperStudy is the annotator's own frontend, backed by HyperStudy instead of SQLite.
4. The desktop app connects with a HyperStudy API key; edits made on either side reach the other.
5. An agent watching a video with a participant knows what happened in the video up to the moment the participant
   has seen, and nothing after. Everything is addressable by time.
6. A researcher can pull a video's annotation (bundle, op log, the corrected result as tables) into Python with the
   HyperStudy SDK and the same API key, and push edits back, under the same permissions as the web page.

## Decided (2026-11-02, Luke)

- **Licences: deferred.** HyperStudy does not charge during beta, so runs are not filtered by licence now. Kept in
  view from the start: every bundle, run and published timeline records each layer's `licence_mode` (the manifest
  already does), the Extract dialog shows it, and the features a run may use are chosen in one place
  (`perceptionFeaturesFor(org)`, today: all), so restricting layers to certain account types later is a change to
  that function, not to the pipeline or the data.
- **Accounts: the organization's own.** Runs use the research group's RunPod, Anthropic and Hugging Face accounts,
  never HyperStudy's, so the group is the party to each provider's terms and each model's licence. This fits how
  gated models work: Hugging Face grants SAM 3, DINOv3 and pyannote to a person, never to an organization, and
  HyperStudy's existing sharing model is exactly that: a member's own key (`userApiKeys/{uid}`, encrypted) shared
  with the organization (`organizations.sharedApiKeys[provider]`, `aiProviderKeyService.js`). Spend is the group's,
  bounded by a cap per run and a monthly budget the admin sets. Providing HyperStudy's accounts as an option later
  stays possible: the runner takes keys from one resolver, which could gain a platform source.
- **Consent and keys in one panel.** Organization settings gain a **Video features** panel, admins only: turn
  feature extraction on for the organization (off until then), the three keys (Anthropic reuses the key the
  organization already shares for agents if there is one, so it is set once), Hugging Face access per gated model
  as the desktop app shows it, the budget, and extraction of new uploads (off by default).
- **The annotator's frontend is an npm package**, published from the hyperstudy-annotator repo (public, MIT):
  one copy of the code, used by the desktop app and by HyperStudy. No new repo. Section 5.
- **Captions reveal at the shot's end** (never ahead of the participant), changeable per experiment
  (`captionReveal`). People appearing, cuts and sound onsets still reveal at their start, so a long shot is not
  silent until it ends.

## What exists (HyperStudy origin/dev, 2026-11-02)

| Area | Fact | Where |
|---|---|---|
| Video bytes | S3 bucket `hyperstudy-videos`, key `videos/<ms>-<uuid>.<ext>`; served by signed CloudFront URLs | `s3Service.js:26,122`, `cloudFrontService.js:52` |
| Video record | Firestore `videos/{uuid}`: name, s3Key, size, duration (client-supplied), ownerId, organizationId, folderId, hls* fields. **No content hash anywhere** | `uploadRoutes.js:1069-1102` |
| After upload | `/video/complete` submits a MediaConvert job fire-and-forget; MediaConvert → EventBridge → Lambda → `POST /api/upload/video/hls-webhook` (shared-secret header); Socket.IO `video:hls-ready` | `uploadRoutes.js:1152,1529,1634`, `hlsTranscodeService.js:143` |
| Permissions | `resourcePermissions` (types are a closed enum incl. `video`; keys canView, canEdit, canShare, canExport...); routes check with `checkItemPermission` (admin → owner → org admin → grants). Grants are copied to children, never resolved live | `resourcePermissionService.js:77,625,832`, `permissionChecker.js:207` |
| Firestore rules | All writes through the backend's Admin SDK; rules never read `resourcePermissions`; subcollections of `videos` fall to default deny | `firestore.rules:6-14,365-381,608` |
| API keys | v3: `hst_live_<hex>`, stored as sha256, scopes (`read:experiments`, `write:personas`, ...), `X-API-Key`; creation UI in Settings. **No video routes accept keys** | `api/v3/routes/auth.js:18-141`, `api/v3/middleware/auth.js:129-247`, `HyperStudyApiKeyManager.svelte` |
| Background work | No queue. K8s CronJobs (`jobRunner.js`, Firestore lock), in-process intervals with a Redis lock, AWS Lambdas. DigitalOcean Kubernetes. Nothing calls a GPU provider | `jobs/jobRunner.js`, `utils/backgroundJobs.js` |
| Frontend | Svelte 5 with runes, Vite 7, custom router, no per-video page (edits in modals in `VideoManager`). npm-only dependencies. `node_modules` Svelte compiles with runes undefined, so a runes package is detected as runes | `vite.config.js:28-36`, `App.svelte:69-161` |
| Agents | Run in-process on the V2 engine as protocol clients. The perception reducer ignores `playback.*`; on a showvideo screen the LLM is not called; prompts say only that a video is playing. Decisions are single-turn, tools are actions only (`send_chat`, `wait`, `submit_response`), no tool-result loop | `agents/perceptionModel.js:130-255`, `llmDecide.js:114`, `agentTools.js` |
| Playback clock | V2 engine keeps `_playback` per room: `videoTime` (absolute in the file), `paused`, `lastReportAt`; updated from the host's `playback-time-update` and `playback-command`; `playback.tick` reaches every role, the agent's included; in `runtime.snapshot(roomId)`. No playback rate | `engine/engine.js:735-820,1743,1929` |
| Stimulus reference | ShowVideo config `videoId` (the `videos` doc), `startTime`, `endTime`; a `{var}` URL nulls `videoId` | `shared/schemas/components/showvideo.schema.json:8-42` |
| Already anticipated | "per stimulus asset, precompute a time-stamped text track ... versioned with the experiment ... subscribe the perception layer to the existing synchronized playback clock; inject the active segment's text on segment change only" | `docs/superpowers/specs/2026-06-18-agent-perception-finishing-design.md:128-132`; `AGENT_PERCEPTION_DESIGN.md:249` |
| Adapter spec | `AGENT_SPEC_VERSION 0.3.0`; model endpoint (stateless `/chat/completions` per decision) and voice engine (`[context]` items); a contract change needs a version bump (test) | `agentSpec/buildAgentSpec.js:33` |

On the annotator side: `Workspace.svelte` sees only a `BundleSource` (`src/lib/source.ts`), corrections only a
`CorrectionStore` (`load/append/truncate/replace/subscribe`); `perception-annotated/1` (`model/annotated.ts`) is a
bundle with edits applied, each record marked model or human, with `included` (sent to agents).

## Shape

```
upload ─► S3 video ─► sha256 ─► (auto or button) perceptionRuns doc ─► k8s Job: perception-runner
                                                                         │  perception remote run runpod ...
                                                                         ▼
                                       RunPod pod (coordinator, GPU steps, API steps) ─► bundle
                                                                         │
             S3 perception/<manifestSha256>/...  ◄── Job uploads, backend validates ─────┘
                       │
   videos/{id}/bundles/{manifestSha256}            ◄── ops (perception-corrections/3) ◄── HyperStudy annotator page
                       │        └ ops/{seq}         ◄────────── v3 API (API key) ───────────► desktop app (sync)
                       ▼
   Publish ─► timeline (perception-timeline/1: items by reveal time + prefix-closed summaries)
                       │
   V2 engine room: _playback ─► watched intervals ─► agent snapshot.video ─► prompt / voice [context]
                       └────────► v3 timeline queries (researchers: any range; agents: clamped to what was watched)
```

## Decisions proposed

Agreed in outline 2026-11-02; the choices that were Luke's are under **Decided**, what remains under **Open questions**.

### 1. Identity and storage

- **`videos/{id}.sha256`**, computed by the backend after `/video/complete` (stream the S3 object through a hash,
  fire-and-forget like the HLS submit) and by a one-time backfill job for existing videos. Bundles name their video
  by sha256, and the desktop app finds the HyperStudy video for a local file by it.
- **Bundle files in S3**, `perception/<manifestSha256>/<path as in the manifest>`, in the video bucket. Immutable
  and content-addressed: a re-run is a new manifest, so a new prefix; nothing is overwritten. Read through CloudFront,
  ideally one signed custom policy per bundle prefix (wildcard resource) rather than a URL per file (unverified that
  `cloudFrontService` supports custom policies; else sign per file from the manifest list).
- **Firestore**, all under the video so the video's permissions are the only ones that apply:
  - `videos/{id}/perceptionRuns/{runId}`: status (`queued|running|succeeded|failed|canceled`), graph, features
    (`--only`), places, cap, cost, progress (per step, from the CLI's `--json` events), pod id, error, who started it,
    timestamps, the resulting `manifestSha256`.
  - `videos/{id}/bundles/{manifestSha256}`: the manifest (small), pipeline version, layers with licence modes,
    `origin` (`runpod-run`, `app-upload`), `opsSeq` (the log's last sequence number), `carriedFrom`.
  - `videos/{id}/bundles/{manifestSha256}/ops/{seq}`: one document per op (the log of record; avoids Firestore's
    1 MB document limit, which a long film's log would pass).
  - `videos/{id}.perception`: `{ bundle: <manifestSha256 being edited>, published: <publishId|null>, status }`, so
    the video table shows a status without reading subcollections.
- A second upload of a byte-identical file (same sha256) may reuse an existing bundle without a run; its op log
  starts empty (edits belong to the video record, not the file).

### 2. Permissions: the video's, by construction

- No direct client access: rules stay default-deny under `videos/{id}/...`. Every read and write goes through
  backend routes that call `checkItemPermission(video, ...)`, the same check `GET /api/videos/:id` uses.
  canView → read bundles, ops, timelines; canEdit → append ops, start/cancel runs, publish. Grants on the video
  (users, orgs, groups, public, folder inheritance) therefore apply without a new resource type.
- Live updates for open editors over the existing Socket.IO server: a room `perception:<videoId>` joined only after
  the same canView check; the backend emits each appended op batch there.
- API keys act as their user, so the desktop app sees exactly the videos its user can view.
- Duplicating a video: the bundle is reusable (same bytes); ops are not copied (later, if wanted).

### 3. Running the pipeline from HyperStudy

The pipeline already runs a whole graph on a RunPod pod made for the run (`perception remote run runpod`,
perception 0.1.4): the pod is the coordinator, holds the keys in memory, deletes itself at its deadline, and the
starting machine fetches the result over SSH. HyperStudy is that starting machine.

- **`perception-runner` image** (hyperstudy-perception repo, `cloud/hyperstudy-runner/`): Python + bundled uv +
  a pinned `hyperstudy-perception` (one minor version, as the app's `COMPATIBLE`), no GPU. Its entrypoint, given a
  run id, a signed video URL and a system token: download the video, check its sha256 against the run's, run
  `perception remote run runpod graphs/full.yaml --only ... --max-cost-usd N --allow-uploads --json` attached,
  forward progress events to the backend, `fetch` and `export` the bundle, `bundle validate`, upload the files to
  S3, `POST /api/perception/runs/:id/complete`. A SIGTERM trap runs `perception remote cancel runpod RUN`.
- **One k8s Job per run**, created by the backend through the Kubernetes API (`@kubernetes/client-node`; a
  ServiceAccount and Role allowing jobs create/get/delete in the namespace). `backoffLimit: 0` (no retries:
  a failed run is shown as failed), `activeDeadlineSeconds` = the pod's deadline + 30 min, `ttlSecondsAfterFinished`.
  A platform-wide limit on concurrent runs. If the Job dies, the pod still removes itself at its deadline
  (perception's guarantee); a sweep marks runs whose Job is gone as failed. Alternative without RBAC: a CronJob that
  claims one queued run per invocation with the existing Firestore lock; rejected for start latency and noise.
- **Keys are the organization's** (Decided): RunPod, Anthropic and Hugging Face keys resolved for the video's
  organization (`resolveProviderKey`, gaining `runpod` and `huggingface` beside `anthropic`) when the Job is made,
  and passed to it in a Secret made for that Job and deleted with it, with the run's system token. Never logged,
  never in the run doc. A run is refused before anything starts if a key its features need is missing, naming it.
  RunPod Secure Cloud only. The image's entrypoint sets the consents the CLI asks for (`cloud on runpod`,
  `cloud keys runpod on`); the organization's consent is the Video features panel.
- **Completion** is accepted only from the run's own Job (system token + run id, constant-time compare), then the
  backend checks the uploaded bundle as the app checks an import: every manifest entry has `file`, `bytes`, `sha256`
  and the stored object matches; the manifest's `video.sha256` equals the video's; schema version is one the
  annotator package reads. Only then is the bundle doc written and the video's `perception.bundle` set (if the video
  had no bundle, or its bundle has no edits; otherwise the new version is offered, see 4).
- **Triggers.** Only in organizations whose admin turned on Video features. Phase 1: an "Extract features" action
  on a video row (canEdit), showing features (with their licence modes), what leaves HyperStudy (the video to
  RunPod; keyframes to Anthropic), estimated cost, and the cap. Phase 2: the panel's "Extract features from new
  videos", off by default, with its features; fired once the sha256 is known, and not when the month's budget is
  spent.
- **Later (perception change, not needed first):** `remote run --input-url` (the pod fetches the video from a signed
  URL instead of from the Job over SSH) and `--deliver <S3 presigned POST for a prefix> --notify <URL>` (the pod
  uploads the bundle itself and calls back), so the Job can exit right after launch.

### 4. The op log of record: `perception-corrections/3`

The app's log is single-writer: undo truncates by index, import replaces the log. A log shared by several editors
and a syncing app needs ops that can be named.

- **Built in the app 2026-11-02** (BACKEND_PLAN, "Op ids and undo as an op"): each op carries `op_id` (random,
  made by the client; not `id`, which several ops use for what they act on), `batch` (shared by one edit's ops),
  `at`, `base` (the manifest sha256 it was made on). HyperStudy adds `author` (`{ id, name }`, from the signed-in
  user, never from the client) and `seq` (monotonic per log, assigned in a transaction on the bundle doc's
  `opsSeq`); the app keeps its own order (SQLite row ids) until it syncs.
- **Undo is an op**: `{ op: 'revert', batches: [...] }`, appended by `Session.undo` for the newest batch in effect
  (`lastUndoable`); in HyperStudy, the newest batch of the user's own. `live()` leaves out reverts and what they
  name, and `fold` applies the rest in log order (last write wins, as before). Import into a shared log is one
  batch: a revert of the live batches, then the file's ops.
- `CorrectionStore` is `load`, `append`, `replace`, `subscribe` (`truncate` is gone). For HyperStudy: `append`
  returns the seqs, `replace` becomes the revert-then-append above, `subscribe` delivers others' ops. Local logs
  are on `/3` already (migration 5: `op_id` `v2-<row id>`, batch `'at:' || at`), and `/2` and `/1` files are named
  on import, so there is one model.
- **Idempotent append** (keyed by `op_id`): a retried push never doubles an op.
- **Carry-over** works as in the app (`model/carryover.ts`, the `Lineage` interface): offered when a newer bundle
  of the video has an empty log. The server enforces "only onto an empty log" in the same transaction, so the web
  page and the app cannot both carry.
- **Two people at once**: last write wins per field by `seq`; an open page applies others' ops live. Presence and
  per-field conflict hints are later.

### 5. The annotator inside HyperStudy

- **Why a package.** The editor's code lives only in hyperstudy-annotator. HyperStudy needs the same editor, so
  the code either reaches HyperStudy as a versioned dependency or is copied (two copies that drift). Perception is
  different: HyperStudy only runs its CLI, in the runner image (3), and never imports it.
- **The annotator becomes a package** in its own repo (no new repo): `hyperstudy-annotator` turns into an npm
  workspace, `packages/annotator` (`@hyperstudyio/annotator`: `Workspace` and its components, `model/`,
  `timeline/`, `draw/`, the `BundleSource`/`CorrectionStore` interfaces; no Tauri import) and `app/` (Tauri, SQLite,
  pipeline, Settings). `source.ts` splits: the interfaces go to the package, `tauriSource` stays in the app. The app
  uses the package from the workspace (an edit is live in the app at once); HyperStudy pins a published version
  from public npm (it takes only registry dependencies), released from a tag like the app.
- **As built (2026-11-06, #63):** the app stayed at the repo root rather than moving to `app/`, so the Tauri, CI and
  release paths are unchanged; the app reads the package's source through a Vite alias. The package's CSS is scoped
  under `.hs-annotator` at one class of weight, and a browser test checks that HyperStudy's global rules change none
  of the editor's computed styles. `scripts/check-package.sh` builds the packed tarball in an app with HyperStudy's
  Svelte config on every CI run. Releases: `packages/annotator/RELEASING.md` (tag `annotator-vX.Y.Z`, npm trusted
  publishing). HyperStudy needs Svelte ≥ 5.53 (the peer range); dev has 5.57.3.
- **What HyperStudy embeds**: the workspace (viewer, timeline, Inspect, annotations, Review of carried ops). Not:
  PipelineDialog, Settings, Compute, Hugging Face access (HyperStudy runs the pipeline its own way, 3).
- **`hyperstudySource(videoId)`** in HyperStudy implements `BundleSource`: manifest and files from the bundle prefix
  (signed), `videoUrl` from the existing `videoUrlService` (HLS or MP4), corrections over the backend routes with the
  Socket.IO room as `subscribe`, `Lineage` over the video's bundles, `typesElsewhere` over the other videos the user
  can view in the same folder, file import/export as browser downloads.
- **Where**: a full-page route `/videos/:id/annotate` (HyperStudy has no per-video page; the router is
  `App.svelte`'s). From the video table: a Features column (`Extracting 40%`, `Ready`, `Failed`, `Edited`) and an
  Annotate action. The annotator's CSS is scoped under its root so it cannot restyle HyperStudy.

### 6. Desktop app ↔ HyperStudy

- **Key**: created in HyperStudy's API key UI with new scopes `read:media`, `read:perception`,
  `write:perception`; pasted into the app's Settings (decided 2026-10-24), kept in the OS keychain. HTTP is made from
  Rust so the webview never holds the key.
- **v3 routes** (all checking the key's user against the video with `checkItemPermission`):
  - `GET /api/v3/videos?sha256=` and `GET /api/v3/videos` (viewable, with sha256 and perception status)
  - `GET /api/v3/videos/:id/media` (signed URL)
  - `GET /api/v3/videos/:id/bundles`, `GET .../bundles/:m/files` (signed URLs or the prefix policy)
  - `GET .../bundles/:m/ops?after=<seq>`, `POST .../bundles/:m/ops` (idempotent by op id; returns seqs)
  - `POST .../bundles` (a bundle made in the app for a HyperStudy video: presigned upload, then the same validation
    as a run's)
  - `POST /api/v3/videos/:id/runs` (start an extraction from the app, later)
- **In the app**: Library gains a HyperStudy section (videos the key can view that have bundles). Opening one
  downloads the bundle into the library (content-addressed, the same import path) and plays the video from the local
  file when its sha256 matches one in the library, else from the signed URL. A linked bundle keeps
  `{ videoId, manifestSha256, lastSeq }`; its ops carry a sync state. Sync on open, on focus, and every 30 s while
  open: push unsent ops, pull `after=lastSeq`, fold. Offline edits push on reconnect. A local bundle of a video
  HyperStudy also has (same sha256) can be uploaded with its log ("Send to HyperStudy").

### 7. The agent timeline: what an agent can be told, and when

Agents do not read bundles. A **publish** step (canEdit, a button in the annotator page: "Use for agents") freezes
`(bundle, opsSeq)` and derives a compact, time-ordered text track from the annotated result
(`perception-annotated/1`, so names, merges, speaker fixes and exclusions are already applied, and records with
`included: false` are dropped).

- **`perception-timeline/1`**, one JSON file per publish in S3, a doc `videos/{id}/published/{publishId}`
  (`bundle`, `opsSeq`, `createdBy`, the summary model), and `videos/{id}.perception.published` pointing at it:

  ```
  { format, video: {id, sha256, duration}, bundle, opsSeq,
    people: { "person:3": { name: "Maya" } },
    items: [ { id: "utt:41", kind: "utterance", start: 63.2, end: 66.0, reveal: 66.0,
               text: "Maya: I told you already.", who: ["person:3"], source: "human" }, ... ],   // sorted by reveal
    checkpoints: [ { at: 121.4, summary: "..." }, ... ] }                                        // sorted by at
  ```
- **Reveal time** is the moment a viewer has the information. Onsets reveal at `start` (a cut, a person appearing,
  a sound's onset, on-screen text appearing); content that depends on the span reveals at `end` (an utterance, a
  shot's caption, a human annotation). Kinds: shot, caption, utterance, appearance/exit (people), on-screen text,
  sound, object, gesture/gaze events where included, human annotations.
- **Summaries are prefix-closed.** Checkpoints at scene boundaries roughly every 60 s; `summary_k` is written by a
  model from `summary_(k-1)` and the items with `reveal` in `(at_(k-1), at_k]` only. No summary ever sees an item
  past its own `at`. A whole-film summary is never given to an agent in a session (it is the researcher's).
- Summaries name people by their corrected names, so a publish happens after edits, not on every op. A newer
  bundle or more edits change nothing an agent sees until someone publishes again.
- The derivation runs in the backend (Node) with the annotator package's own `annotated.ts`, not a third
  implementation; summaries through the platform's Anthropic key. Gate: `session.svelte.ts` (runes) must run under
  Node from the compiled package; if not, its answers move to a plain-TS core that `Session` wraps.

### 8. Agents in a session: the horizon, delivery, and queries

- **Horizon from the engine's clock.** The agent's perception reducer handles `playback.tick`, `playback.command`
  and `playback.snapshot` for its room and keeps the **watched intervals** of the current ShowVideo state (ticks
  extend the current interval while playing; a seek starts a new one; gaps under ~2 tick periods are joined). The
  clock is driven by the human host's player, so it lags what the participant saw by a tick and the network: reveals
  can be late, never early.
- **What is revealed**: items whose `reveal` lies inside a watched interval and inside the component's
  `[startTime, endTime]`. A forward seek skips what the participant skipped; a backward seek keeps what was seen.
  A checkpoint summary is used only if `[0, at]` (within the segment) is fully watched; otherwise the agent gets the
  revealed items alone.
- **Lookup** is in memory: the engine loads the published timeline for `config.videoId` when the ShowVideo state
  starts (cached per pod by publishId); each tick is a binary search on `reveal`. No database read per tick.
- **Delivery** (push first, since decisions are single-turn):
  - Text agents: the snapshot gains `video` = `{ at, duration, summary, recent, onScreen }`, `recent` being the items
    after the summary's checkpoint, newest kept within a token budget. `promptBuilder` renders it as "The video so
    far (you are at 12:31 of 48:02): ...". It is present whenever a decision happens during or after the video:
    replying in chat, sparse-rating pauses, questions after the video. Unprompted remarks while watching are a later,
    separate trigger (rate-limited), since `llmDecide` skips passive screens today.
  - Voice agents: a `[context]` item of kind `video` on each reveal batch, which is the earlier spec's "inject on
    segment change only".
  - Adapter spec 0.4.0: the model endpoint's user message gains the video section; the voice engine gains `video`
    context items. External agents get only what HyperStudy sends ("nothing in the study room is exposed to the
    adapter directly" stays true).
- **Per experiment**: ShowVideo config gains `agentPerception: { enabled, kinds, summaries, captionReveal:
  'end'|'start' }` (`captionReveal` defaults to `end`, Decided). The publishId in use is recorded at session start (and optionally pinned in the experiment), so
  every session is reproducible.
- **What each agent knew is data**: each reveal batch is written as an agent event (`perception.revealed`, item ids
  and the video time) to `experiment_events_v2`, so analyses can reconstruct the agent's knowledge at any moment.
- **Queries by time**:
  - Researchers and tools (v3, `read:perception`): `GET /api/v3/videos/:id/timeline?from=&to=&kinds=&publish=`,
    `.../timeline/at?t=` (shot, who is on screen, the last utterance, the summary at t), `.../timeline/search?q=&to=`
    (transcript, captions, names). Any range.
  - Agents in a session: the same functions in-process, with `to` clamped to the room's watched intervals by the
    engine, never by the prompt. Agent-callable tools (`recall(query)`, `what_happened(from, to)`) need a tool-result
    loop the agent runtime does not have; a later phase, limited to in-process agents first.

### 9. Python: push and pull through the SDK

For researchers who analyse annotations in Python, and for scripts that bring labels in (hand codes from another
tool, a lab's own detector) as edits. Two layers, so that the rules that make a bundle readable exist once in Python:

- **The reader** is BACKEND_PLAN step 3, in hyperstudy-perception's light bundle package
  (`pipeline/bundle`, `hyperstudy-perception-bundle`, today `validate.py` with jsonschema only), published to PyPI:
  - load a bundle folder, with paths checked as `bundle::safe_path` does and manifest entries without `file`, `bytes`
    and `sha256` refused;
  - read `perception-corrections/1`, `/2` and `/3` (unknown fields ignored), `live()` and `fold` giving what
    `corrections.ts` gives, `perception-annotated/1` from them;
  - tables (faces, speakers, captions, ...), raw and corrected side by side.

  It has no HyperStudy dependency, so it reads a bundle from the app, from a run or from HyperStudy alike. Its
  Python floor drops from 3.11 to 3.9, the SDK's (to verify: nothing in `validate.py` needs newer syntax, and
  `jsonschema` 4.23 supports 3.9). The perception CLI (3.12 and up, with `av`) can never be the SDK's dependency.
- **The SDK** (hyperstudy-pythonsdk) gains a `perception` module over the v3 routes of section 6 (phase 5a) and adds
  no routes of its own:
  - `videos.find(sha256=...)`, `videos.list(...)` with the perception status;
  - `bundles.list(video_id)`, `bundles.download(video_id, manifest=None, dest=...)`, which writes the folder layout an
    app export has and skips files whose sha256 already matches. `manifest=None` means the video's
    `perception.bundle`.
  - `ops.pull(video_id, manifest, after=0)` returns op dicts with `seq` and `author`.
  - `ops.push(video_id, manifest, ops)` fills `op_id` (uuid4), `batch` (one per call unless given), `at` and `base`,
    checks each op's kind and fields against the op schema before sending, and returns the seqs. It is idempotent by
    `op_id`, so a script retried after a timeout never doubles an edit.
  - `ops.undo(video_id, manifest, batches)` appends a revert, of the user's own batches only, as in section 4.
  - `annotation(video_id)` downloads, pulls and folds through the reader. `.tables()` gives DataFrames (pandas is
    already an SDK dependency), `.annotated()` gives the `perception-annotated/1` dict, and `.to_folder()` gives a
    folder that the desktop app imports.
  - Later: `timeline(video_id, start, end, kinds)` (phase 6's routes) and `runs.start` / `runs.get` (phase 4).
- **Scopes** are those of section 6: `read:perception` to pull, `write:perception` to push, and `read:media` for the
  video's URL. A key acts as its user, so a script sees exactly what that person sees in the browser.
- **One `fold` per language, held together by fixtures.** The fixtures live in the annotator repo
  (`packages/annotator/fixtures/corrections/`: a synthetic bundle manifest, an op log, the expected fold and the
  expected annotated result). The TS tests read them in place, and the reader's CI checks them out at a pinned
  annotator tag. One fixture is a log as HyperStudy serves it (`seq`, `author`), so the server's shape is covered too.
  A change to a fixture is a release of both.
- **SDK rules apply.** Patch versions only (0.5.0 was yanked). The new routes go into the v3 OpenAPI spec with a test
  that holds the spec to the handlers, as `openapiExperimentFields.test.js` does for experiment fields, before the
  SDK is cut against them.

## Phases

| # | Change | Repo | Depends on | Verify |
|---|---|---|---|---|
| 1 | sha256 on videos (on upload + backfill); S3 layout; Firestore docs; internal read routes; a script that uploads a bundle made on the Mac to a video | hyperstudy | — | a 2-min clip's bundle uploaded and listed; viewer of another org refused; sha256 equals `shasum -a 256` |
| 2 | **Done 2026-11-06** (#63; 0.1.0 on npm 2026-11-07). Annotator as a package (workspace, Tauri split, published); `perception-corrections/3` (ids, batches, revert) in the app with a SQLite migration | annotator | — | app unchanged in Chrome and natively; `/2` files import; undo across a reload |
| 3 | Annotator page in HyperStudy: `hyperstudySource`, ops routes, Socket.IO room, carry-over enforced server-side | hyperstudy | 1, 2 | two browsers editing one video see each other's edits; a viewer cannot write; screenshots |
| 4 | Video features panel (consent, the organization's keys via `resolveProviderKey`, budget); runner: image, Job per run with its own Secret, "Extract features", progress, completion with validation, cost recorded; then extraction of new uploads | perception, hyperstudy | 1 | a real run on RunPod from staging; Job killed mid-run → pod gone by its deadline, run marked failed |
| 5a | v3 scopes (`read:media`, `read:perception`, `write:perception`) and the v3 routes of section 6, in the OpenAPI spec | hyperstudy | 1, 3 | a key whose user cannot view the video gets 404 from every route; a retried push returns the same seqs |
| 5b | Desktop sync: Settings > HyperStudy, Library section, sync loop, Send to HyperStudy | annotator | 2, 5a | edit offline in the app, reconnect, see it in HyperStudy; and the reverse |
| 5c | Python: the reader (BACKEND_PLAN step 3) in `hyperstudy-perception-bundle`, floor 3.9, on PyPI, with the shared fixtures; the SDK's `perception` module (section 9) | perception, pythonsdk, annotator (fixtures) | 2; 5a for the SDK | fixtures pass in TS and Python; an op pushed from Python appears live in an open annotator page; pull + fold equals the page's annotated export |
| 6 | Publish: `perception-timeline/1`, prefix-closed summaries, v3 timeline queries | hyperstudy (+ package) | 1, 2 | a test that no checkpoint's input includes an item revealed after its `at`; queries on a published clip |
| 7 | Agents: playback in the reducer, watched intervals, snapshot `video`, prompt section, voice context, spec 0.4.0, `perception.revealed` events; V2 only (agents run only on V2) | hyperstudy | 6 | parity-style test of seeks (forward skip, backward keep); a session with a text agent asked about the scene just watched and about one not yet watched |
| 8 | Later: `--input-url`/`--deliver` in perception; agent tools with a tool-result loop; unprompted remarks | perception, hyperstudy | 4, 7 | |

1 and 2 can start together. 5a–5c and 6–7 are independent of each other; if agents come first, 6–7 can follow 3 with
bundles uploaded by the phase-1 script before the runner exists. 5c's reader needs only 2 and can start at any time;
the SDK half waits for 5a. 5b and 5c share 5a's routes, so the desktop app and Python see one API.

## Open questions

- **Licences, once HyperStudy charges** (deferred, Decided): which account types may run `academic-only` layers
  (py-feat, ArcFace, RTMW, Gaze-LLE), and whether Meta's SAM 3 and DINOv3 terms allow the use. The answer goes in
  `perceptionFeaturesFor(org)`.
- **A shared Hugging Face token**: the token is one member's, so the organization's runs use that person's access to
  gated models. Whether the panel should say so to the member who shares it.
- **HyperStudy-provided accounts** as an option for groups that do not want their own (Decided: not now).
- **Pushing from Python at scale**: whether a bulk import (thousands of ops) needs its own route or a cap per call, and
  whether those ops show to open editors as one batch. Decide in 5a with a measured push of a long film's labels.

## Unverified

- That the compiled package's `session.svelte.ts` runs under Node for the backend derivation (gate in phase 6).
- CloudFront custom policies with a wildcard resource through `cloudFrontService`.
- `perception remote run runpod` started from a Linux container in DigitalOcean (it has run from the Mac; the
  coordinator itself already runs on Linux pods).
- Bundle sizes for long films over CloudFront in the browser (BACKEND_PLAN's Parquet side files help; the timeline
  view at 2 hours is not measured).
- Whether a host-less room (agents only) needs its own clock; this plan assumes a human host drives `_playback`.
