<script lang="ts">
  // Run the perception pipeline on a video and import the bundle it makes: the pipeline folder (checked by
  // `perception doctor`), a video, one of the pipeline's graphs, the plan (where each node runs, what is cached, what
  // must be downloaded, what it costs), then the run, node by node.
  import { latestOnly } from '../latest';
  import { blockers, canPick, duration, foldRun, picked, placeLabel, placeName, placesFor, runnable, schedule, totalEstimate, type Places, type Doctor, type GraphPreset, type PipelineApi, type PipelineMessage, type Plan } from '../pipeline';

  let { api, onclose, onopen }: { api: PipelineApi; onclose: () => void; onopen: (bundleId: string) => void } = $props();

  let folder = $state<string | null>(null);
  let doctor = $state<Doctor | null>(null);
  let graphs = $state<GraphPreset[]>([]);
  let graph = $state<string | null>(null);
  let video = $state<string | null>(null);
  let plan = $state<Plan | null>(null);
  let allowDownloads = $state(false);
  let allowUploads = $state(false);
  let places = $state<Places>({});   // nodes the user moved to another place they can run here
  let skipped = $state(new Set<string>());   // steps the user unticked (what needs them is left out too)
  let msgs = $state.raw<PipelineMessage[]>([]);
  let started = $state(false);
  let error = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let stop: (() => void) | null = null;

  const pick = $derived(plan ? picked(plan, skipped) : { chosen: [], dropped: [], only: null });
  // the plan of what will run: the steps picked (time, cost, consent and blockers count only these)
  const active = $derived(plan ? { ...plan, nodes: plan.nodes.filter((n) => pick.chosen.includes(n.id)) } : null);
  function toggle(id: string, on: boolean) {
    const next = new Set(skipped);
    if (!on) next.add(id);
    else {   // ticking a step ticks back what it needs
      const need = (n: string) => { next.delete(n); for (const u of plan?.nodes.find((x) => x.id === n)?.needs ?? []) need(u); };
      need(id);
    }
    skipped = next;
  }
  const view = $derived(foldRun(active?.nodes.map((n) => n.id) ?? [], msgs));
  const done = $derived(!!view.imported || !!view.problems.length || (view.status !== null && view.status !== 'succeeded'));
  const downloads = $derived(active?.nodes.flatMap((n) => n.downloads) ?? []);
  const downloadGb = $derived(downloads.reduce((a, d) => a + (d.size_gb ?? 0), 0));
  const uploading = $derived(active?.nodes.filter((n) => n.uploads?.length) ?? []);   // cached ones too: a cache can go
  const consent = $derived({ downloads: allowDownloads, uploads: allowUploads });
  const canRun = $derived(!!active && active.nodes.length > 0 && !!graph && !!video && runnable(active, consent) && !started);
  const why = $derived(active && !started ? blockers(active, consent) : []);
  // what no box in "Before it runs" can fix (a node with no place here, a missing secret, an older CLI)
  const stuck = $derived(active && !started ? blockers(active, { downloads: true, uploads: true }) : []);
  const times = $derived(active ? schedule(active) : {});
  const span = $derived(Math.max(1, ...Object.values(times).map((t) => t.start + (t.seconds ?? 0))));
  let first = $state<HTMLButtonElement>();
  $effect(() => { first?.focus(); });   // the dialog takes the keyboard (the library behind it is inert)
  function onkeydown(e: KeyboardEvent) { if (e.key === 'Escape' && !(started && !done)) onclose(); }

  async function step(label: string, f: () => Promise<void>) {
    busy = label; error = null;
    try { await f(); } catch (e) { error = String(e); } finally { busy = null; }
  }
  const loadFolder = () => step('Checking the pipeline…', async () => {
    folder = await api.folder();
    if (!folder) return;
    [doctor, graphs] = await Promise.all([api.doctor(), api.graphs()]);
  });
  $effect(() => { loadFolder(); return () => stop?.(); });

  const chooseFolder = () => step('Checking the pipeline…', async () => {
    const path = await api.pickFolder();
    if (!path) return;
    doctor = await api.setFolder(path);
    folder = path;
    // another pipeline: its graphs are not the old ones, and no plan or permission carries over (a plan still in
    // flight from the old one is superseded too)
    graph = null; plan = null; allowDownloads = false; allowUploads = false; places = {}; skipped = new Set();
    newestPlan(Promise.resolve(null), (p) => (plan = p), () => {});
    graphs = await api.graphs();
  });
  const chooseVideo = async () => { const v = await api.pickVideo(); if (v) { video = v; await makePlan(); } };
  const chooseGraph = async (file: string) => { graph = file; places = {}; skipped = new Set(); await makePlan(); };
  const choosePlace = async (node: string, place: string) => { places = { ...places, [node]: place }; await makePlan(); };
  const total = $derived(active ? totalEstimate(active) : null);
  const cost = $derived(active?.nodes.filter((n) => !n.cached).reduce((a, n) => a + n.cost_usd, 0) ?? 0);
  // A permission to download is for the plan on screen: a new plan takes it back. Only the newest plan request may set
  // the plan, so a slow one cannot show one graph while another would run.
  const newestPlan = latestOnly();
  const makePlan = async () => {
    plan = null; allowDownloads = false; allowUploads = false; error = null;
    if (!graph || !video) return;
    busy = 'Planning…';
    newestPlan(api.plan(graph, video, places), (p) => { plan = p; busy = null; }, (e) => { error = String(e); busy = null; });
  };
  const run = () => step('Starting…', async () => {
    started = true; msgs = [];
    try { stop = await api.run(graph!, video!, consent, placesFor(places, pick.chosen), pick.only, (m) => { msgs = [...msgs, m]; }); }
    catch (e) { started = false; throw e; }   // not started after all: the dialog stays usable, with the reason
  });
  const cancel = () => step('Canceling…', async () => { await api.cancel(view.run); });   // no id yet: its process is stopped

  const name = (p: string | null) => p?.split('/').pop() ?? '';
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
  const missing = $derived([...(uploading.length && !allowUploads ? ['the upload'] : []), ...(downloads.length && !allowDownloads ? ['the download'] : [])]);
</script>

<svelte:window {onkeydown} />
<div class="backdrop"></div>
<div class="dialog" role="dialog" aria-modal="true" aria-label="Run the pipeline">
  <header>
    <div class="title">
      <h2>Run the pipeline</h2>
      {#if folder}
        <p class="pipeline">
          <span title={folder}>{name(folder)}</span>{#if doctor}, {doctor.nodes.filter((n) => n.where).length} of {doctor.nodes.length} nodes can run on this {doctor.platform.startsWith('darwin') ? 'Mac' : 'machine'} ({doctor.accelerators.map((a) => placeName(`native:${a}`)).join(', ')}){/if}
          <button class="link" onclick={chooseFolder} disabled={started}>Change…</button>
        </p>
      {/if}
    </div>
    <button bind:this={first} class="close" onclick={onclose} disabled={started && !done}>Close</button>
  </header>

  {#if !folder}
    <div class="empty">
      <p>Choose your hyperstudy-perception folder. The app runs its <code>perception</code> command with the uv it bundles.</p>
      <button class="primary" onclick={chooseFolder}>Choose…</button>
    </div>
  {:else}
    <div class="setup">
      <span class="label">Video</span>
      <div class="value">
        {#if video}<span class="file" title={video}>{name(video)}</span>{:else}<span class="muted">None chosen</span>{/if}
        <button onclick={chooseVideo} disabled={started}>{video ? 'Change…' : 'Choose…'}</button>
      </div>
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
          {@const off = pick.dropped.includes(n.id)}
          {@const t = times[n.id]}
          <li class="step {started ? s.state : ''}" class:off aria-label={n.id}>
            <span class="pick">{#if !started && canPick(plan)}<input type="checkbox" aria-label={`Run ${n.id}`} checked={!off} onchange={(e) => toggle(n.id, e.currentTarget.checked)} />{/if}</span>
            <span class="name">{n.id}</span>
            <span class="where">
              {#if n.cached}<span class="muted">Already done</span>
              {:else if !started && !off && (n.options?.length ?? 0) > 1}
                <select aria-label={`Where ${n.id} runs`} value={n.place} onchange={(e) => choosePlace(n.id, e.currentTarget.value)}>
                  {#each n.options ?? [] as o (o)}<option value={o} title={n.estimates?.[o]?.estimate_basis}>{placeLabel(n, o)}</option>{/each}
                </select>
              {:else if n.place}<span title={n.place}>{placeName(n.place)}</span>
              {:else if n.where}{n.where}   <!-- a CLI from before plans named places -->
              {:else}<span class="error">Cannot run here</span>{/if}
            </span>
            <span class="track" aria-hidden="true">
              {#if n.cached}<span class="bar done"></span>
              {:else if t && !off}
                <span class="bar" class:unknown={t.seconds == null}
                      style:left="{(t.start / span) * 100}%" style:width={t.seconds == null ? null : `${Math.max((t.seconds / span) * 100, 1.5)}%`}></span>
              {/if}
            </span>
            <span class="time" title={n.estimate_basis}>
              {#if started}<span class="state">{STATE_LABEL[s.state]}</span>
              {:else if !off && !n.cached && n.estimate_s != null}{duration(n.estimate_s)}
              {:else if !off && !n.cached && 'estimate_s' in n}<span class="muted">No estimate</span>{/if}
            </span>
            <div class="notes">
              {#if off}<span class="muted">Left out{skipped.has(n.id) ? '' : `, because it needs ${list((n.needs ?? []).filter((u) => pick.dropped.includes(u)))}`}</span>
              {:else if started}{#if s.message}<span class="muted">{s.message}</span>{/if}
              {:else}
                {#if n.uploads?.length}<span class="caution">Sends {list(n.uploads)} off this machine</span>{/if}
                {#if n.cost_usd}<span>${n.cost_usd.toFixed(2)}</span>{/if}
                {#each n.downloads as d (d.id)}<span class="muted">Downloads {d.id} ({d.size_gb ? `${d.size_gb} GB` : 'size unknown'}{d.gated ? ', gated' : ''}, {d.licence_mode})</span>{/each}
                {#if n.why_not}<span class="error">{n.why_not}</span>{/if}
                {#each n.missing_secrets as k (k)}<span class="error">Needs {k}</span>{/each}
              {/if}
            </div>
          </li>
        {/each}
      </ol>

      {#if (uploading.length || downloads.length) && !started}
        <fieldset class="consent">
          <legend>Before it runs</legend>
          {#if uploading.length}
            <label><input type="checkbox" bind:checked={allowUploads} /> Send {list([...new Set(uploading.flatMap((n) => n.uploads ?? []))])} off this machine, for {list(uploading.map((n) => n.id))}</label>
          {/if}
          {#if downloads.length}
            <label><input type="checkbox" bind:checked={allowDownloads} /> Download {downloads.length === 1 ? downloads[0].id : `${downloads.length} models`}{downloadGb ? ` (${downloadGb.toFixed(1)} GB)` : ''} to this machine</label>
          {/if}
        </fieldset>
      {/if}
    </section>
  {/if}

  <footer>
    <div class="status" aria-live="polite">
      {#if error}<p class="error">{error}</p>{/if}
      {#each view.problems as p (p)}<p class="error">{p}</p>{/each}
      {#if view.status && view.status !== 'succeeded'}<p class="error">The run {view.status}. The step marked failed says why.</p>{/if}
      {#each stuck as b (b)}<p class="error">{b[0].toUpperCase() + b.slice(1)}.</p>{/each}
      {#if !stuck.length && why.length && missing.length}<p class="muted">Allow {list(missing)} above to start.</p>{/if}
      {#if busy}<p class="muted">{busy}</p>{/if}
      {#if view.imported}<p>Imported into the library.</p>
      {:else if started && !done && view.status === 'succeeded'}<p class="muted">Importing into the library…</p>{/if}
    </div>
    {#if view.imported}
      <button class="primary" onclick={() => onopen(view.imported!.id)}>Open</button>
    {:else if started && !done && view.status === 'succeeded'}
      <!-- nothing left to cancel -->
    {:else if started && !done}
      <button onclick={cancel}>Cancel run</button>
    {:else if !started && plan}
      <button class="primary" onclick={run} disabled={!canRun}>Start run</button>
    {/if}
  </footer>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, .55); z-index: 44; }
  .dialog { position: fixed; top: 6vh; left: 50%; transform: translateX(-50%); width: min(780px, calc(100vw - 32px)); max-height: 88vh; overflow: auto;
            z-index: 45; background: var(--color-bg-elevated); border: 1px solid var(--color-border-strong); border-radius: 10px;
            box-shadow: 0 24px 64px rgba(0, 0, 0, .5); display: flex; flex-direction: column; }
  header { display: flex; align-items: flex-start; gap: 16px; padding: 18px 20px 14px; }
  .title { flex: 1; min-width: 0; }
  h2 { font-size: 17px; font-weight: 600; margin: 0; }
  .pipeline { margin: 3px 0 0; font-size: 12px; color: var(--color-text-muted); }
  .pipeline span { color: var(--color-text-secondary); }
  .pipeline .link { font-size: 12px; margin-left: 6px; }
  .close { flex: none; }
  p { margin: 0; }

  .empty { padding: 28px 20px 32px; display: flex; flex-direction: column; align-items: flex-start; gap: 12px; color: var(--color-text-secondary); max-width: 60ch; }

  /* setup: what goes in (a video, a graph), label and value side by side */
  .setup { display: grid; grid-template-columns: 64px 1fr; gap: 12px 14px; align-items: baseline; padding: 4px 20px 18px; }
  .label { color: var(--color-text-muted); }
  .value { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .file { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .graphs { flex-direction: column; align-items: flex-start; gap: 6px; }
  .segments { display: inline-flex; border: 1px solid var(--color-border-strong); border-radius: 7px; padding: 2px; background: var(--color-bg-surface); flex-wrap: wrap; }
  .segment { position: relative; padding: 3px 12px; border-radius: 5px; color: var(--color-text-secondary); cursor: pointer; }
  .segment input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }   /* the label is the control; the radio keeps it accessible */
  .segment.on { background: var(--color-bg-hover); color: var(--color-text-primary); box-shadow: inset 0 0 0 1px var(--color-border-strong); }
  .segment:has(input:focus-visible) { outline: 2px solid var(--color-info); outline-offset: 1px; }

  /* the plan: one row per step, its bar on a shared clock (when it starts after what it needs, how long it takes) */
  .plan { background: var(--color-bg-surface); border-top: 1px solid var(--color-border-default); border-bottom: 1px solid var(--color-border-default); padding: 16px 20px 18px; }
  h3 { font-size: 15px; font-weight: 600; margin: 0; font-variant-numeric: tabular-nums; }
  .plan > .muted { font-size: 12px; margin-top: 2px; }
  .steps { list-style: none; margin: 14px 0 0; padding: 0; }
  .step { display: grid; grid-template-columns: 20px minmax(72px, .8fr) minmax(180px, 1.6fr) minmax(0, 1.6fr) 84px; column-gap: 10px; align-items: center;
          padding: 7px 0; border-top: 1px solid var(--color-border-default); }
  .step:first-child { border-top: 0; }
  .step.off > :not(.notes) { opacity: .45; }
  .pick { display: flex; }
  .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .where { color: var(--color-text-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .where select { max-width: 100%; }   /* a menu is as wide as its longest option (with its estimate): keep it in its column */
  .time { text-align: right; font-variant-numeric: tabular-nums; color: var(--color-text-secondary); white-space: nowrap; }
  .notes { grid-column: 3 / -1; display: flex; flex-wrap: wrap; gap: 2px 14px; font-size: 12px; min-width: 0; overflow-wrap: anywhere; }
  .notes:empty { display: none; }
  .caution { color: var(--color-caution); }

  .track { position: relative; height: 8px; border-radius: 4px; background: rgba(255, 255, 255, .04); }
  .bar { position: absolute; top: 0; bottom: 0; border-radius: 4px; background: #5a5a5a; }
  .bar.unknown { width: 28px; background: repeating-linear-gradient(135deg, #555 0 3px, transparent 3px 6px); }   /* no estimate: no length to draw */
  .bar.done { left: 0; right: 0; background: var(--color-primary); }   /* already done: nothing left to run */
  /* during the run the same bars show each step's state */
  .step.running .bar, .step.retrying .bar { background: var(--color-info); animation: pulse 1.6s ease-in-out infinite; }
  .step.retrying .bar { background: var(--color-caution); }
  .step.succeeded .bar, .step.cached .bar { background: var(--color-primary); }
  .step.failed .bar { background: var(--color-danger); }
  .step.canceled .bar { background: #444; }
  .step.running .state { color: var(--color-info); }
  .step.retrying .state { color: var(--color-caution); }
  .step.succeeded .state, .step.cached .state { color: var(--color-primary); }
  .step.failed .state { color: var(--color-danger); }
  @keyframes pulse { 50% { opacity: .55; } }
  @media (prefers-reduced-motion: reduce) { .step.running .bar, .step.retrying .bar { animation: none; } }

  .consent { margin: 16px 0 0; padding: 10px 14px 12px; border: 1px solid rgba(251, 191, 36, .35); border-radius: 8px; background: var(--color-caution-light);
             display: flex; flex-direction: column; gap: 6px; }
  .consent legend { padding: 0 4px; margin-left: -4px; color: var(--color-caution); font-weight: 600; }
  .consent label { display: flex; gap: 8px; align-items: baseline; }

  footer { display: flex; align-items: center; gap: 16px; padding: 14px 20px 18px; }
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
  }
</style>
