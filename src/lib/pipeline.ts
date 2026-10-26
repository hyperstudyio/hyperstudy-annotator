// Running the perception pipeline from the app (src-tauri/src/pipeline.rs drives `perception --json`, whose
// protocol is docs/cli-json.md in hyperstudy-perception): the pipeline, its setup, the graphs, a plan, then a run's messages.
// The dialog only sees PipelineApi; browser mode's ?pipeline-demo uses a scripted stand-in (pipeline.fake.ts).
import type { BundleSummary } from './types';

export interface Download { id: string; source: string | null; size_gb: number | null; gated: boolean; licence_mode: string }
export interface PlanNode {
  id: string; uses: string; where: string | null; why_not: string; cached: boolean;
  downloads: Download[]; missing_secrets: string[]; cost_usd: number; cost_note: string;
  /** Data kinds that leave this machine where it would run (frames, transcript...); absent from older CLIs. */
  uploads?: string[];
  /** Where they go: its API's service, or the other machine it would run on ("lab (SSH)"); null when nothing leaves. A
   *  node on another machine always has one, even with no kinds: its inputs go there. Absent from CLIs before
   *  perception #15 (then `service` says it, when `uploads` has kinds). */
  upload_to?: string | null;
  /** Where it would run (backend:accelerator: native:mps, ssh-lab:cuda, cloud:cuda), and every place it can run, best
   *  first: this machine's, then other machines'. */
  place?: string | null; options?: string[];
  /** Seconds, from its measured runs on this machine; null with the reason in estimate_basis. */
  estimate_s?: number | null; estimate_basis?: string;
  /** The nodes whose outputs it takes (a stage picker's edges); absent from older CLIs. */
  needs?: string[];
  /** Each of `options` -> its estimate, to compare places before choosing one; absent from older CLIs. With perception
   *  #15, what running there costs (the most: a cloud machine for its whole deadline) and what it would send where. */
  estimates?: Record<string, { estimate_s: number | null; estimate_basis: string; cost_usd?: number; uploads?: string[]; upload_to?: string | null }>;
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
/** A place as the plan describes it: `title` for people ("lab (SSH)"), and whether it is another machine. */
export interface PlaceInfo { title: string; remote: boolean; accelerator: string }
/** `places` and `max_cost_usd` (the graph's cap on a run's spend) are absent from CLIs before perception #15/#16. */
export interface Plan { ok: boolean; estimated_usd: number; nodes: PlanNode[]; places?: Record<string, PlaceInfo>; max_cost_usd?: number }
export interface GraphPreset { file: string; pipeline: string; description: string }
/** A lab server nodes can run on (`perception hosts`): what it had when it was added or last checked. */
export interface Host {
  name: string; dest: string; root: string; probed_at: number;
  caps: { platform: string; cpu_cores: number; memory_gb: number; accelerators: string[]; vram_gb: number; tools: Record<string, string | null> };
}
/** Whether a cloud GPU is offered to nodes that can use one (`perception cloud`), the machine and its price. */
export interface CloudStatus { enabled: boolean; machine: string; region: string; hourly_usd: number }
/** A key the app keeps for the pipeline (in the system keychain): what it is for and whether one is stored. The app
 *  never sends a key's value to this page. */
export interface KeyStatus { name: string; label: string; purpose: string; url: string; stored: boolean }
/** Where the CLI finds keys without the app's (`perception keys list`: names and sources, never values), and the key
 *  files it refused. */
export interface CliKeys { keys: { name: string; source: string }[]; problems: string[] }
export type HostAction = 'add' | 'check' | 'remove' | 'clean';
export interface Doctor {
  platform: string; cpu_cores: number; memory_gb: number; accelerators: string[]; vram_gb: number;
  nodes: { ref: string; stage: string; description: string; where: string | null; why_not: string }[];
  /** the pipeline: its version, its commit (the package's; null for a checkout) and where its files are */
  pipeline?: { version: string | null; commit: string | null; root: string };
}

export type PipelineMessage = { v: 1 } & (
  | { type: 'run.created'; run: string; store: string }
  | { type: 'event'; run: string; node: string | null; kind: string; message: string; at: string | null }
  | { type: 'run.finished'; run: string; status: string }
  | ({ type: 'plan' } & Plan)
  | { type: 'imported'; run: string; bundle: BundleSummary }
  | { type: 'error'; problems: string[] }
);

/** Installing the pipeline from PyPI or upgrading it (each start: `installing`, nothing runs yet), then setting a new
 *  version up (`running`: each step's packages and weights; Start run waits). `notice`: what did not stop it (an upgrade
 *  that could not be checked, with a version installed). */
export interface SetupStep { node: string | null; what: string; ok: boolean; seconds: number; message: string }
export interface SetupStatus { state: 'idle' | 'installing' | 'running' | 'done' | 'failed'; steps: SetupStep[]; problem: string | null; notice: string | null;
  /** a version is installed (false after an install that failed with none: the pipeline cannot be asked anything) */
  installed: boolean }

export interface PipelineApi {
  setupStatus(): Promise<SetupStatus>;
  /** Hear the setup's status each time it changes; resolves to a function that stops listening. */
  onSetup(on: (s: SetupStatus) => void): Promise<() => void>;
  /** Try a setup that failed again. */
  retrySetup(): Promise<void>;
  doctor(): Promise<Doctor>;
  graphs(): Promise<GraphPreset[]>;
  /** Lab servers (perception #15); a pipeline from before them rejects these. */
  hosts(): Promise<Host[]>;
  /** Add (`dest`, optional `root`), check, clean or remove a lab server; the hosts after it. */
  host(action: HostAction, name: string, dest?: string, root?: string): Promise<Host[]>;
  /** The cloud GPU's status, or (with `on`) turn it on or off (perception #16). */
  cloud(on?: boolean): Promise<CloudStatus>;
  /** The keys the app keeps, stored or not (never their values); store one, or remove it. */
  keys(): Promise<KeyStatus[]>;
  setKey(name: string, value: string): Promise<KeyStatus[]>;
  removeKey(name: string): Promise<KeyStatus[]>;
  /** Where the CLI finds keys on its own (perception #24); a pipeline from before it rejects this. */
  cliKeys(): Promise<CliKeys>;
  plan(graph: string, video: string, places: Places, settings: Settings): Promise<Plan>;
  /** Start a run; `on` receives its messages until `imported` or `error`. Resolves to a function that stops listening.
   *  The app checks the consent again against a fresh plan before it starts. */
  /** `only`: just these nodes (and what they need); null runs the whole graph. */
  /** `maxCostUsd`: the run's spending cap (spendingCap), or null for the graph's own. */
  run(graph: string, video: string, allow: Consent, places: Places, only: string[] | null, settings: Settings, maxCostUsd: number | null, on: (m: PipelineMessage) => void): Promise<() => void>;
  /** Cancel the run in progress: by its id once the CLI has named it, else (null) by stopping the CLI's process. */
  cancel(run: string | null): Promise<void>;
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

/** What a run lets happen: `uploads` is node id -> the kinds of data it may send off this machine, and where to (its
 *  service, or null). (Models download as part of running: the app always lets them.) */
export interface Consent { uploads: Record<string, { kinds: string[]; service: string | null }> }

/** The steps the user turned on themselves, each with what it sent, and where to, on the plan on screen when they did:
 *  that is what they chose to send, and all they chose. */
export type Ticked = Record<string, { kinds: string[]; service: string | null }>;

/** Where `n` sends data, or null when nothing leaves this machine: its API, or the other machine it runs on. */
export const dest = (n: PlanNode): string | null =>
  n.upload_to ?? (n.uploads?.length ? n.service ?? null : null);   // kinds always go somewhere (the gate refuses a plan saying otherwise)
/** Does `n` send anything off this machine where it would run? (On another machine it always does: its inputs.) */
export const sends = (n: PlanNode) => dest(n) !== null || !!n.uploads?.length;

/** What ticking `n` agrees to: what the plan on screen shows it sends, and where. */
export const tick = (n: PlanNode) => ({ kinds: [...(n.uploads ?? [])], service: dest(n) });

/** What choosing `place` for `n` agrees to: what the plan says it would send from there, and where (choosing another
 *  machine is the choice to send it its inputs). Null when the plan does not say (then nothing is agreed). */
export function placeTick(n: PlanNode, place: string): { kinds: string[]; service: string | null } | null {
  const e = n.estimates?.[place];
  return e && 'upload_to' in e ? { kinds: [...(e.uploads ?? [])], service: e.upload_to ?? null } : null;
}

/** Whether what `n` sends now is within what the user agreed to when they ticked it (no new kind, no other place). */
function covered(n: PlanNode, ticked: Ticked): boolean {
  const t = ticked[n.id];
  return !sends(n) || (!!t && (n.uploads ?? []).every((k) => t.kinds.includes(k)) && dest(n) === t.service);
}

/** What a run of these steps lets happen: its models download as part of running, and turning on a feature that sends
 *  data to a cloud API is the choice to send what the plan then showed it sends (such features start off, see
 *  defaultFeatures). Only what the user ticked counts: a default, a step that came along for another feature, or a
 *  step that now sends more than when it was ticked agreed to nothing. The app holds a fresh plan to exactly this
 *  before it starts. */
export const consentFor = (plan: Plan, ticked: Ticked): Consent => ({
  uploads: Object.fromEntries(plan.nodes.filter((n) => sends(n) && covered(n, ticked))
    .map((n) => [n.id, { kinds: [...(n.uploads ?? [])], service: dest(n) }])),
});

/** Steps that would run and send data off beyond what the user agreed to: the run waits until they tick them. */
export const unagreed = (plan: Plan, ticked: Ticked) => plan.nodes.filter((n) => !covered(n, ticked)).map((n) => n.id);

/** The features still on when a new plan arrives, and the ticks that still stand: a step that now sends data off (a new
 *  place, a new setting) stays on only if it sends nothing beyond what the user agreed to when they ticked it; else it
 *  goes off, and its tick with it (ticking it again agrees to what it sends now). The agreement a chosen place gave
 *  (`placed`: steps the user moved, see placeTick) stands while the place does, for a step held on for another feature
 *  too. A plan whose steps cannot be chosen runs whole (blockers refuses it if a step sends data off). */
export function keepChoices(plan: Plan, wanted: Set<string>, ticked: Ticked, placed: string[] = []): { wanted: Set<string>; ticked: Ticked } {
  if (!canPick(plan)) return { wanted: defaultFeatures(plan), ticked };
  // a feature stays on only if nothing it would run (itself, and what it needs) sends beyond what was agreed: a step
  // held on for another feature cannot be turned on by itself, so the feature that brings it goes off instead
  const byId = new Map(plan.nodes.map((n) => [n.id, n]));
  const keep = new Set([...wanted].filter((id) => picked(plan, new Set([id])).chosen.every((c) => covered(byId.get(c)!, ticked))));
  return { wanted: keep, ticked: Object.fromEntries(Object.entries(ticked).filter(([id]) => keep.has(id) || placed.includes(id))) };
}

/** The steps that send data off which turning on `id` would bring along although the user has not agreed to it (by
 *  turning them on, or by choosing the other machine they run on): `id` waits until they do (sending is chosen, never
 *  brought along). */
export function mustTurnOnFirst(plan: Plan, wanted: Set<string>, id: string, ticked: Ticked = {}): string[] {
  const { chosen } = picked(plan, new Set([...wanted, id]));
  return chosen.filter((c) => { const n = plan.nodes.find((x) => x.id === c); return c !== id && !wanted.has(c) && !!n && !covered(n, ticked); });
}

/** Why a run cannot start, one line per problem; empty when it can: every node needs a place to run here (cached ones
 *  too: the CLI checks the whole graph) and its secrets, and a plan that does not say what leaves the machine (a CLI
 *  from before plans carried `uploads`) is not run. Nor is a plan whose steps cannot be chosen (no `needs`: it runs
 *  whole) while one of them sends data off: nobody turned that step on. */
export function blockers(plan: Plan): string[] {
  const whole = !canPick(plan);
  // on another machine (as the plan's places say) without saying where its inputs go: the gate would refuse it too
  const unsaid = (n: PlanNode) => !!plan.places && !!n.place && plan.places[n.place]?.remote !== false && typeof n.upload_to !== 'string';
  return plan.nodes.flatMap((n) => [
    ...(unsaid(n) ? [`the pipeline does not say where ${n.id} sends its inputs on ${n.place} (update hyperstudy-perception)`] : []),
    // kinds that leave for nowhere: the upload gate refuses that plan, so the run is not offered either
    ...(n.upload_to === null && n.uploads?.length ? [`the pipeline does not say where ${n.id} sends ${n.uploads.join(', ')} (update hyperstudy-perception)`] : []),
    ...(n.where ? [] : [`${n.id} cannot run here${n.why_not ? `: ${n.why_not}` : ''}`]),
    ...n.missing_secrets.map((k) => `${n.id} needs ${k}`),
    ...(n.uploads === undefined ? [`the pipeline does not say what ${n.id} sends off this machine (update hyperstudy-perception)`]
      : whole && sends(n) ? [`${n.id} sends ${n.uploads.join(', ') || 'its inputs'} off this machine and this pipeline cannot leave it out (update hyperstudy-perception)`]
      // a CLI from before plans carried settings (perception #14) does not know --allow-uploads: the run would fail
      : sends(n) && !('settings' in n) ? [`${n.id} sends data off this machine and this pipeline cannot be told it may (update hyperstudy-perception)`] : []),
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
    return !sends(n) && !n.cost_usd && !n.cost_note && (n.needs ?? []).every((u) => !byId.has(u) || free(byId.get(u)!, seen));
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
/** A machine as the Machines list says it: its platform, cores, memory and GPU, and a tool nodes need that it lacks. */
export function hostSummary(h: Host): string {
  const c = h.caps;
  const os = c.platform.startsWith('darwin') ? 'Mac' : c.platform.startsWith('linux') ? 'Linux' : c.platform;
  const gpu = c.accelerators.includes('cuda') ? `, NVIDIA GPU (${Math.round(c.vram_gb)} GB)` : c.accelerators.includes('mps') ? ', Apple GPU' : ', no GPU';
  const missing = Object.entries(c.tools).filter(([, path]) => !path).map(([tool]) => tool);
  return `${os}, ${c.cpu_cores} cores, ${Math.round(c.memory_gb)} GB${gpu}${missing.length ? `; needs ${missing.join(', ')}` : ''}`;
}

/** A place (backend:accelerator) as people say it: "Apple GPU" here, "NVIDIA GPU on lab (SSH)" on a lab server, the
 *  plan's title for a cloud machine ("Cloud GPU (AWS L4)"). */
export function placeName(place: string, places?: Record<string, PlaceInfo>): string {
  const [backend, accelerator = ''] = place.split(':');
  const what = ACCELERATORS[accelerator] ?? accelerator;
  if (backend === 'native' || backend === 'self') return what;
  const title = places?.[place]?.title;
  if (backend === 'cloud') return title ?? 'Cloud GPU';
  return `${what} on ${title ?? backend.replace(/^ssh-/, '')}`;
}

/** A place as the menu shows it: with how long the step would take there and what it costs, when the plan says. */
export function placeLabel(n: PlanNode, place: string, places?: Record<string, PlaceInfo>): string {
  const e = n.estimates?.[place];
  if (!e) return placeName(place, places);
  const machine = e.cost_usd && !n.service && places?.[place]?.remote ? `, up to $${e.cost_usd.toFixed(2)}` : '';   // another machine's price
  return `${placeName(place, places)}, ${e.estimate_s != null ? `about ${duration(e.estimate_s)}` : 'no estimate yet'}${machine}`;
}

/** What the machine a step runs on costs at most (a cloud GPU for its whole deadline), or 0: only another machine's
 *  price, never an API's (that is the step's own cost, which the graph's cap limits). */
export function machineCost(plan: Plan, n: PlanNode): number {
  return n.place && !n.service && plan.places?.[n.place]?.remote ? n.estimates?.[n.place]?.cost_usd ?? 0 : 0;
}

/** The run's spending cap: the graph's (it covers the APIs its steps call), raised by what each step that runs on a
 *  machine that costs money (a cloud GPU) costs at most there. Null when the plan does not say the graph's cap (the
 *  CLI keeps the graph's own). */
export function spendingCap(plan: Plan, chosen: string[]): number | null {
  if (plan.max_cost_usd == null) return null;
  // cached steps too: a cache can be gone by the time the run starts (the upload gate counts them for the same reason)
  const machines = plan.nodes.filter((n) => chosen.includes(n.id)).reduce((a, n) => a + machineCost(plan, n), 0);
  return Math.ceil((plan.max_cost_usd + machines) * 100 - 1e-9) / 100;   // up to the cent: never below a reservation
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

/** Each key the app keeps, with where the CLI would find it otherwise (a file, the environment, its own keychain
 *  entry) when the app holds none: a key already set up for the command line need not be entered again. */
export function keyRows(keys: KeyStatus[], cli: CliKeys | null): (KeyStatus & { elsewhere: string | null })[] {
  return keys.map((k) => ({ ...k, elsewhere: k.stored ? null : cli?.keys.find((c) => c.name === k.name)?.source ?? null }));
}

/** The Keys row's line: which keys the pipeline has (from the app or elsewhere), and which it has none of. */
export function keysText(rows: ReturnType<typeof keyRows>): string {
  const have = rows.filter((r) => r.stored || r.elsewhere).map((r) => r.label);
  const missing = rows.filter((r) => !r.stored && !r.elsewhere).map((r) => r.label);
  return [have.length ? `Set: ${have.join(', ')}` : null, missing.length ? `Not set: ${missing.join(', ')}` : null].filter(Boolean).join('. ');
}

export async function tauriPipeline(): Promise<PipelineApi> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const { open } = await import('@tauri-apps/plugin-dialog');
  return {
    setupStatus: () => invoke<SetupStatus>('pipeline_setup_status'),
    onSetup: (on) => listen<SetupStatus>('pipeline-setup', (e) => on(e.payload)),
    retrySetup: () => invoke<void>('pipeline_setup'),
    doctor: () => invoke<Doctor>('pipeline_doctor'),
    graphs: () => invoke<GraphPreset[]>('pipeline_graphs'),
    hosts: async () => (await invoke<{ hosts: Host[] }>('pipeline_hosts')).hosts,
    host: async (action, name, dest, root) => (await invoke<{ hosts: Host[] }>('pipeline_host', { action, name, dest, root })).hosts,
    cloud: (on) => invoke<CloudStatus>('pipeline_cloud', { on }),
    keys: () => invoke<KeyStatus[]>('keys_status'),
    setKey: (name, value) => invoke<KeyStatus[]>('key_set', { name, value }),
    removeKey: (name) => invoke<KeyStatus[]>('key_remove', { name }),
    cliKeys: () => invoke<CliKeys>('pipeline_keys'),
    plan: (graph, video, places, settings) => invoke<Plan>('pipeline_plan', { graph, video, places, settings }),
    async run(graph, video, allow, places, only, settings, maxCostUsd, on) {
      const unlisten = await listen<PipelineMessage>('pipeline', (e) => on(e.payload));   // before starting: no message is missed
      try { await invoke('pipeline_run', { graph, video, uploads: allow.uploads, places, only, settings, maxCostUsd }); }
      catch (e) { unlisten(); throw e; }
      return unlisten;
    },
    cancel: (run) => invoke<void>('pipeline_cancel', { run }),
    async pickVideo() {
      const file = await open({ title: 'Choose a video', filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv'] }] });
      return typeof file === 'string' ? file : null;
    },
  };
}
