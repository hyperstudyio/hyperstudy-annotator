// Running the perception pipeline from the app (src-tauri/src/pipeline.rs drives `perception --json`, whose
// protocol is docs/cli-json.md in hyperstudy-perception): the folder, the graphs, a plan, then a run's messages.
// The dialog only sees PipelineApi; browser mode's ?pipeline-demo uses a scripted stand-in (pipeline.fake.ts).
import type { BundleSummary } from './types';

export interface Download { id: string; source: string | null; size_gb: number | null; gated: boolean; licence_mode: string }
export interface PlanNode {
  id: string; uses: string; where: string | null; why_not: string; cached: boolean;
  downloads: Download[]; missing_secrets: string[]; cost_usd: number; cost_note: string;
  /** Data kinds the node sends off this machine (frames, transcript...); absent from older CLIs. */
  uploads?: string[];
  /** Where it would run (backend:accelerator), and every place it can run here, best first. */
  place?: string | null; options?: string[];
  /** Seconds, from its measured runs on this machine; null with the reason in estimate_basis. */
  estimate_s?: number | null; estimate_basis?: string;
}

/** Where the user moved nodes: node id -> place. */
export type Places = Record<string, string>;
export interface Plan { ok: boolean; estimated_usd: number; nodes: PlanNode[] }
export interface GraphPreset { file: string; pipeline: string; description: string }
export interface Doctor {
  platform: string; cpu_cores: number; memory_gb: number; accelerators: string[]; vram_gb: number;
  nodes: { ref: string; stage: string; description: string; where: string | null; why_not: string }[];
}

export type PipelineMessage = { v: 1 } & (
  | { type: 'run.created'; run: string; store: string }
  | { type: 'event'; run: string; node: string | null; kind: string; message: string; at: string | null }
  | { type: 'run.finished'; run: string; status: string }
  | ({ type: 'plan' } & Plan)
  | { type: 'imported'; run: string; bundle: BundleSummary }
  | { type: 'error'; problems: string[] }
);

export interface PipelineApi {
  folder(): Promise<string | null>;
  /** Check a hyperstudy-perception folder with `perception doctor`, and remember it. */
  setFolder(path: string): Promise<Doctor>;
  doctor(): Promise<Doctor>;
  graphs(): Promise<GraphPreset[]>;
  plan(graph: string, video: string, places: Places): Promise<Plan>;
  /** Start a run; `on` receives its messages until `imported` or `error`. Resolves to a function that stops listening.
   *  The app checks the consent again against a fresh plan before it starts. */
  run(graph: string, video: string, allow: Consent, places: Places, on: (m: PipelineMessage) => void): Promise<() => void>;
  /** Cancel the run in progress: by its id once the CLI has named it, else (null) by stopping the CLI's process. */
  cancel(run: string | null): Promise<void>;
  pickFolder(): Promise<string | null>;
  pickVideo(): Promise<string | null>;
}

export type NodeStateName = 'waiting' | 'cached' | 'running' | 'retrying' | 'succeeded' | 'failed' | 'canceled';
export interface NodeState { state: NodeStateName; message: string }
export interface RunView {
  run: string | null; nodes: Record<string, NodeState>; status: string | null; imported: BundleSummary | null; problems: string[];
}

const STATES: Record<string, NodeStateName> = {
  'task.started': 'running', 'task.cached': 'cached', 'task.retry': 'retrying', 'task.succeeded': 'succeeded',
  'task.failed': 'failed', 'task.canceled': 'canceled',
};
/** The message worth showing in each state: why it failed or retries, how long it took, where it runs. */
const KEEP = new Set<NodeStateName>(['running', 'retrying', 'succeeded', 'failed', 'canceled']);

/** A run's messages folded into what the dialog shows. */
export function foldRun(nodes: string[], msgs: PipelineMessage[]): RunView {
  const v: RunView = { run: null, nodes: Object.fromEntries(nodes.map((n) => [n, { state: 'waiting', message: '' }])), status: null, imported: null, problems: [] };
  for (const m of msgs) {
    switch (m.type) {
      case 'run.created': v.run = m.run; break;
      case 'event': {
        const state = STATES[m.kind];
        if (m.node && state) v.nodes[m.node] = { state, message: KEEP.has(state) ? m.message : '' };
        break;
      }
      case 'run.finished': v.status = m.status; break;
      case 'imported': v.imported = m.bundle; break;
      case 'error': v.problems.push(...m.problems); break;
      case 'plan': if (!m.ok) v.problems.push('the pipeline cannot run this graph here (see the plan)'); break;
    }
  }
  return v;
}

export interface Consent { downloads: boolean; uploads: boolean }

/** Why a run cannot start, one line per problem; empty when it can. The CLI's own rule (plan.ok): every node needs a
 *  place to run here (cached ones too: the CLI checks the whole graph), its secrets, and any download allowed. And the
 *  app's: data leaving this machine is allowed explicitly, like a download, and a plan that does not say what leaves
 *  (a CLI from before plans carried `uploads`) is not run. */
export function blockers(plan: Plan, allow: Consent): string[] {
  return plan.nodes.flatMap((n) => [
    ...(n.where ? [] : [`${n.id} cannot run here${n.why_not ? `: ${n.why_not}` : ''}`]),
    ...n.missing_secrets.map((k) => `${n.id} needs ${k}`),
    ...(n.downloads.length && !allow.downloads ? [`${n.id} needs a model download (tick the box below the plan)`] : []),
    ...(n.uploads === undefined ? [`the pipeline does not say what ${n.id} sends off this machine (update hyperstudy-perception)`]
      : n.uploads.length && !allow.uploads ? [`${n.id} sends ${n.uploads.join(', ')} off this machine (tick the box below the plan)`] : []),
  ]);
}

export const runnable = (plan: Plan, allow: Consent) => !blockers(plan, allow).length;

/** A duration as people say it: "2 s", "1 min 36 s", "1 h 2 min". */
export function duration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/** The plan's estimated time: what will run (cached nodes do not), and the nodes with no estimate yet; null when the
 *  pipeline gives no estimates at all (a CLI from before plans carried them). */
export function totalEstimate(plan: Plan): { seconds: number; unknown: string[] } | null {
  if (!plan.nodes.some((n) => 'estimate_s' in n)) return null;
  const running = plan.nodes.filter((n) => !n.cached);
  return { seconds: running.reduce((a, n) => a + (n.estimate_s ?? 0), 0), unknown: running.filter((n) => n.estimate_s == null).map((n) => n.id) };
}

export async function tauriPipeline(): Promise<PipelineApi> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const { open } = await import('@tauri-apps/plugin-dialog');
  return {
    folder: () => invoke<string | null>('get_pipeline_folder'),
    setFolder: (path) => invoke<Doctor>('set_pipeline_folder', { path }),
    doctor: () => invoke<Doctor>('pipeline_doctor'),
    graphs: () => invoke<GraphPreset[]>('pipeline_graphs'),
    plan: (graph, video, places) => invoke<Plan>('pipeline_plan', { graph, video, places }),
    async run(graph, video, allow, places, on) {
      const unlisten = await listen<PipelineMessage>('pipeline', (e) => on(e.payload));   // before starting: no message is missed
      try { await invoke('pipeline_run', { graph, video, allowDownloads: allow.downloads, allowUploads: allow.uploads, places }); }
      catch (e) { unlisten(); throw e; }
      return unlisten;
    },
    cancel: (run) => invoke<void>('pipeline_cancel', { run }),
    async pickFolder() {
      const dir = await open({ directory: true, title: 'Choose the hyperstudy-perception folder' });
      return typeof dir === 'string' ? dir : null;
    },
    async pickVideo() {
      const file = await open({ title: 'Choose a video', filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv'] }] });
      return typeof file === 'string' ? file : null;
    },
  };
}
