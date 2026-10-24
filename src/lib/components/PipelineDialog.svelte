<script lang="ts">
  // Run the perception pipeline on a video and import the bundle it makes: the pipeline folder (checked by
  // `perception doctor`), a video, one of the pipeline's graphs, the plan (where each node runs, what is cached, what
  // must be downloaded, what it costs), then the run, node by node.
  import { foldRun, runnable, type Doctor, type GraphPreset, type PipelineApi, type PipelineMessage, type Plan } from '../pipeline';

  let { api, onclose, onopen }: { api: PipelineApi; onclose: () => void; onopen: (bundleId: string) => void } = $props();

  let folder = $state<string | null>(null);
  let doctor = $state<Doctor | null>(null);
  let graphs = $state<GraphPreset[]>([]);
  let graph = $state<string | null>(null);
  let video = $state<string | null>(null);
  let plan = $state<Plan | null>(null);
  let allowDownloads = $state(false);
  let msgs = $state.raw<PipelineMessage[]>([]);
  let started = $state(false);
  let error = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let stop: (() => void) | null = null;

  const view = $derived(foldRun(plan?.nodes.map((n) => n.id) ?? [], msgs));
  const done = $derived(!!view.imported || !!view.problems.length || (view.status !== null && view.status !== 'succeeded'));
  const downloads = $derived(plan?.nodes.flatMap((n) => n.downloads) ?? []);
  const downloadGb = $derived(downloads.reduce((a, d) => a + (d.size_gb ?? 0), 0));
  const canRun = $derived(!!plan && runnable(plan, allowDownloads) && !started);

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
    graphs = await api.graphs();
  });
  const chooseVideo = async () => { const v = await api.pickVideo(); if (v) { video = v; await makePlan(); } };
  const chooseGraph = async (file: string) => { graph = file; await makePlan(); };
  const makePlan = () => step('Planning…', async () => {
    plan = null;
    if (graph && video) plan = await api.plan(graph, video);
  });
  const run = () => step('Starting…', async () => {
    started = true; msgs = [];
    stop = await api.run(graph!, video!, allowDownloads, (m) => { msgs = [...msgs, m]; });
  });
  const cancel = () => step('Canceling…', async () => { if (view.run) await api.cancel(view.run); });

  const name = (p: string | null) => p?.split('/').pop() ?? '';
  const STATE_LABEL = { waiting: 'waiting', cached: 'cached', running: 'running', retrying: 'retrying', succeeded: 'done', failed: 'failed', canceled: 'canceled' };
</script>

<div class="backdrop"></div>
<div class="dialog" role="dialog" aria-modal="true" aria-label="Run the pipeline">
  <header><h2>Run the pipeline</h2><span class="spacer"></span><button onclick={onclose} disabled={started && !done}>Close</button></header>

  <section>
    <h3>Pipeline</h3>
    {#if folder}
      <div class="row"><code title={folder}>{folder}</code><button onclick={chooseFolder} disabled={started}>Change…</button></div>
      {#if doctor}<div class="meta">{doctor.platform} · {doctor.accelerators.join(', ')} · {doctor.nodes.filter((n) => n.where).length} of {doctor.nodes.length} nodes can run here</div>{/if}
    {:else}
      <div class="row"><span class="muted">Choose your hyperstudy-perception folder (the app runs its <code>perception</code> CLI with the uv it bundles).</span>
        <button class="primary" onclick={chooseFolder}>Choose…</button></div>
    {/if}
  </section>

  {#if folder}
    <section>
      <h3>Video</h3>
      <div class="row">{#if video}<code title={video}>{name(video)}</code>{:else}<span class="muted">None chosen.</span>{/if}
        <button onclick={chooseVideo} disabled={started}>{video ? 'Change…' : 'Choose…'}</button></div>
    </section>
    <section>
      <h3>Graph</h3>
      {#each graphs as g (g.file)}
        <label class="graph"><input type="radio" name="graph" checked={graph === g.file} disabled={started} onchange={() => chooseGraph(g.file)} />
          <span><b>{g.file}</b> <span class="meta">{g.description}</span></span></label>
      {/each}
    </section>
  {/if}

  {#if plan}
    <section>
      <h3>{started ? 'Run' : `Plan · estimated $${plan.estimated_usd.toFixed(2)}`}</h3>
      <table>
        <tbody>
          {#each plan.nodes as n (n.id)}
            {@const s = view.nodes[n.id]}
            <tr>
              <td class="node">{n.id}</td>
              <td class="where">{n.cached ? 'cached' : (n.where ?? 'cannot run here')}</td>
              <td>
                {#if started}<span class="state {s.state}">{STATE_LABEL[s.state]}</span> <span class="meta">{s.message}</span>
                {:else}
                  {#if n.cost_usd}<span>${n.cost_usd.toFixed(2)}</span>{/if}
                  {#if n.why_not}<span class="error">{n.why_not}</span>{/if}
                  {#each n.missing_secrets as k (k)}<span class="error">needs {k}</span>{/each}
                  {#each n.downloads as d (d.id)}<span class="meta">downloads {d.id} ({d.size_gb ? `${d.size_gb} GB` : 'size unknown'}{d.gated ? ', gated' : ''}, {d.licence_mode})</span>{/each}
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if downloads.length && !started}
        <label class="row"><input type="checkbox" bind:checked={allowDownloads} /> Download {downloads.length === 1 ? 'this model' : `these ${downloads.length} models`}{downloadGb ? ` (${downloadGb.toFixed(1)} GB)` : ''} before running</label>
      {/if}
    </section>
  {/if}

  {#if busy}<p class="muted">{busy}</p>{/if}
  {#if error}<p class="error">{error}</p>{/if}
  {#each view.problems as p (p)}<p class="error">{p}</p>{/each}
  {#if view.status && view.status !== 'succeeded'}<p class="error">The run {view.status}. The node marked failed says why.</p>{/if}

  <footer>
    {#if view.imported}
      <span class="muted">Imported into the library.</span>
      <button class="primary" onclick={() => onopen(view.imported!.id)}>Open</button>
    {:else if started && !done}
      <button onclick={cancel} disabled={!view.run}>Cancel run</button>
    {:else if !started}
      <button class="primary" onclick={run} disabled={!canRun}>Run</button>
    {/if}
  </footer>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, .45); z-index: 44; }
  .dialog { position: fixed; top: 6vh; left: 50%; transform: translateX(-50%); width: min(760px, calc(100vw - 32px)); max-height: 88vh; overflow: auto;
            z-index: 45; background: var(--color-bg-card); border: 1px solid var(--color-border-strong); border-radius: 8px; padding: 14px 16px; }
  header, footer, .row { display: flex; align-items: center; gap: 10px; }
  footer { justify-content: flex-end; margin-top: 12px; }
  h2 { font-size: 15px; margin: 0; }
  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--color-text-secondary); margin: 14px 0 6px; }
  .spacer { flex: 1; }
  code { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
  .meta { font-size: 12px; color: var(--color-text-secondary); }
  .graph { display: flex; gap: 8px; align-items: baseline; padding: 3px 0; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }   /* columns do not move as states change */
  td { padding: 4px 6px; border-top: 1px solid var(--color-border-default); vertical-align: top; }
  td span + span { margin-left: 8px; }
  .node { font-weight: 600; white-space: nowrap; width: 18%; }
  .where { white-space: nowrap; color: var(--color-text-secondary); width: 22%; }
  .state { font-size: 11px; padding: 1px 7px; border-radius: 9px; border: 1px solid var(--color-border-strong); }
  .state.running, .state.retrying { color: var(--color-caution); border-color: var(--color-caution); }
  .state.succeeded, .state.cached { color: var(--color-primary); border-color: var(--color-primary); }
  .state.failed, .state.canceled { color: var(--color-error, #ef4444); border-color: var(--color-error, #ef4444); }
</style>
