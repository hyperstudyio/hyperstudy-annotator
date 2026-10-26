<script lang="ts">
  // Run the perception pipeline on a video and import the bundle it makes: the pipeline the app installs from PyPI
  // (checked once it is installed; Start run waits while a new version is set up), a video, the features to run from the pipeline's full graph (what they need comes along),
  // the plan (where each step runs, what is cached, what it costs, each step's details and settings: what it downloads
  // and what it sends off), then the run, step by step. Turning on a feature that sends data to a cloud API is the
  // choice to send it; such features start off. A pipeline with no full graph offers its graphs instead.
  import { untrack } from 'svelte';
  import { latestOnly } from '../latest';
  import Keys from './Keys.svelte';
  import Machines from './Machines.svelte';
  import type { RunStatus } from './Rail.svelte';
  import { blockers, canPick, choiceLabel, consentFor, dest, keepChoices, mustTurnOnFirst, placeTick, machineCost, tick, unagreed, defaultFeatures, duration, FULL_GRAPH, foldRun, picked, placeLabel, placeName, placesFor,
    settingsFor, spendingCap, totalEstimate, keyRows, keysText, type CliKeys, type KeyStatus, type CloudStatus, type Host, type Places, type Doctor, type GraphPreset, type PipelineApi, type PipelineMessage, type Plan, type PlanNode, type SetupStatus, type SetupStep, type Settings, type Ticked } from '../pipeline';

  let { api, visible = true, onnew, onopen, onstatus }: {
    api: PipelineApi;
    /** the page is on screen (it stays mounted while hidden, so a run goes on) */
    visible?: boolean;
    /** start over, after a run has ended */
    onnew: () => void;
    onopen: (bundleId: string) => void;
    /** the run as the rail shows it: how far along, then how it ended (null: none started) */
    onstatus?: (run: RunStatus | null) => void;
  } = $props();

  let loaded = $state(false);   // the pipeline was asked what it has (once it is installed)
  let setup = $state<SetupStatus | null>(null);
  let doctor = $state<Doctor | null>(null);
  // other machines steps can run on (null: this pipeline predates them, perception #15/#16)
  let hosts = $state<Host[] | null>(null);
  let cloud = $state<CloudStatus | null>(null);
  let manage = $state(false);
  let machinesError = $state<string | null>(null);
  let olderPipeline = $state(false);   // it does not know `hosts` or `cloud`
  let machinesBusy = $state(false);    // a machine action under way: Start run waits for it
  let keysBusy = $state(false);        // a key being saved or removed: Start run waits for it (the run would race the key)
  // the keys the app keeps (in the keychain: whether each is stored, never its value), and where the CLI finds keys on
  // its own (null: a pipeline from before `perception keys`)
  let keys = $state<KeyStatus[]>([]);
  let cliKeys = $state<CliKeys | null>(null);
  let manageKeys = $state(false);
  let keysError = $state<string | null>(null);
  let graphs = $state<GraphPreset[]>([]);
  let graph = $state<string | null>(null);
  let video = $state<string | null>(null);
  let plan = $state<Plan | null>(null);
  let places = $state<Places>({});   // nodes the user moved to another place they can run here
  let wanted = $state<Set<string> | null>(null);   // the features on (null: the first plan's defaults)
  let ticked = $state<Ticked>({});   // the ones the user turned on themselves, with what they sent then: all they may send
  let settings = $state<Settings>({});   // settings the user chose: node -> key -> value
  let open = $state<string | null>(null);   // the step whose details show
  let msgs = $state.raw<PipelineMessage[]>([]);
  let arrived = $state.raw<number[]>([]);   // when each message came: a step's progress is its time running against its estimate
  let now = $state(Date.now());
  let started = $state(false);
  let error = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let stop: (() => void) | null = null;

  const pick = $derived(plan ? picked(plan, wanted ?? defaultFeatures(plan)) : { chosen: [], neededBy: {}, only: null });
  // the plan of what will run: the features on and what they need (time, cost, consent and blockers count only these)
  const active = $derived(plan ? { ...plan, nodes: plan.nodes.filter((n) => pick.chosen.includes(n.id)) } : null);
  function toggle(id: string, on: boolean) {
    const next = new Set(wanted ?? (plan ? defaultFeatures(plan) : []));
    if (on) next.add(id); else next.delete(id);   // what it needs comes along, and goes when nothing else needs it
    wanted = next;
    const n = plan?.nodes.find((x) => x.id === id);
    const { [id]: _, ...rest } = ticked;
    ticked = on && n ? { ...rest, [id]: tick(n) } : rest;
  }
  const view = $derived(foldRun(active?.nodes.map((n) => n.id) ?? [], msgs));
  const done = $derived(!!view.imported || !!view.problems.length || (view.status !== null && view.status !== 'succeeded'));
  let planning = $state(false);   // a newer plan is on its way: the one on screen is not what would run
  // what blocks a run: the plan's own problems, and a step that would send data off beyond what the user agreed to
  const why = $derived(active && !started ? [...blockers(active), ...(canPick(active) ? unagreed(active, ticked).map((id) =>
    `${titleOf(id)} would send data off this machine that it was not turned on to send: turn it on yourself`) : [])] : []);
  // Start run is held for exactly the reasons the footer gives (and while there is nothing yet to run)
  const settingUp = $derived(setup?.state === 'installing' || setup?.state === 'running');   // Start run waits for it
  const canRun = $derived(!!active && active.nodes.length > 0 && !!graph && !!video && !why.length && !started && !planning && !machinesBusy && !keysBusy && !settingUp);
  // when each step started (its latest attempt) and finished, by the clock here
  const ran = $derived.by(() => {
    const out: Record<string, { from: number; to: number | null }> = {};
    msgs.forEach((m, i) => {
      if (m.type !== 'event' || !m.node) return;
      if (m.kind === 'task.started') out[m.node] = { from: arrived[i], to: null };
      else if (['task.succeeded', 'task.failed', 'task.canceled'].includes(m.kind) && out[m.node]) out[m.node].to = arrived[i];
    });
    return out;
  });
  $effect(() => {   // the clock running steps fill against
    if (!started || done) return;
    const t = setInterval(() => (now = Date.now()), 500);
    return () => clearInterval(t);
  });
  /** How far along a step is, 0 to 1: done is full; a running step is its time so far over its estimate (held short of
   *  full until it finishes); null when it runs with no estimate to measure against. */
  function progress(n: PlanNode, state: string): number | null {
    if (n.cached || state === 'succeeded' || state === 'cached') return 1;
    const r = ran[n.id];
    if (!r) return 0;
    if (n.estimate_s == null) return r.to === null ? null : 0;
    return Math.min(((r.to ?? now) - r.from) / 1000 / n.estimate_s, r.to === null ? 0.95 : 1);
  }
  $effect(() => {
    const states = Object.values(view.nodes).map((n) => n.state);
    onstatus?.(!started ? null : { state: view.imported ? 'imported' : done ? 'failed' : 'running',
      fraction: states.length ? states.filter((x) => x === 'succeeded' || x === 'cached').length / states.length : 0 });
  });
  // Back on this page after Settings, where keys and machines may have changed: what the steps are offered changes with
  // them, so load them again and plan again (keeping the choices). The first showing has just loaded them.
  let shown = false;
  $effect(() => {
    if (!visible) return;
    if (!shown) { shown = true; return; }
    untrack(() => { revisit(); });
  });
  const revisit = async () => {
    const [h, c] = await Promise.allSettled([api.hosts(), api.cloud()]);
    await loadKeys();
    await machinesChanged({ hosts: h.status === 'fulfilled' ? h.value : undefined, cloud: c.status === 'fulfilled' ? c.value : undefined });
  };

  async function step(label: string, f: () => Promise<void>) {
    busy = label; error = null;
    try { await f(); } catch (e) { error = String(e); } finally { busy = null; }
  }
  const loadPipeline = () => step('Checking the pipeline…', async () => {
    [doctor, graphs] = await Promise.all([api.doctor(), api.graphs()]);
    await Promise.all([loadMachines(), loadKeys()]);
    if (graphs.some((g) => g.file === FULL_GRAPH)) graph = FULL_GRAPH;   // features are picked from it
  });
  // nothing can answer while the pipeline is being installed: asked once it is (or a checkout runs: no setup)
  $effect(() => { if (setup && setup.state !== 'installing' && !loaded) { loaded = true; loadPipeline(); } });
  $effect(() => () => stop?.());
  $effect(() => {   // the setup's status, then each change to it (listening first: no change is missed)
    let off: (() => void) | null = null, gone = false;
    api.onSetup((s) => (setup = s)).then((f) => { if (gone) f(); else off = f; return api.setupStatus(); })
      .then((s) => { if (s && !gone && setup === null) setup = s; }).catch((e) => (error = String(e)));
    return () => { gone = true; off?.(); };
  });
  const retrySetup = () => step('Setting up the pipeline…', () => api.retrySetup());
  // the step a setup.step names, as the plan calls it (`uses` is the node's ref)
  const stepTitle = (s: SetupStep) => plan?.nodes.find((n) => n.uses === s.node)?.title ?? s.node ?? 'this machine';


  // a pipeline from before other machines does not know the commands (argparse: invalid choice): the row says so; any
  // other failure is said on the row as it is, with the machines last known kept
  const loadMachines = async () => {
    machinesError = null; olderPipeline = false;
    const [h, c] = await Promise.allSettled([api.hosts(), api.cloud()]);
    const older = (r: PromiseSettledResult<unknown>, cmd: string) => r.status === 'rejected' && new RegExp(`invalid choice: '${cmd}'`).test(String(r.reason));
    // each on its own: a pipeline can have lab servers (perception #15) before the cloud (#16)
    if (h.status === 'fulfilled') hosts = h.value;
    else if (older(h, 'hosts')) { hosts = null; manage = false; olderPipeline = true; }
    if (c.status === 'fulfilled') cloud = c.value;
    else if (older(c, 'cloud')) cloud = null;
    machinesError = [h, c].filter((r) => r.status === 'rejected' && !older(r, 'hosts') && !older(r, 'cloud'))
      .map((r) => String((r as PromiseRejectedResult).reason)).join('; ') || null;
  };
  // the keychain's answer and the CLI's, each on its own. A pipeline from before `perception keys` does not know the
  // command (argparse: invalid choice), and has only the app's keys; any other failure is said on the row as it is
  const loadKeys = async () => {
    keysError = null;
    const [k, c] = await Promise.allSettled([api.keys(), api.cliKeys()]);
    if (k.status === 'fulfilled') keys = k.value;
    const olderCli = c.status === 'rejected' && /invalid choice: 'keys'/.test(String(c.reason));
    cliKeys = c.status === 'fulfilled' ? c.value : null;
    keysError = [k.status === 'rejected' ? `the keychain: ${k.reason}` : null,
                 c.status === 'rejected' && !olderCli ? `the pipeline's keys: ${c.reason}` : null].filter(Boolean).join('; ') || null;
  };
  const keysText_ = $derived(keysText(keyRows(keys, cliKeys)));
  // a key stored or removed: what steps are missing changes, so plan again (keeping the choices)
  const keysChanged = async (now: KeyStatus[]) => {
    keys = now;
    if (plan && !started) await makePlan(true);
  };
  // a machine added or removed, the cloud turned on or off: the step menus change, so plan again (keeping the steps). A
  // step placed on a machine that is gone, or is now another machine (a name given a new address or folder), goes back
  // to this machine, and the agreement its place gave goes with it: choosing the machine again is a new choice.
  const machineId = (h: Host) => `${h.dest} ${h.root}`;
  const machinesChanged = async (now: { hosts?: Host[]; cloud?: CloudStatus }) => {
    const before = new Map((hosts ?? []).map((h) => [`ssh-${h.name}`, machineId(h)]));
    if (now.hosts) hosts = now.hosts;
    if (now.cloud) cloud = now.cloud;
    if (started) return;   // a run has its places already
    // each place still offered: the same machine, with that accelerator (a check may find a GPU gone)
    const offered = (place: string) => {
      const [backend, accelerator] = place.split(':');
      if (backend === 'native' || backend === 'self') return true;
      if (backend === 'cloud') return !!cloud?.enabled;
      const h = (hosts ?? []).find((x) => `ssh-${x.name}` === backend);
      return !!h && before.get(backend) === machineId(h) && h.caps.accelerators.includes(accelerator);
    };
    const gone = Object.entries(places).filter(([, p]) => !offered(p)).map(([n]) => n);
    if (gone.length) {
      places = Object.fromEntries(Object.entries(places).filter(([n]) => !gone.includes(n)));
      ticked = Object.fromEntries(Object.entries(ticked).filter(([n]) => !gone.includes(n)));
    }
    await makePlan(true);
  };
  const machinesText = $derived(olderPipeline ? 'This machine only (this pipeline cannot run steps elsewhere: update hyperstudy-perception)'
    : [doctor?.platform.startsWith('darwin') ? 'This Mac' : 'This machine', ...(hosts ?? []).map((h) => `${h.name} (SSH)`),
       cloud?.enabled ? 'Cloud GPU' : null].filter(Boolean).join(', '));
  // another video: the features go back to their defaults, so turning on a step that sends data off for one video is
  // not the choice to send the next one's
  const chooseVideo = async () => { const v = await api.pickVideo(); if (v) { video = v; wanted = null; ticked = {}; await makePlan(); } };
  const chooseGraph = async (file: string) => { graph = file; places = {}; wanted = null; ticked = {}; settings = {}; open = null; await makePlan(); };
  // choosing another machine is the choice to send this step's inputs there (what the plan says it would send)
  const choosePlace = async (node: string, place: string) => {
    const agreed = plan && placeTick(plan.nodes.find((n) => n.id === node)!, place);
    if (agreed) ticked = { ...ticked, [node]: agreed };
    places = { ...places, [node]: place };
    await makePlan(true);
  };
  const chooseSetting = async (node: string, key: string, value: string) => { settings = { ...settings, [node]: { ...settings[node], [key]: value } }; await makePlan(true); };
  const total = $derived(active ? totalEstimate(active) : null);
  const cost = $derived(active?.nodes.filter((n) => !n.cached).reduce((a, n) => a + n.cost_usd, 0) ?? 0);
  // Only the newest plan request may set the plan, so a slow one cannot show one graph while another would run.
  const newestPlan = latestOnly();
  // `keep`: a new place or setting replans the same steps, so the plan stays on screen (and the control just changed
  // keeps the keyboard) while Start run waits for the new one
  const makePlan = async (keep = false) => {
    if (!keep) plan = null;
    error = null;
    if (!graph || !video) return;
    busy = 'Planning…'; planning = true;
    newestPlan(api.plan(graph, video, places, settings), (p) => { plan = p; ({ wanted, ticked } = keepChoices(p, wanted ?? defaultFeatures(p), ticked, Object.keys(places))); busy = null; planning = false; },
      (e) => { plan = null; error = String(e); busy = null; planning = false; });
  };
  const run = () => step('Starting…', async () => {
    started = true; msgs = []; arrived = []; now = Date.now();
    const on = (m: PipelineMessage) => { arrived = [...arrived, Date.now()]; msgs = [...msgs, m]; };
    try { stop = await api.run(graph!, video!, consentFor(active!, ticked), placesFor(places, pick.chosen), pick.only, settingsFor(settings, pick.chosen), spendingCap(active!, pick.chosen), on); }
    catch (e) { started = false; throw e; }   // not started after all: the dialog stays usable, with the reason
  });
  const cancel = () => step('Canceling…', async () => { await api.cancel(view.run); });   // no id yet: its process is stopped

  const name = (p: string | null) => p?.split('/').pop() ?? '';
  const pipelineName = $derived(doctor?.pipeline?.commit ? `Pipeline ${doctor.pipeline.version}`
    : `Pipeline ${doctor?.pipeline?.version ?? ''} from ${name(doctor?.pipeline?.root ?? 'a checkout')}`);
  const stem = (file: string) => file.replace(/\.ya?ml$/, '');
  const list = (xs: string[]) => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
  const STATE_LABEL = { waiting: 'Waiting', cached: 'Cached', running: 'Running', retrying: 'Retrying', succeeded: 'Done', failed: 'Failed', canceled: 'Canceled' };
  // the run in one line: how far it got, or how it ended
  const headline = $derived.by(() => {
    const states = Object.values(view.nodes).map((n) => n.state);
    const finished = states.filter((x) => x === 'succeeded' || x === 'cached').length;
    if (view.status === 'succeeded') return `Finished all ${states.length} steps`;
    if (view.status === 'failed') return 'The run failed';
    if (view.status === 'canceled') return 'The run was canceled';
    if (view.problems.length) return 'The run stopped';
    return `Running, ${finished} of ${states.length} steps done`;
  });
  const chosenGraph = $derived(graphs.find((g) => g.file === graph));
  const stepCount = $derived(active?.nodes.filter((n) => !n.cached).length ?? 0);
  // a range only when running side by side could save real time (within a tenth, one number says it)
  const timeText = $derived(!total ? '' : total.fastest >= total.seconds * 0.9
    ? `about ${duration(total.seconds)}` : `${duration(total.fastest)} to ${duration(total.seconds)}`);
  const title = (n: PlanNode) => n.title || n.id;
  const titleOf = (id: string) => { const n = plan?.nodes.find((x) => x.id === id); return n ? title(n) : id; };
  const LICENCE: Record<string, string> = { 'academic-only': 'academic use only', 'commercial-ok': 'commercial use allowed', 'needs-review': 'licence under review', 'api-terms': "the API provider's terms" };
  const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
  // what leaves this machine, and where to: the API it calls, or the other machine it runs on (its inputs, whatever they hold)
  const leaves = (n: PlanNode) => {
    const to = dest(n);
    if (!to && !n.uploads?.length) return 'Nothing';
    const what = n.uploads?.length ? list(n.uploads) : 'Its inputs';
    return to ? `${what}, sent to ${to === n.service ? `the ${to}` : to}` : what;
  };
</script>

<section class="extract" aria-label="Extract">
  <header>
    <div class="title">
      <h1 class="page-title">Extract</h1>
      <p class="page-lead">Run the perception pipeline on a video. The bundle it makes opens in the Annotator.</p>
      {#if doctor}
        <p class="pipeline">
          <span title={doctor.pipeline?.root}>{pipelineName}</span>, {doctor.nodes.filter((n) => n.where).length} of {doctor.nodes.length} nodes can run on this {doctor.platform.startsWith('darwin') ? 'Mac' : 'machine'} ({doctor.accelerators.map((a) => placeName(`native:${a}`)).join(', ')})
        </p>
      {/if}
    </div>
  </header>

  {#if setup?.state === 'installing'}
    <div class="empty">
      <p>Installing the pipeline. The first time, this fetches the pipeline and the Python it runs on; after that, it
        only checks for a newer version.</p>
    </div>
  {:else if doctor}
    <div class="setup">
      <span class="label">Video</span>
      <div class="value">
        {#if video}<span class="file" title={video}>{name(video)}</span>{:else}<span class="muted">None chosen</span>{/if}
        <button onclick={chooseVideo} disabled={started}>{video ? 'Change…' : 'Choose…'}</button>
      </div>
      <span class="label">Machines</span>
      <div class="value">
        <span>{machinesText}</span>
        {#if machinesError}<span class="error">{machinesError}</span>{/if}
        {#if hosts !== null}<button onclick={() => (manage = !manage)} aria-expanded={manage} aria-controls="machines" aria-label={manage ? 'Done with machines' : 'Manage machines'} disabled={started}>{manage ? 'Done' : 'Manage…'}</button>{/if}
      </div>
      {#if manage && hosts !== null}
        <div class="machines-row" id="machines"><Machines {api} {hosts} {cloud} disabled={started} onchange={machinesChanged} onbusy={(b) => (machinesBusy = b)} /></div>
      {/if}
      {#if keys.length || keysError}
      <span class="label">Keys</span>
      <div class="value">
        <span>{keysText_}</span>
        {#if keysError}<span class="error">{keysError}</span>{/if}
        {#if keys.length}<button onclick={() => (manageKeys = !manageKeys)} aria-expanded={manageKeys} aria-controls="keys" aria-label={manageKeys ? 'Done with keys' : 'Manage keys'} disabled={started}>{manageKeys ? 'Done' : 'Manage…'}</button>{/if}
      </div>
      {#if manageKeys}
        <div class="machines-row" id="keys"><Keys {api} {keys} cli={cliKeys} disabled={started} onchange={keysChanged} onbusy={(b) => (keysBusy = b)} /></div>
      {/if}
      {/if}
      {#if graph !== FULL_GRAPH}
      <span class="label" id="graph-label">Graph</span>
      <div class="value graphs">
        <div class="segments" role="radiogroup" aria-labelledby="graph-label">
          {#each graphs as g (g.file)}
            <label class="segment" class:on={graph === g.file} title={g.description}>
              <input type="radio" name="graph" checked={graph === g.file} disabled={started} onchange={() => chooseGraph(g.file)} />{stem(g.file)}
            </label>
          {/each}
        </div>
        {#if chosenGraph}<p class="muted">{chosenGraph.description}</p>{/if}
      </div>
      {/if}
    </div>
  {/if}

  {#if plan}
    <section class="plan" aria-label={started ? 'Run' : 'Plan'}>
      <h3>
        {#if started}{headline}
        {:else}{stepCount} {stepCount === 1 ? 'step' : 'steps'} to run{#if timeText}, {timeText}{/if}{#if cost}, ${cost.toFixed(2)}{/if}{/if}
      </h3>
      {#if total?.unknown.length && !started}<p class="muted">Not counting {list(total.unknown)}, which {total.unknown.length === 1 ? 'has' : 'have'} not run here before.</p>{/if}
      <ol class="steps">
        {#each started ? active?.nodes ?? [] : plan.nodes as n (n.id)}
          {@const s = view.nodes[n.id]}
          {@const on = pick.chosen.includes(n.id)}
          {@const needers = pick.neededBy[n.id]}
          {@const before = on || !canPick(plan) ? [] : mustTurnOnFirst(plan, wanted ?? defaultFeatures(plan), n.id, ticked)}   <!-- steps to turn on first -->
          <li class="step {started ? s.state : ''}" class:off={!on} aria-label={n.id}>
            <span class="pick">{#if !started && canPick(plan)}<input type="checkbox" aria-label={`Run ${title(n)}`} checked={on} disabled={!!needers || before.length > 0}
              aria-describedby={needers ? `needed-${n.id}` : before.length ? `before-${n.id}` : undefined}
              title={needers ? `Needed by ${list(needers.map(titleOf))}` : undefined} onchange={(e) => toggle(n.id, e.currentTarget.checked)} />{/if}</span>
            <button class="name" aria-expanded={open === n.id} aria-controls={`details-${n.id}`} onclick={() => (open = open === n.id ? null : n.id)}>
              <span class="chev" aria-hidden="true"></span>{title(n)}
            </button>
            <span class="where">
              {#if n.cached}<span class="muted">Already done</span>
              {:else if n.service}<span title={n.place ?? undefined}>{n.service} (cloud)</span>
              {:else if !started && on && (n.options?.length ?? 0) > 1}
                <select aria-label={`Where ${n.id} runs`} value={n.place} onchange={(e) => choosePlace(n.id, e.currentTarget.value)}>
                  {#each n.options ?? [] as o (o)}<option value={o} title={n.estimates?.[o]?.estimate_basis}>{placeLabel(n, o, plan.places)}</option>{/each}
                </select>
              {:else if n.place}<span title={n.place}>{placeName(n.place, plan.places)}</span>
              {:else if n.where}{n.where}   <!-- a CLI from before plans named places -->
              {:else}<span class="error">Cannot run here</span>{/if}
            </span>
            <span class="track" aria-hidden="true">
              {#if on && (n.cached || started)}
                {@const f = progress(n, s.state)}
                {#if f == null}<span class="bar busy"></span>{:else if f > 0}<span class="bar" style:width="{f * 100}%"></span>{/if}
              {/if}
            </span>
            <span class="time" title={n.estimate_basis}>
              {#if started}<span class="state">{STATE_LABEL[s.state]}</span>
              {:else if on && !n.cached && n.estimate_s != null}{duration(n.estimate_s)}
              {:else if on && !n.cached && 'estimate_s' in n}<span class="muted">No estimate</span>{/if}
            </span>
            <div class="notes">
              {#if started}{#if s.message}<span class="muted">{s.message}</span>{/if}
              {:else if on}
                {#if needers}<span class="muted" id={`needed-${n.id}`}>Needed by {list(needers.map(titleOf))}</span>{/if}
                <!-- a machine that costs money is priced for its whole deadline: the most it can cost -->
                {#if n.cost_usd}<span>{machineCost(plan, n) ? 'Up to ' : ''}${n.cost_usd.toFixed(2)}</span>{/if}
                {#if n.why_not}<span class="error">{n.why_not}</span>{/if}
                {#each n.missing_secrets as k (k)}<span class="error">Needs {k}</span>{/each}
              {:else if before.length}
                <span class="muted" id={`before-${n.id}`}>Turn on {list(before.map(titleOf))} first: {before.length === 1 ? 'it sends' : 'they send'} data off this machine</span>
              {/if}
            </div>
            {#if open === n.id}
              <!-- a model a setting picks shows as that setting, not as a fixed one -->
              {@const fixed = (n.models ?? []).filter((m) => !(n.settings ?? []).some((st) => st.choices.includes(m.id)))}
              <div class="details" id={`details-${n.id}`}>
                {#if n.description}<p>{n.description}.</p>{/if}
                <dl>
                  {#if n.outputs}<dt>Makes</dt><dd>{list(Object.keys(n.outputs))}</dd>{/if}
                  {#if fixed.length}<dt>Uses</dt>
                    <dd>{#each fixed as m (m.id)}<span title={m.source ?? undefined}>{m.id}</span> <span class="muted">({LICENCE[m.licence_mode] ?? m.licence_mode}{m.size_gb ? `, ${m.size_gb} GB` : ''})</span><br />{/each}</dd>{/if}
                  {#if n.downloads.length}<dt>Downloads first</dt>
                    <dd>{#each n.downloads as d (d.id)}<span title={d.source ?? undefined}>{d.id}</span> <span class="muted">({d.size_gb ? `${d.size_gb} GB` : 'size unknown'}, {LICENCE[d.licence_mode] ?? d.licence_mode}{d.gated ? ', gated: needs access granted on Hugging Face' : ''})</span><br />{/each}</dd>{/if}
                  <dt>Leaves this machine</dt><dd>{leaves(n)}</dd>
                  {#if n.service}<dt>Runs on</dt><dd>The {n.service}, in the cloud</dd>
                  {:else if n.options?.length}<dt>Can run on</dt>
                    <dd>{#each n.options as o (o)}<span title={n.estimates?.[o]?.estimate_basis}>{placeLabel(n, o, plan.places)}</span><br />{/each}</dd>{/if}
                  {#each n.settings ?? [] as st (st.key)}
                    <dt><label for={`set-${n.id}-${st.key}`}>{capital(st.key)}</label></dt>
                    <dd class="setting">
                      <select id={`set-${n.id}-${st.key}`} value={st.value} disabled={started} onchange={(e) => chooseSetting(n.id, st.key, e.currentTarget.value)}>
                        {#each st.choices as c (c)}<option value={c}>{choiceLabel(st, c)}</option>{/each}
                      </select>
                      {#if st.description}<span class="muted">{st.description}</span>{/if}
                    </dd>
                  {/each}
                </dl>
              </div>
            {/if}
          </li>
        {/each}
      </ol>

    </section>
  {/if}

  <footer>
    <div class="status" aria-live="polite">
      {#if error}<p class="error">{error}</p>{/if}
      {#each view.problems as p (p)}<p class="error">{p}</p>{/each}
      {#if view.status && view.status !== 'succeeded'}<p class="error">The run {view.status}. The step marked failed says why.</p>{/if}
      {#each why as b (b)}<p class="error">{b[0].toUpperCase() + b.slice(1)}.</p>{/each}
      {#if busy}<p class="muted">{busy}</p>{/if}
      {#if setup?.notice}<p class="muted">{setup.notice}.</p>{/if}
      {#if setup?.state === 'running'}
        <p class="muted">Setting up this version of the pipeline: each step's packages and model weights (a few GB the first time).
          {#if setup.steps.length}Done: {setup.steps.length}, last {stepTitle(setup.steps[setup.steps.length - 1])} ({setup.steps[setup.steps.length - 1].what}).{/if}
          Start run waits for it.</p>
      {:else if setup?.state === 'failed'}
        <p class="error">Setting up the pipeline failed: {setup.problem}. <button class="link" onclick={retrySetup} disabled={!!busy}>Try again</button></p>
      {/if}
      {#if view.imported}<p>Imported into the library.</p>
      {:else if started && !done && view.status === 'succeeded'}<p class="muted">Importing into the library…</p>{/if}
    </div>
    {#if done}<button onclick={onnew}>New run</button>{/if}
    {#if view.imported}
      <button class="primary" onclick={() => onopen(view.imported!.id)}>Open in Annotator</button>
    {:else if started && !done && view.status === 'succeeded'}
      <!-- nothing left to cancel -->
    {:else if started && !done}
      <button onclick={cancel}>Cancel run</button>
    {:else if !started && plan}
      <button class="primary" onclick={run} disabled={!canRun}>Start run</button>
    {/if}
  </footer>
</section>

<style>
  /* a page column: the plan a panel in it, the footer (Start run, the run's status) held at the window's foot */
  .extract { max-width: 920px; min-height: 100%; display: flex; flex-direction: column; }
  header { display: flex; align-items: flex-start; gap: 16px; padding: 28px 20px 16px; }
  .title { flex: 1; min-width: 0; }
  .pipeline { margin: 6px 0 0; font-size: 12px; color: var(--color-text-muted); }
  .pipeline span { color: var(--color-text-secondary); }
  p { margin: 0; }


  /* setup: what goes in (a video, a graph), label and value side by side */
  .setup { display: grid; grid-template-columns: 64px 1fr; gap: 12px 14px; align-items: baseline; padding: 4px 20px 18px; }
  .label { color: var(--color-text-muted); }
  .machines-row { grid-column: 1 / -1; }
  .value { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .file { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .graphs { flex-direction: column; align-items: flex-start; gap: 6px; }
  .segments { display: inline-flex; border: 1px solid var(--color-border-strong); border-radius: 7px; padding: 2px; background: var(--color-bg-surface); flex-wrap: wrap; }
  .segment { position: relative; padding: 3px 12px; border-radius: 5px; color: var(--color-text-secondary); cursor: pointer; }
  .segment input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }   /* the label is the control; the radio keeps it accessible */
  .segment.on { background: var(--color-bg-hover); color: var(--color-text-primary); box-shadow: inset 0 0 0 1px var(--color-border-strong); }
  .segment:has(input:focus-visible) { outline: 2px solid var(--color-info); outline-offset: 1px; }

  /* the plan: one row per step, its bar on a shared clock (when it starts after what it needs, how long it takes) */
  .plan { background: var(--color-bg-surface); border: 1px solid var(--color-border-default); border-radius: 10px; margin: 0 20px 20px; padding: 16px 20px 18px; }
  h3 { font-size: 15px; font-weight: 600; margin: 0; font-variant-numeric: tabular-nums; }
  .plan > .muted { font-size: 12px; margin-top: 2px; }
  .steps { list-style: none; margin: 14px 0 0; padding: 0; }
  .step { display: grid; grid-template-columns: 20px minmax(136px, 1fr) minmax(180px, 1.5fr) minmax(0, 1.4fr) 84px; column-gap: 10px; align-items: center;
          padding: 7px 0; border-top: 1px solid var(--color-border-default); }
  .step:first-child { border-top: 0; }
  .step.off > :not(.notes):not(.details):not(.name):not(.pick) { opacity: .45; }
  .step.off .name { color: var(--color-text-secondary); font-weight: 500; }
  .pick { display: flex; }
  .name { font: inherit; font-weight: 600; text-align: left; background: none; border: 0; padding: 0; border-radius: 3px; color: inherit; cursor: pointer;
          display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name:hover:not(:disabled) { background: none; text-decoration: underline; text-decoration-color: var(--color-border-strong); text-underline-offset: 3px; }
  .name:focus-visible { outline: 2px solid var(--color-info); outline-offset: 2px; }
  .chev { flex: none; width: 0; height: 0; border-left: 4px solid var(--color-text-muted); border-top: 4px solid transparent; border-bottom: 4px solid transparent; transition: transform .12s; }
  .name[aria-expanded="true"] .chev { transform: rotate(90deg); }
  .details { grid-column: 2 / -1; margin: 8px 0 4px; padding: 10px 12px; border-left: 2px solid var(--color-border-strong); background: rgba(255, 255, 255, .025);
             border-radius: 0 6px 6px 0; font-size: 12px; color: var(--color-text-secondary); max-width: 72ch; }
  .details p { margin-bottom: 8px; color: var(--color-text-primary); }
  .details dl { display: grid; grid-template-columns: max-content 1fr; gap: 5px 14px; margin: 0; }
  .details dt { color: var(--color-text-muted); }
  .details dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  .details .setting { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; }
  .where { color: var(--color-text-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .where select { max-width: 100%; }   /* a menu is as wide as its longest option (with its estimate): keep it in its column */
  .time { text-align: right; font-variant-numeric: tabular-nums; color: var(--color-text-secondary); white-space: nowrap; }
  .notes { grid-column: 3 / -1; display: flex; flex-wrap: wrap; gap: 2px 14px; font-size: 12px; min-width: 0; overflow-wrap: anywhere; }
  .notes:empty { display: none; }

  .track { position: relative; height: 8px; border-radius: 4px; background: rgba(255, 255, 255, .06); overflow: hidden; }
  /* progress, one colour: how far along a step is (full once done); a step running with no estimate slides */
  .bar { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 4px; background: var(--color-primary); transition: width .5s linear; }
  .bar.busy { width: 30%; animation: slide 1.4s ease-in-out infinite alternate; }
  .step.failed .state { color: var(--color-danger); }
  .step.succeeded .state, .step.cached .state { color: var(--color-primary); }
  @keyframes slide { from { left: 0; } to { left: 70%; } }
  @media (prefers-reduced-motion: reduce) { .bar { transition: none; } .bar.busy { animation: none; } }


  .empty { padding: 28px 20px 32px; color: var(--color-text-secondary); max-width: 60ch; }
  footer { display: flex; align-items: center; gap: 12px; padding: 14px 20px 18px; margin-top: auto; position: sticky; bottom: 0;
           background: var(--color-bg-base); }
  footer:has(button, p) { border-top: 1px solid var(--color-border-default); }   /* no rule under an empty page */
  .status { flex: 1; display: flex; flex-direction: column; gap: 3px; font-size: 12px; min-width: 0; }
  footer button { flex: none; padding: 6px 16px; }

  @media (max-width: 560px) {   /* name and time on top; where, the bar and notes under the name */
    .step { grid-template-columns: 20px 1fr auto; row-gap: 5px; }
    .pick { grid-area: 1 / 1; }
    .name { grid-area: 1 / 2; }
    .time { grid-area: 1 / 3; }
    .where { grid-area: 2 / 2 / 3 / 4; }
    .track { grid-area: 3 / 2 / 4 / 4; }
    .notes { grid-area: 4 / 2 / 5 / 4; }
    .details { grid-area: 5 / 2 / 6 / 4; }
  }
</style>
