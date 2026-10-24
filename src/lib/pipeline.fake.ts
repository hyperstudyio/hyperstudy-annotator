// A scripted stand-in for the pipeline, for browser mode (?pipeline-demo): the dialog's screens can be checked in a
// browser, where Tauri is absent. The real path is tested in Rust against the real CLI (pipeline.rs).
import type { Doctor, GraphPreset, Plan, PipelineApi, PipelineMessage } from './pipeline';

const doctor: Doctor = {
  platform: 'darwin/arm64', cpu_cores: 14, memory_gb: 128, accelerators: ['cpu', 'mps'], vram_gb: 128,
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
 *  `twoPlaces`: a machine where faces can run in two places (the place menu). */
export function fakePipeline(stepMs = 400, { rejectRun = false, slowStart = false, noNeeds = false, oldCli = false, twoPlaces: twoPlaces_ = false } = {}): PipelineApi {
  let folder: string | null = null;
  let listener: ((m: PipelineMessage) => void) | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];
  return {
    folder: async () => folder,
    setFolder: async (path) => { folder = path; return doctor; },
    doctor: async () => doctor,
    graphs: async () => oldCli ? graphs.filter((g) => g.file !== 'full.yaml') : graphs,   // an older pipeline has no full graph
    async plan(_graph, _video, places, settings) {
      if (oldCli) return { ...plan, nodes: plan.nodes.map(({ needs, place, options, estimates, estimate_s, estimate_basis, title, service, description, outputs, models, settings, ...n }) => n) };
      const opus = settings.captions?.model === 'claude-opus-5-5';   // 52 shots: $0.003 or $0.12 each
      const nodes = plan.nodes.map((n) => n.id === 'captions' ? { ...n, cost_usd: opus ? 6.24 : 0.156,
        settings: n.settings!.map((x) => x.key === 'model' ? { ...x, value: opus ? 'claude-opus-5-5' : 'claude-haiku-5-5' } : x) }
        : n.id === 'faces' && twoPlaces_ ? twoPlaces(n, places.faces === 'native:cpu') : n);
      return { ...plan, nodes: noNeeds ? nodes.map(({ needs: _, ...n }) => n) : nodes };
    },
    async run(_graph, _video, _allow, _places, only, _settings, on) {
      if (rejectRun) throw new Error('a pipeline run is already in progress');
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
    pickFolder: async () => '/Users/you/Github/hyperstudy-perception',
    pickVideo: async () => '/videos/clip.mp4',
  };
}
