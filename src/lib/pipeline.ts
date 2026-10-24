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
  /** The nodes whose outputs it takes (a stage picker's edges); absent from older CLIs. */
  needs?: string[];
  /** Each of `options` -> its estimate, to compare places before choosing one; absent from older CLIs. */
  estimates?: Record<string, { estimate_s: number | null; estimate_basis: string }>;
  /** What it gives, in a few words ("Face tracks"), and the rest of what its details show; absent from older CLIs. */
  title?: string; service?: string | null; description?: string; outputs?: Record<string, string>;
  models?: { id: string; source: string | null; licence_mode: string; size_gb: number | null }[];
  settings?: Setting[];
}

/** A node setting with a fixed list of choices (a model, an effort), and each choice's price when the cost depends on it. */
export interface Setting { key: string; description: string; value: string | null; choices: string[]; prices: Record<string, number> | null; per: string | null }
/** The settings the user chose: node id -> key -> value. */
export type Settings = Record<string, Record<string, string>>;

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
  plan(graph: string, video: string, places: Places, settings: Settings): Promise<Plan>;
  /** Start a run; `on` receives its messages until `imported` or `error`. Resolves to a function that stops listening.
   *  The app checks the consent again against a fresh plan before it starts. */
  /** `only`: just these nodes (and what they need); null runs the whole graph. */
  run(graph: string, video: string, allow: Consent, places: Places, only: string[] | null, settings: Settings, on: (m: PipelineMessage) => void): Promise<() => void>;
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

/** What a run lets happen: `uploads` is node id -> the kinds of data it may send off this machine. */
export interface Consent { downloads: boolean; uploads: Record<string, string[]> }

/** What a run of these steps lets happen: its models download as part of running, and turning a feature on that sends
 *  data to a cloud API is the choice to send what the plan shows it sends (such features start off, see
 *  defaultFeatures). The app holds a fresh plan to exactly this before it starts, so a step that would send data the
 *  plan on screen did not show is refused. */
export const consentFor = (plan: Plan): Consent => ({
  downloads: true,
  uploads: Object.fromEntries(plan.nodes.filter((n) => n.uploads?.length).map((n) => [n.id, [...n.uploads!]])),
});

/** Why a run cannot start, one line per problem; empty when it can: every node needs a place to run here (cached ones
 *  too: the CLI checks the whole graph) and its secrets, and a plan that does not say what leaves the machine (a CLI
 *  from before plans carried `uploads`) is not run. Nor is a plan whose steps cannot be chosen (no `needs`: it runs
 *  whole) while one of them sends data off: nobody turned that step on. */
export function blockers(plan: Plan): string[] {
  const whole = !canPick(plan);
  return plan.nodes.flatMap((n) => [
    ...(n.where ? [] : [`${n.id} cannot run here${n.why_not ? `: ${n.why_not}` : ''}`]),
    ...n.missing_secrets.map((k) => `${n.id} needs ${k}`),
    ...(n.uploads === undefined ? [`the pipeline does not say what ${n.id} sends off this machine (update hyperstudy-perception)`]
      : whole && n.uploads.length ? [`${n.id} sends ${n.uploads.join(', ')} off this machine and this pipeline cannot leave it out (update hyperstudy-perception)`] : []),
  ]);
}

export const runnable = (plan: Plan) => !blockers(plan).length;

/** The graph that holds every node: the app picks features from it (an older pipeline folder has none). */
export const FULL_GRAPH = 'full.yaml';

/** What runs when the user turned on `wanted`: those features and everything they need (transitively). `neededBy` says,
 *  for each running step that other running steps need, which ones: it cannot be turned off while they run (turned
 *  off, it would come straight back). `only` is what to pass the CLI (null: the whole graph). */
export function picked(plan: Plan, wanted: Set<string>): { chosen: string[]; neededBy: Record<string, string[]>; only: string[] | null } {
  const byId = new Map(plan.nodes.map((n) => [n.id, n]));
  const on = new Set<string>();
  const add = (id: string) => { if (on.has(id) || !byId.has(id)) return; on.add(id); (byId.get(id)!.needs ?? []).forEach(add); };
  wanted.forEach(add);
  const chosen = plan.nodes.filter((n) => on.has(n.id)).map((n) => n.id);
  const neededBy = Object.fromEntries(chosen.map((id) => [id, chosen.filter((c) => (byId.get(c)!.needs ?? []).includes(id))]).filter(([, by]) => by.length));
  return { chosen, neededBy, only: chosen.length === plan.nodes.length ? null : chosen };
}

/** The features on when a plan first shows: those that, with everything they need, keep all on this machine and cost
 *  nothing (a step that sends data off or costs money is the user's choice, and so is a feature that would bring one
 *  along). A plan that does not say what steps need runs whole. */
export function defaultFeatures(plan: Plan): Set<string> {
  if (!canPick(plan)) return new Set(plan.nodes.map((n) => n.id));
  const byId = new Map(plan.nodes.map((n) => [n.id, n]));
  const free = (n: PlanNode, seen = new Set<string>()): boolean => {
    if (seen.has(n.id)) return true;
    seen.add(n.id);
    return !n.uploads?.length && !n.cost_usd && !n.cost_note && (n.needs ?? []).every((u) => !byId.has(u) || free(byId.get(u)!, seen));
  };
  return new Set(plan.nodes.filter((n) => free(n)).map((n) => n.id));
}

/** A setting's choice as its menu shows it: with its price, when the cost depends on it. */
export function choiceLabel(s: Setting, choice: string): string {
  const usd = s.prices?.[choice];
  return usd == null ? choice : `${choice}, $${usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)} per ${s.per}`;
}

/** The settings to send: only for steps that run (a setting for a node --only leaves out is a CLI error). */
export function settingsFor(settings: Settings, chosen: string[]): Settings {
  return Object.fromEntries(Object.entries(settings).filter(([node]) => chosen.includes(node)));
}

/** Can the user choose steps? Only when the plan says what each step needs (a CLI from before plans carried `needs`
 *  would otherwise let a step be left out while what needs it still runs). */
export const canPick = (plan: Plan) => plan.nodes.every((n) => Array.isArray(n.needs));

const ACCELERATORS: Record<string, string> = { mps: 'Apple GPU', cuda: 'NVIDIA GPU', cpu: 'CPU' };
/** A place (backend:accelerator) as people say it: "Apple GPU" here, "NVIDIA GPU on ssh" elsewhere. */
export function placeName(place: string): string {
  const [backend, accelerator = ''] = place.split(':');
  const what = ACCELERATORS[accelerator] ?? accelerator;
  return backend === 'native' || backend === 'self' ? what : `${what} on ${backend}`;
}

/** A place as the menu shows it: with how long the step would take there, when the plan says. */
export function placeLabel(n: PlanNode, place: string): string {
  const e = n.estimates?.[place];
  if (!e) return placeName(place);
  return `${placeName(place)}, ${e.estimate_s != null ? `about ${duration(e.estimate_s)}` : 'no estimate yet'}`;
}

/** The places to send: only for steps that run (a place for a node --only leaves out is a CLI error). */
export function placesFor(places: Places, chosen: string[]): Places {
  return Object.fromEntries(Object.entries(places).filter(([node]) => chosen.includes(node)));
}

/** A duration as people say it: "2 s", "1 min 36 s", "1 h 2 min". */
export function duration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/** When each step that will run starts and how long it takes, in estimated seconds from the run's start: after the
 *  steps it needs (cached ones take no time), as the coordinator runs independent steps side by side. A step with no
 *  estimate has `seconds` null and holds up nothing (what needs it starts when its other inputs are ready). A plan that
 *  does not say what steps need (an older CLI) is drawn one step after another: nothing says which could overlap. */
export function schedule(plan: Plan): Record<string, { start: number; seconds: number | null }> {
  const out: Record<string, { start: number; seconds: number | null }> = {};
  if (!canPick(plan)) {
    let start = 0;
    for (const n of plan.nodes.filter((x) => !x.cached)) { out[n.id] = { start, seconds: n.estimate_s ?? null }; start += n.estimate_s ?? 0; }
    return out;
  }
  const byId = new Map(plan.nodes.map((n) => [n.id, n]));
  const end = (id: string): number => {
    const n = byId.get(id);
    if (!n || n.cached) return 0;
    if (!(id in out)) {
      const start = Math.max(0, ...(n.needs ?? []).map(end));
      out[id] = { start, seconds: n.estimate_s ?? null };
    }
    return out[id].start + (out[id].seconds ?? 0);
  };
  plan.nodes.forEach((n) => end(n.id));
  return out;
}

/** The plan's estimated time: what will run (cached nodes do not), and the nodes with no estimate yet; null when the
 *  pipeline gives no estimates at all (a CLI from before plans carried them). `seconds` is every step one after
 *  another; `fastest`, steps side by side where nothing they need is in the way. A run takes between the two: the
 *  coordinator runs independent steps together only within the machine's CPU, memory and GPU. */
export function totalEstimate(plan: Plan): { seconds: number; fastest: number; unknown: string[] } | null {
  if (!plan.nodes.some((n) => 'estimate_s' in n)) return null;
  const running = plan.nodes.filter((n) => !n.cached);
  const times = Object.values(schedule(plan));
  return { seconds: running.reduce((a, n) => a + (n.estimate_s ?? 0), 0), fastest: Math.max(0, ...times.map((t) => t.start + (t.seconds ?? 0))),
           unknown: running.filter((n) => n.estimate_s == null).map((n) => n.id) };
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
    plan: (graph, video, places, settings) => invoke<Plan>('pipeline_plan', { graph, video, places, settings }),
    async run(graph, video, allow, places, only, settings, on) {
      const unlisten = await listen<PipelineMessage>('pipeline', (e) => on(e.payload));   // before starting: no message is missed
      try { await invoke('pipeline_run', { graph, video, allowDownloads: allow.downloads, uploads: allow.uploads, places, only, settings }); }
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
