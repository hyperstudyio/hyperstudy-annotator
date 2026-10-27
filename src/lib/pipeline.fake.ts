// A scripted stand-in for the pipeline, for browser mode (?pipeline-demo): the dialog's screens can be checked in a
// browser, where Tauri is absent. The real path is tested in Rust against the real CLI (pipeline.rs).
import type { CloudStatus, Doctor, GraphPreset, Host, KeyStatus, Plan, PipelineApi, PipelineMessage, SetupStatus, SetupStep, SshOverrides } from './pipeline';

const doctor: Doctor = {
  platform: 'darwin/arm64', cpu_cores: 14, memory_gb: 128, accelerators: ['cpu', 'mps'], vram_gb: 128,
  pipeline: { version: '0.1.0', commit: 'd09d9643f1f2ab72853a7b1723255a9826582fa2', root: '/Users/you/Library/Application Support/io.hyperstudy.annotator/tools/hyperstudy-perception/lib/python3.12/site-packages/perception/_pipeline' },
  nodes: [
    { ref: 'core.decode@1.0.0', stage: 'decode', description: 'Probe, shots, keyframes, audio', where: 'native (cpu)', why_not: '' },
    { ref: 'audio.asr@1.0.0', stage: 'asr', description: 'Speech and speakers', where: 'native (mps)', why_not: '' },
    { ref: 'vision.face-track@1.0.0', stage: 'faces', description: 'Face tracks and people', where: 'native (mps)', why_not: '' },
    { ref: 'vlm.shot-captions@1.0.0', stage: 'extract+caption', description: 'Shot captions', where: 'native (cpu)', why_not: '' },
  ],
};
const graphs: GraphPreset[] = [
  { file: 'full.yaml', pipeline: 'perception-full', description: 'Everything the pipeline can do.' },
  { file: 'faces.yaml', pipeline: 'perception-faces', description: 'Decode and face tracks.' },
  { file: 'mvp-captions.yaml', pipeline: 'perception-mvp-captions', description: 'Decode, speech, faces and shot captions (Claude Haiku).' },
];
// mirrors the nodes in hyperstudy-perception (titles, models, outputs and settings from their manifests), on a Mac
const plan: Plan = {
  ok: false, estimated_usd: 0.156, nodes: [
    { id: 'decode', needs: [], title: 'Shots and audio', description: 'Video identity and timing, shots, keyframes and 16 kHz mono audio',
      outputs: { media: 'media.v1', shots: 'bundle.shots@0.1', keyframes: 'assets.v1', audio: 'audio.wav.v1' }, settings: [],
      models: [{ id: 'PySceneDetect AdaptiveDetector', source: null, licence_mode: 'commercial-ok', size_gb: null }],
      uses: 'core.decode@1.0.0', where: 'native (cpu)', why_not: '', cached: true, downloads: [], missing_secrets: [], cost_usd: 0, cost_note: '', uploads: [],
      service: null, place: 'native:cpu', options: ['native:cpu'], estimate_s: null, estimate_basis: '' },
    { id: 'asr', needs: ['decode'], title: 'Speech transcript', description: 'Word-timed transcript and utterances (Parakeet TDT v3); voices come from diarization',
      outputs: { transcript: 'bundle.transcript@0.1' }, settings: [],
      models: [{ id: 'mlx-community/parakeet-tdt-0.6b-v3', source: 'hf://mlx-community/parakeet-tdt-0.6b-v3', licence_mode: 'commercial-ok', size_gb: 2.3 }],
      uses: 'audio.asr@1.0.0', where: 'native (mps)', why_not: '', cached: false,
      downloads: [{ id: 'mlx-community/parakeet-tdt-0.6b-v3', source: 'hf://mlx-community/parakeet-tdt-0.6b-v3', size_gb: 2.3, gated: false, licence_mode: 'commercial-ok' }],
      missing_secrets: [], cost_usd: 0, cost_note: '', uploads: [], service: null, place: 'native:mps', options: ['native:mps'],
      estimate_s: 1.8, estimate_basis: 'median of 4 runs of audio.asr@1.0.0 on native:mps here' },
    { id: 'faces', needs: ['decode'], title: 'Face tracks', description: 'Face tracks within shots, identity clusters across the video (py-feat + ArcFace), crops',
      outputs: { faces: 'bundle.faces@0.1', crops: 'assets.v1' }, settings: [],
      models: [{ id: 'py-feat Detectorv2 (RetinaFace + multitask)', source: 'py-feat==2.1.5 (weights from hf://py-feat)', licence_mode: 'academic-only', size_gb: null },
        { id: 'ArcFace (InsightFace, via py-feat)', source: 'py-feat==2.1.5', licence_mode: 'academic-only', size_gb: null }],
      uses: 'vision.face-track@1.0.0', where: 'native (mps)', why_not: '', cached: false, downloads: [], missing_secrets: [], cost_usd: 0, cost_note: '', uploads: [],
      service: null, place: 'native:mps', options: ['native:mps'], estimate_s: 96, estimate_basis: 'median of 3 runs of vision.face-track@1.0.0 on native:mps here',
      estimates: { 'native:mps': { estimate_s: 96, estimate_basis: 'median of 3 runs of vision.face-track@1.0.0 on native:mps here' } } },
    { id: 'captions', needs: ['decode', 'asr', 'faces'], title: 'Shot captions', service: 'Anthropic API',
      description: 'Per-shot descriptions from keyframes (faces boxed and labelled), speech and the face roster; on-screen text',
      outputs: { shots: 'bundle.shots@0.1', text: 'bundle.text@0.1' },
      models: [{ id: 'claude-haiku-5-5', source: null, licence_mode: 'api-terms', size_gb: null }, { id: 'claude-opus-5-5', source: null, licence_mode: 'api-terms', size_gb: null }],
      settings: [{ key: 'model', description: 'bake-off choice: Haiku 5.5 with the face roster', value: 'claude-haiku-5-5', choices: ['claude-haiku-5-5', 'claude-opus-5-5'],
        prices: { 'claude-haiku-5-5': 0.003, 'claude-opus-5-5': 0.12 }, per: 'shot' },
        { key: 'effort', description: '', value: 'medium', choices: ['low', 'medium', 'high'], prices: null, per: null }],
      uses: 'vlm.shot-captions@1.0.0', where: 'native (cpu)', why_not: '', cached: false, downloads: [], missing_secrets: [], cost_usd: 0.156, cost_note: '',
      uploads: ['frames', 'faces', 'transcript'], place: 'native:cpu', options: ['native:cpu'], estimate_s: 176.1, estimate_basis: 'median of 2 runs of vlm.shot-captions@1.0.0 on native:cpu here' },
  ],
};
/** For `twoPlaces`: faces on a machine where it has two places to choose from (an NVIDIA GPU, measured, or the CPU, not yet). */
const twoPlaces = (faces: Plan['nodes'][number], cpu: boolean) => ({ ...faces, options: ['native:cuda', 'native:cpu'], place: cpu ? 'native:cpu' : 'native:cuda',
  where: cpu ? 'native (cpu)' : 'native (cuda)', estimate_s: cpu ? null : 96,
  estimate_basis: cpu ? 'no runs of vision.face-track@1.0.0 on native:cpu here yet' : 'median of 3 runs of vision.face-track@1.0.0 on native:cuda here',
  estimates: { 'native:cuda': { estimate_s: 96, estimate_basis: 'median of 3 runs of vision.face-track@1.0.0 on native:cuda here' },
    'native:cpu': { estimate_s: null, estimate_basis: 'no runs of vision.face-track@1.0.0 on native:cpu here yet' } } });
/** For `remote` (perception #15/#16): faces can also run on a lab server over SSH or on a cloud GPU; the plan says where
 *  each place sends what, what it costs, and the places' titles. Its inputs (the video, the shots layer, which can carry
 *  captions) go to the machine it runs on. */
const LAB = 'lab (SSH)', CLOUD = 'Cloud GPU (AWS L4)', RUNPOD = 'Cloud GPU (RunPod)';
const remotePlaces = { 'native:mps': { title: 'This machine', remote: false, accelerator: 'mps' }, 'native:cpu': { title: 'This machine', remote: false, accelerator: 'cpu' },
  'ssh-lab:cuda': { title: LAB, remote: true, accelerator: 'cuda' }, 'cloud:cuda': { title: CLOUD, remote: true, accelerator: 'cuda' },
  'runpod:cuda': { title: RUNPOD, remote: true, accelerator: 'cuda' } };
const labHost = (name: string, dest: string): Host => ({ name, dest, root: `/home/you/.cache/hyperstudy-perception`, probed_at: 1792800000,
  caps: { platform: 'linux/amd64', cpu_cores: 32, memory_gb: 251.6, accelerators: ['cpu', 'cuda'], vram_gb: 47.5, tools: { uv: '/home/you/.local/bin/uv', ffmpeg: '/usr/bin/ffmpeg', ffprobe: '/usr/bin/ffprobe' } } });
function remote(n: Plan['nodes'][number], place: string | undefined, hosts: Host[] = [labHost('lab', 'you@lab')], cloudOn = true, runpodOn = false): Plan['nodes'][number] {
  if (n.id !== 'faces') return { ...n, upload_to: n.service ?? null, estimates: n.estimates ?? Object.fromEntries((n.options ?? []).map((o) => [o, { estimate_s: n.estimate_s ?? null, estimate_basis: n.estimate_basis ?? '', cost_usd: 0, uploads: n.uploads, upload_to: n.service ?? null }])) };
  const sent = ['faces', 'transcript', 'video'];
  const estimates: Record<string, { estimate_s: number | null; estimate_basis: string; cost_usd: number; uploads: string[]; upload_to: string | null }> = {
    'native:mps': { estimate_s: 96, estimate_basis: 'median of 3 runs of vision.face-track@1.0.0 on native:mps here', cost_usd: 0, uploads: [], upload_to: null },
    ...Object.fromEntries(hosts.map((h) => [`ssh-${h.name}:cuda`, { estimate_s: null, estimate_basis: `no runs of vision.face-track@1.0.0 on ssh-${h.name}:cuda here yet`, cost_usd: 0, uploads: sent, upload_to: `${h.name} (SSH)` }])),
    ...(cloudOn ? { 'cloud:cuda': { estimate_s: null, estimate_basis: 'no runs of vision.face-track@1.0.0 on cloud:cuda here yet', cost_usd: 0.4888, uploads: sent, upload_to: CLOUD } } : {}),
    ...(runpodOn ? { 'runpod:cuda': { estimate_s: null, estimate_basis: 'no runs of vision.face-track@1.0.0 on runpod:cuda here yet', cost_usd: 0.345, uploads: sent, upload_to: RUNPOD } } : {}),
  };
  // a place it cannot run (a machine since removed) is refused, as the CLI refuses it
  if (place && !(place in estimates)) throw new Error(`the pipeline cannot plan this: ${place} is not one of the places faces can run`);
  const at = place ?? 'native:mps';
  const e = estimates[at];
  return { ...n, options: Object.keys(estimates), place: at, where: at.replace(':', ' (') + ')', estimates, estimate_s: e.estimate_s, estimate_basis: e.estimate_basis,
    cost_usd: e.cost_usd, uploads: e.uploads, upload_to: e.upload_to };
}
const ev = (node: string | null, kind: string, message = ''): PipelineMessage => ({ v: 1, type: 'event', run: 'demo-run', node, kind, message, at: null });
const script: PipelineMessage[] = [
  { v: 1, type: 'run.created', run: 'demo-run', store: '~/.hyperstudy-perception' },
  ev('decode', 'task.cached', '5ccfe2d78fac'),
  ev('asr', 'task.started', 'attempt 1 on native (mps)'),
  ev('faces', 'task.started', 'attempt 1 on native (mps)'),
  ev('asr', 'task.succeeded', '5.2 s'),
  ev('faces', 'task.retry', 'attempt 1 failed (the node exited without a response); retry in 2 s'),
  ev('faces', 'task.started', 'attempt 2 on native (mps)'),
  ev('faces', 'task.succeeded', '96.1 s'),
  ev('captions', 'task.started', 'attempt 1 on native (cpu)'),
  ev('captions', 'task.succeeded', '149.4 s'),
  ev(null, 'run.succeeded'),
  { v: 1, type: 'run.finished', run: 'demo-run', status: 'succeeded' },
  { v: 1, type: 'imported', run: 'demo-run', bundle: { id: 'demo-bundle', title: 'clip', video_sha256: 'f'.repeat(64), schema_version: '0.1.0', created_at: null,
    imported_at: '', layers: {}, video_path: '/videos/clip.mp4', corrections: 0, manifest_sha256: 'e'.repeat(64) } },
];

/** `rejectRun`: the app refuses to start the run (as when another run is in progress). `slowStart`: the first message
 *  takes a long time (a first environment sync), so the run can be canceled before it has an id. `noNeeds`: a CLI
 *  from before plans said what each node needs. `oldCli`: one from before plans carried places, estimates or needs.
 *  `twoPlaces`: a machine where faces can run in two places (the place menu). `summary`: a free, local feature that
 *  needs captions (which sends data off): turning it on brings captions along. `remote`: faces can also run on a lab
 *  server or a cloud GPU (perception #15/#16). `setup`: the first launch's setup still running (it finishes after `setupMs`), or failed (a retry then succeeds). `machinesError`: listing the machines fails (not an older pipeline). `noCloud`: lab servers but no cloud (perception #15 without #16). `keysError`: listing the CLI's keys fails (not an older pipeline). `gated`: a step's model is gated on Hugging Face. `hfStored`: a Hugging Face key is in the keychain (saved in 0.0.2, which listed every key). A key starting "rejected" is refused, as its provider refuses a wrong one. `oldChecks`: a pipeline from before keys check, cloud check and hosts probe. A destination containing "unreachable" cannot be reached. `runs` records each run's arguments, and `added` each server added with its overrides, for tests. */
const KEYS = [
  { name: 'RUNPOD_API_KEY', label: 'RunPod', purpose: 'Cloud GPU pods', url: 'https://console.runpod.io/user/settings' },
  { name: 'ANTHROPIC_API_KEY', label: 'Anthropic', purpose: 'Shot captions (Claude)', url: 'https://console.anthropic.com/settings/keys' },
  { name: 'HF_TOKEN', label: 'Hugging Face', purpose: 'Model downloads (gated models, higher limits)', url: 'https://huggingface.co/settings/tokens' },
];

export function fakePipeline(stepMs = 400, { rejectRun = false, slowStart = false, noNeeds = false, oldCli = false, twoPlaces: twoPlaces_ = false, summary = false, remote: remote_ = false, machinesError = false, noCloud = false, keysError = false, missingKey = false, gated = false, hfStored = false, oldChecks = false, setup = 'done' as 'done' | 'installing' | 'install-failed' | 'running' | 'failed', setupMs = 1500 } = {},
                             runs: { allow: unknown; places: unknown; maxCostUsd: number | null; settings?: unknown }[] = [],
                             added: { name: string; dest: string; overrides?: SshOverrides }[] = []): PipelineApi {
  const step = (node: string, what: string, ok = true, message = ''): SetupStep => ({ node, what, ok, seconds: 2, message });
  let installed = setup !== 'installing' && setup !== 'install-failed';   // a first launch offline has none
  let status: SetupStatus = setup === 'done' ? { state: 'done', steps: [], problem: null, notice: null, installed }
    : setup === 'installing' ? { state: 'installing', steps: [], problem: null, notice: null, installed }
    : setup === 'install-failed' ? { state: 'failed', steps: [], problem: 'uv could not install the pipeline: error: Failed to fetch: https://pypi.org/simple/hyperstudy-perception/', notice: null, installed }
    : setup === 'running' ? { state: 'running', steps: [step('core.decode@1.0.0', 'environment')], problem: null, notice: null, installed }
    : { state: 'failed', steps: [step('vision.face-track@1.0.0', 'environment', false, 'could not fetch torch')], problem: 'environment vision.face-track@1.0.0: could not fetch torch', notice: null, installed };
  const setupListeners = new Set<(s: SetupStatus) => void>();
  const setStatus = (s: SetupStatus) => { status = s; setupListeners.forEach((on) => on(s)); };
  const finish = () => setTimeout(() => (installed = true) && setStatus({ state: 'done', steps: [...status.steps, step('audio.asr@1.0.0', 'environment')], problem: null, notice: null, installed }), setupMs);
  if (setup === 'running' || setup === 'installing') finish();
  // the machines `perception hosts` and `perception cloud` keep: in remote mode a lab server and the cloud to start with
  let hosts: Host[] = remote_ ? [labHost('lab', 'you@lab')] : [];
  const stored = new Map<string, string>(hfStored ? [['HF_TOKEN', 'hf_saved_in_0_0_2']] : []);
  const keyStatus = (): KeyStatus[] => KEYS.map((k) => ({ ...k, stored: stored.has(k.name) }));
  const cloud: CloudStatus = { enabled: remote_, machine: 'AWS g6.2xlarge, NVIDIA L4', region: 'us-east-1', hourly_usd: 0.9776,
    runpod: { enabled: false, machine: 'RunPod, one of L4, RTX 4090, RTX A5000', region: 'any', hourly_usd: 0.69 } };
  const unchecked = (cmd: string) => { if (oldChecks) throw new Error(`the pipeline failed: perception: error: argument action: invalid choice: '${cmd}'`); };
  const older = (cmd = 'hosts') => { if (oldCli || (cmd === 'cloud' && noCloud)) throw new Error(`the pipeline failed: perception: error: argument cmd: invalid choice: '${cmd}'`); };
  let listener: ((m: PipelineMessage) => void) | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];
  return {
    setupStatus: async () => status,
    async onSetup(on) { setupListeners.add(on); return () => setupListeners.delete(on); },
    async retrySetup() { setStatus({ state: installed ? 'running' : 'installing', steps: [], problem: null, notice: null, installed }); finish(); },
    async doctor() { if (!installed) throw new Error('the pipeline is not installed yet: the app installs it when it starts'); return doctor; },
    graphs: async () => oldCli ? graphs.filter((g) => g.file !== 'full.yaml') : graphs,   // an older pipeline has no full graph
    async plan(_graph, _video, places, settings) {
      await (globalThis as { __holdPlan?: Promise<void> }).__holdPlan;   // tests: plans held back, so choices overlap
      const refused = (globalThis as { __refusePlace?: string }).__refusePlace;   // tests: a place the app or CLI refuses
      if (refused && Object.values(places).includes(refused)) throw new Error(`not a node and a place: "faces" = "${refused}"`);
      if (oldCli) return { ...plan, nodes: plan.nodes.map(({ needs, place, options, estimates, estimate_s, estimate_basis, title, service, description, outputs, models, settings, ...n }) => n) };
      const opus = settings.captions?.model === 'claude-opus-5-5';   // 52 shots: $0.003 or $0.12 each
      const nodes = plan.nodes.map((n) => n.id === 'captions' ? { ...n, cost_usd: opus ? 6.24 : 0.156,
        settings: n.settings!.map((x) => x.key === 'model' ? { ...x, value: opus ? 'claude-opus-5-5' : 'claude-haiku-5-5' } : x) }
        : n.id === 'faces' && twoPlaces_ ? twoPlaces(n, places.faces === 'native:cpu') : n)
        .map((n) => remote_ ? remote(n, places[n.id], hosts, cloud.enabled, cloud.runpod!.enabled) : n)
        // missingKey: the captions step has no Anthropic key until one is saved
        .map((n) => missingKey && n.id === 'captions' && !stored.has('ANTHROPIC_API_KEY') ? { ...n, missing_secrets: ['ANTHROPIC_API_KEY'] } : n);
      const all = summary ? [...nodes, { id: 'summary', needs: ['captions'], title: 'Summary', uses: 'test.summary@1.0.0', where: 'native (cpu)', why_not: '', cached: false,
        downloads: [], missing_secrets: [], cost_usd: 0, cost_note: '', uploads: [], place: 'native:cpu', options: ['native:cpu'], estimate_s: 3, estimate_basis: '' }] : nodes;
      const extra = remote_ ? { places: { ...remotePlaces, ...Object.fromEntries(hosts.map((h) => [`ssh-${h.name}:cuda`, { title: `${h.name} (SSH)`, remote: true, accelerator: 'cuda' }])) }, max_cost_usd: 0.5, estimated_usd: all.reduce((a, n) => a + (n.cached ? 0 : n.cost_usd), 0) } : {};
      return { ...plan, ...extra, nodes: noNeeds ? all.map(({ needs: _, ...n }) => n) : all };
    },
    async run(_graph, _video, allow, places, only, settings, maxCostUsd, on) {
      if (rejectRun) throw new Error('a pipeline run is already in progress');
      if (status.state === 'running') throw new Error('the pipeline is still being set up: the run can start when it is done');
      runs.push({ allow, places, maxCostUsd, settings });
      listener = on;
      const first = slowStart ? 60_000 : 0;
      const ran = script.filter((m) => m.type !== 'event' || !m.node || !only || only.includes(m.node));   // as --only does
      timers = ran.map((m, i) => setTimeout(() => on(m), first + stepMs * (i + 1)));   // the demo's pacing
      return () => timers.forEach(clearTimeout);
    },
    async cancel(run) {
      timers.forEach(clearTimeout);
      listener?.(run ? { v: 1, type: 'run.finished', run, status: 'canceled' }
        : { v: 1, type: 'error', problems: ['the pipeline ended without finishing the run (stopped)'] });
    },
    async hosts() { older(); if (machinesError) throw new Error('the pipeline failed: PermissionError: hosts.json'); return hosts; },
    async host(action, name, dest, _root, overrides) {
      older();
      // a test can hold an action open (a clean or a check over a slow link)
      await (globalThis as { __holdHost?: Promise<void> }).__holdHost;
      if (action === 'add') {
        if (!dest || dest.includes('unreachable')) throw new Error(`could not reach ${dest} (ssh exit 255): ssh: connect to host ${dest} port 22: Operation timed out`);
        added.push({ name, dest, overrides });
        hosts = [...hosts.filter((h) => h.name !== name), labHost(name, dest)];   // as the CLI does: an existing name is replaced
      } else if (action === 'remove') hosts = hosts.filter((h) => h.name !== name);
      // a test can have the host re-added elsewhere under the same name (with the CLI), which a check then finds
      else if (action === 'check' && (globalThis as { __gpuGone?: boolean }).__gpuGone)
        hosts = hosts.map((h) => h.name === name ? { ...h, caps: { ...h.caps, accelerators: ['cpu'], vram_gb: 0 } } : h);
      else if (action === 'check' && (globalThis as { __readdedElsewhere?: boolean }).__readdedElsewhere)
        hosts = hosts.map((h) => h.name === name ? labHost(name, 'you@another-lab.example.edu') : h);
      return hosts;
    },
    async probeHost(dest) {
      unchecked('probe');
      await (globalThis as { __holdHost?: Promise<void> }).__holdHost;
      if (dest.includes('unreachable')) throw new Error(`the pipeline failed: could not reach ${dest} (ssh exit 255): ssh: connect to host ${dest} port 22: Operation timed out`);
      const h = labHost('probe', dest);
      return { dest, root: h.root, caps: h.caps };
    },
    sshHosts: async () => ['lab-gpu', 'biowulf'],
    async checkCloud(provider) {
      unchecked('check');
      const key = stored.get('RUNPOD_API_KEY');   // the key it checks is the one when it starts
      await (globalThis as { __holdCheck?: Promise<void> }).__holdCheck;   // tests: an answer held back (a slow network)
      if (provider === 'runpod') return !key ? { ok: false, detail: 'no RunPod API key' } : key.startsWith('rejected') ? { ok: false, detail: 'RunPod did not accept the key in RUNPOD_API_KEY (401)' } : { ok: true, detail: 'runpod can be used' };
      return { ok: true, detail: 'aws can be used' };
    },
    async checkKey(name) {
      unchecked('check');
      const key = stored.get(name), who = KEYS.find((k) => k.name === name)!.label;
      return !key ? { ok: false, detail: `${name} is not set` } : key.startsWith('rejected') ? { ok: false, detail: `${who} refused the key` } : { ok: true, detail: `${who} accepted the key` };
    },
    // RunPod, as `perception cloud on runpod`: refused without a key it accepts
    async cloud(on, provider = 'aws') {
      older('cloud');
      if (on && provider === 'runpod' && !stored.has('RUNPOD_API_KEY'))
        throw new Error('the pipeline failed: no RunPod API key: create one at https://console.runpod.io/user/settings');
      if (on && provider === 'runpod' && stored.get('RUNPOD_API_KEY')!.startsWith('rejected'))
        throw new Error('the pipeline failed: RunPod did not accept the key in RUNPOD_API_KEY (401 Unauthorized)');
      if (on !== undefined) { if (provider === 'runpod') cloud.runpod!.enabled = on; else cloud.enabled = on; }
      return { ...cloud, runpod: { ...cloud.runpod! } };
    },
    async models() {
      older('models');
      const all = plan.nodes.flatMap((n) => (n.models ?? []).map((m) => ({ node: n.uses, ...m, gated: false })));
      // the steps, as the pipeline describes them (an older one gives only the models)
      const nodes = oldChecks ? null : plan.nodes.map((n) => ({ node: n.uses, title: n.title ?? n.id, service: n.service ?? null,
        secrets: n.id === 'captions' ? ['ANTHROPIC_API_KEY'] : [], settings: n.settings ?? [] }));
      // `gated`: a made-up gated model, to show how one asks for access (the pipeline's own models are not gated)
      return { models: gated ? [...all, { node: 'audio.diarize@1.0.0', id: 'pyannote/speaker-diarization-3.1', source: 'hf://pyannote/speaker-diarization-3.1', size_gb: 0.1, gated: true, licence_mode: 'commercial-ok' }] : all,
               nodes: nodes && gated ? [...nodes, { node: 'audio.diarize@1.0.0', title: 'Who speaks', service: null, secrets: [], settings: [] }] : nodes };
    },
    // the app's keychain: names and whether stored (values are kept here only to check none reaches the page)
    async keys() { return keyStatus(); },
    async setKey(name, value) {
      if (!KEYS.some((k) => k.name === name)) throw new Error(`not a key the app keeps: "${name}"`);
      if (!value.trim()) throw new Error('a key is one line of text');
      await (globalThis as { __holdKey?: Promise<void> }).__holdKey;   // tests: the keychain's answer held back
      stored.set(name, value.trim());
      return keyStatus();
    },
    async removeKey(name) { stored.delete(name); return keyStatus(); },
    async cliKeys() { older('keys'); if (keysError) throw new Error('the pipeline failed: PermissionError: keys.json'); return { keys: [{ name: 'HF_TOKEN', source: '~/.config/hyperstudy/bakeoff.env' }], problems: [] }; },
    pickVideo: async () => '/videos/clip.mp4',
  };
}
