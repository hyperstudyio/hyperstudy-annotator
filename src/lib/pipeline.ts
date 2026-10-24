// Running the perception pipeline from the app (src-tauri/src/pipeline.rs drives `perception --json`, whose
// protocol is docs/cli-json.md in hyperstudy-perception): the folder, the graphs, a plan, then a run's messages.
// The dialog only sees PipelineApi; browser mode's ?pipeline-demo uses a scripted stand-in (pipeline.fake.ts).
import type { BundleSummary } from './types';

export interface Download { id: string; source: string | null; size_gb: number | null; gated: boolean; licence_mode: string }
export interface PlanNode {
  id: string; uses: string; where: string | null; why_not: string; cached: boolean;
  downloads: Download[]; missing_secrets: string[]; cost_usd: number; cost_note: string;
}
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
  plan(graph: string, video: string): Promise<Plan>;
  /** Start a run; `on` receives its messages until `imported` or `error`. Resolves to a function that stops listening. */
  run(graph: string, video: string, allowDownloads: boolean, on: (m: PipelineMessage) => void): Promise<() => void>;
  cancel(run: string): Promise<void>;
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

/** Why a run cannot start, one line per problem; empty when it can. The CLI's own rule (plan.ok): every node needs a
 *  place to run here (cached ones too: the CLI checks the whole graph), its secrets, and any download allowed. */
export function blockers(plan: Plan, allowDownloads: boolean): string[] {
  return plan.nodes.flatMap((n) => [
    ...(n.where ? [] : [`${n.id} cannot run here${n.why_not ? `: ${n.why_not}` : ''}`]),
    ...n.missing_secrets.map((k) => `${n.id} needs ${k}`),
    ...(n.downloads.length && !allowDownloads ? [`${n.id} needs a model download (tick the box below the plan)`] : []),
  ]);
}

export const runnable = (plan: Plan, allowDownloads: boolean) => !blockers(plan, allowDownloads).length;

export async function tauriPipeline(): Promise<PipelineApi> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const { open } = await import('@tauri-apps/plugin-dialog');
  return {
    folder: () => invoke<string | null>('get_pipeline_folder'),
    setFolder: (path) => invoke<Doctor>('set_pipeline_folder', { path }),
    doctor: () => invoke<Doctor>('pipeline_doctor'),
    graphs: () => invoke<GraphPreset[]>('pipeline_graphs'),
    plan: (graph, video) => invoke<Plan>('pipeline_plan', { graph, video }),
    async run(graph, video, allowDownloads, on) {
      const unlisten = await listen<PipelineMessage>('pipeline', (e) => on(e.payload));   // before starting: no message is missed
      try { await invoke('pipeline_run', { graph, video, allowDownloads }); } catch (e) { unlisten(); throw e; }
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
