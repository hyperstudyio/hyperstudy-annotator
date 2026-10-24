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
  { file: 'faces.yaml', pipeline: 'perception-faces', description: 'Decode and face tracks.' },
  { file: 'mvp-captions.yaml', pipeline: 'perception-mvp-captions', description: 'Decode, speech, faces and shot captions (Claude Haiku).' },
];
const plan: Plan = {
  ok: false, estimated_usd: 0.156, nodes: [
    { id: 'decode', uses: 'core.decode@1.0.0', where: 'native (cpu)', why_not: '', cached: true, downloads: [], missing_secrets: [], cost_usd: 0, cost_note: '', uploads: [] },
    { id: 'asr', uses: 'audio.asr@1.0.0', where: 'native (mps)', why_not: '', cached: false,
      downloads: [{ id: 'parakeet-tdt-0.6b-v3', source: 'hf://mlx-community/parakeet-tdt-0.6b-v3', size_gb: 2.4, gated: false, licence_mode: 'commercial-ok' }],
      missing_secrets: [], cost_usd: 0, cost_note: '', uploads: [] },
    { id: 'faces', uses: 'vision.face-track@1.0.0', where: 'native (mps)', why_not: '', cached: false, downloads: [], missing_secrets: [], cost_usd: 0, cost_note: '', uploads: [] },
    { id: 'captions', uses: 'vlm.shot-captions@1.0.0', where: 'native (cpu)', why_not: '', cached: false, downloads: [], missing_secrets: [], cost_usd: 0.156, cost_note: '',
      uploads: ['frames', 'faces', 'transcript'] },
  ],
};
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
 *  takes a long time (a first environment sync), so the run can be canceled before it has an id. */
export function fakePipeline(stepMs = 400, { rejectRun = false, slowStart = false } = {}): PipelineApi {
  let folder: string | null = null;
  let listener: ((m: PipelineMessage) => void) | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];
  return {
    folder: async () => folder,
    setFolder: async (path) => { folder = path; return doctor; },
    doctor: async () => doctor,
    graphs: async () => graphs,
    plan: async () => plan,
    async run(_graph, _video, _allow, on) {
      if (rejectRun) throw new Error('a pipeline run is already in progress');
      listener = on;
      const first = slowStart ? 60_000 : 0;
      timers = script.map((m, i) => setTimeout(() => on(m), first + stepMs * (i + 1)));   // the demo's pacing
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
