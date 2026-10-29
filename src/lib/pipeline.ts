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
  /** The feature it is a step of (the graph node: objects, for objects_names and objects_track), shown and turned on
   *  as one with it; null for a feature of its own. Absent from pipelines before perception #45. */
  part_of?: string | null;
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
  /** overrides of ~/.ssh/config (a pipeline from before them has none) */
  user?: string | null; port?: number | null; identity?: string | null;
  caps: { platform: string; cpu_cores: number; memory_gb: number; accelerators: string[]; vram_gb: number; tools: Record<string, string | null> };
}
/** A cloud GPU provider (`perception cloud`): whether it is offered to nodes that can use one, its machine and price. */
export interface CloudProvider { enabled: boolean; machine: string; region: string; hourly_usd: number }
/** The cloud GPU providers: AWS (its fields at the top level, as before RunPod) and RunPod (a pipeline from before it
 *  has no `runpod`). */
export interface CloudStatus extends CloudProvider { runpod?: CloudProvider }
export type CloudProviderName = 'aws' | 'runpod';
/** A provider's status, by name. */
export const provider = (c: CloudStatus, name: CloudProviderName): CloudProvider | undefined => name === 'aws' ? c : c.runpod;
/** A model one of the pipeline's steps uses (`perception models`): gated ones need access granted on their page. */
export interface ModelInfo { node: string; id: string; source: string | null; size_gb: number | null; gated: boolean; licence_mode: string }
/** A step the pipeline has (`perception models list`'s `nodes`): what it is called, the hosted API it calls (or null),
 *  the keys it needs, and its fixed choices at their defaults, with prices. */
export interface StepInfo { node: string; title: string; service: string | null; secrets: string[]; settings: Setting[];
  /** the id of the step whose feature it is a step of (vision.objects); null or absent (before perception #45): its own */
  part_of?: string | null }
/** The models, and the steps (null from a pipeline before them: then only the models are known). */
export interface ModelsListing { models: ModelInfo[]; nodes: StepInfo[] | null }
/** The steps as Settings > Models lists them: a feature each, with the steps part of it (part_of: perception #45) after
 *  it; a step part of one the pipeline does not list, or a pipeline that does not say, is a feature of its own. */
export function stepGroups(steps: StepInfo[]): { step: StepInfo; parts: StepInfo[] }[] {
  const id = (s: StepInfo) => s.node.replace(/@.*/, '');
  const head = (s: StepInfo) => (s.part_of && s.part_of !== id(s) && steps.find((x) => id(x) === s.part_of)) || s;
  return steps.filter((s) => head(s) === s).map((s) => ({ step: s, parts: [s, ...steps.filter((x) => x !== s && head(x) === s)] }));
}
/** Each model once, where it first appears: the entry with a source when there is one, as a step that only records a
 *  model another step downloads (the objects layer's SAM 3) declares none. */
export function oncePerModel<M extends { id: string; source: string | null }>(models: M[]): M[] {
  const ids = [...new Set(models.map((m) => m.id))];
  return ids.map((i) => models.find((m) => m.id === i && m.source) ?? models.find((m) => m.id === i)!);
}
/** A gated model's access with a Hugging Face token (`keys check HF_TOKEN`'s `models`): granted; not granted (asked
 *  for and pending, or never asked: Hugging Face answers both alike); or unknown (no token it accepts, or no answer:
 *  `reason`). `gating`: how it is granted, by the owner (`manual`) or on accepting the terms (`auto`). */
export interface ModelAccess { id: string; repo: string; revision: string; nodes: string[]; gating: 'manual' | 'auto' | null;
  access: 'granted' | 'not-granted' | 'unknown'; reason: string | null }
/** What a provider said of a key, or whether a cloud provider can be used (`keys check`, `cloud check`). For
 *  `HF_TOKEN`, also its account's name and each gated model's access (absent from a pipeline before them). */
export interface CheckResult { ok: boolean; detail: string; account?: string | null; models?: ModelAccess[] }
/** What a destination has, reached as adding it would, with nothing added (`hosts probe`). */
export interface HostProbe { dest: string; root: string; caps: Host['caps'] }
/** What a host is reached with over what ~/.ssh/config says (`hosts add|probe --user --port --identity`). */
export interface SshOverrides { user?: string; port?: number; identity?: string }
/** An error from a pipeline that predates a command (argparse: invalid choice), said as what to do. */
export const tooOld = (e: unknown, what: string) => olderCli(e) ? `Update the pipeline to ${what}.` : String(e);
/** Whether an error is a pipeline's that predates the command (argparse: invalid choice). */
export const olderCli = (e: unknown) => /invalid choice|unrecognized arguments/.test(String(e));
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
  /** Add (`dest`, optional `root` and overrides), check, clean or remove a lab server; the hosts after it. */
  host(action: HostAction, name: string, dest?: string, root?: string, overrides?: SshOverrides): Promise<Host[]>;
  /** Reach a destination as adding it would and say what it has, adding nothing (a connection test). */
  probeHost(dest: string, overrides?: SshOverrides): Promise<HostProbe>;
  /** The hosts ~/.ssh/config names (read on this machine). */
  sshHosts(): Promise<string[]>;
  /** Whether a cloud provider could be used now, changing nothing. */
  checkCloud(provider: CloudProviderName): Promise<CheckResult>;
  /** Whether a key's provider accepts it: one request that costs nothing. */
  checkKey(name: string): Promise<CheckResult>;
  /** The cloud GPU providers' status, or (with `on`) turn one on or off (`provider`: AWS when not given). */
  cloud(on?: boolean, provider?: CloudProviderName): Promise<CloudStatus>;
  /** The models the steps use, and the steps (`perception models list`). */
  models(): Promise<ModelsListing>;
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

/** The feature a step is part of (the pipeline says, perception #45: objects_names is a step of objects), when the
 *  plan has that feature; else the step itself, a feature of its own. */
export function featureOf(plan: Plan, id: string): string {
  const f = plan.nodes.find((n) => n.id === id)?.part_of;
  return f && f !== id && plan.nodes.some((n) => n.id === f) ? f : id;
}

/** A feature's steps, in the plan's order: itself and the steps part of it. */
export const stepsOf = (plan: Plan, id: string): string[] =>
  plan.nodes.filter((n) => n.id === id || featureOf(plan, n.id) === id).map((n) => n.id);

/** The picker's rows: a feature each, with its steps in its row; a step whose feature is off but that runs for another
 *  (`chosen`) has its own row, where it says what needs it. A pipeline that does not say what steps are part of has a
 *  row for each step. */
export const featureRows = (plan: Plan, chosen: string[]): PlanNode[] =>
  plan.nodes.filter((n) => featureOf(plan, n.id) === n.id || (chosen.includes(n.id) && !chosen.includes(featureOf(plan, n.id))));

/** What turning on feature `id` agrees to: what each of its steps sends, as the plan on screen shows it. */
export const tickFeature = (plan: Plan, id: string): Ticked =>
  Object.fromEntries(stepsOf(plan, id).map((s) => [s, tick(plan.nodes.find((n) => n.id === s)!)]));

/** A feature's state in a run, from its steps' (in order): failed or canceled if one is, else running while one runs or
 *  some are done and the rest wait, done when all are. */
export function featureState(states: NodeState[]): NodeState {
  const one = (s: NodeStateName) => states.find((x) => x.state === s);
  const done = (x: NodeState) => x.state === 'succeeded' || x.state === 'cached';
  const now = one('failed') ?? one('canceled') ?? states.find((x) => x.state === 'running' || x.state === 'retrying');
  if (now) return now;
  if (states.every((x) => x.state === 'cached')) return { state: 'cached', message: '' };
  if (states.every(done)) return [...states].reverse().find((x) => x.state === 'succeeded')!;
  return states.some(done) ? { state: 'running', message: '' } : { state: 'waiting', message: '' };
}

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
  return { wanted: keep, ticked: Object.fromEntries(Object.entries(ticked).filter(([id]) => keep.has(featureOf(plan, id)) || placed.includes(id))) };
}

/** The steps that send data off which turning on `id` would bring along although the user has not agreed to it (by
 *  turning them on, or by choosing the other machine they run on): `id` waits until they do (sending is chosen, never
 *  brought along). */
export function mustTurnOnFirst(plan: Plan, wanted: Set<string>, id: string, ticked: Ticked = {}): string[] {
  const { chosen } = picked(plan, new Set([...wanted, id])), own = stepsOf(plan, id);   // its own steps are turned on with it
  return chosen.filter((c) => { const n = plan.nodes.find((x) => x.id === c); return !own.includes(c) && !wanted.has(c) && !!n && !covered(n, ticked); });
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
  wanted.forEach((id) => stepsOf(plan, id).forEach(add));
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
  // a feature with all of its steps; a step of a feature is never on by itself
  return new Set(featureRows(plan, []).filter((n) => stepsOf(plan, n.id).every((s) => free(byId.get(s)!))).map((n) => n.id));
}

/** A choice as people say it: a Claude model by its name ("claude-haiku-5-5" is "Claude Haiku 5.5"), else as it is. */
export function choiceName(choice: string): string {
  const claude = choice.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?$/);
  return claude ? `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}` : choice;
}

/** A setting's choice as its menu shows it: with its price, when the cost depends on it. */
export function choiceLabel(s: Setting, choice: string): string {
  const usd = s.prices?.[choice];
  return usd == null ? choiceName(choice) : `${choiceName(choice)}, $${usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)} per ${s.per}`;
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
  if (backend === 'cloud' || backend === 'runpod') return title ?? 'Cloud GPU';
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
    host: async (action, name, dest, root, overrides) => (await invoke<{ hosts: Host[] }>('pipeline_host', { action, name, dest, root, overrides })).hosts,
    probeHost: (dest, overrides) => invoke<HostProbe>('pipeline_host', { action: 'probe', name: dest, overrides }),
    sshHosts: () => invoke<string[]>('ssh_config_hosts'),
    checkCloud: (provider) => invoke<CheckResult>('pipeline_cloud_check', { provider }),
    checkKey: (name) => invoke<CheckResult>('pipeline_key_check', { name }),
    cloud: (on, provider) => invoke<CloudStatus>('pipeline_cloud', { on, provider }),
    models: async () => { const r = await invoke<{ models: ModelInfo[]; nodes?: StepInfo[] }>('pipeline_models'); return { models: r.models, nodes: r.nodes ?? null }; },
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
