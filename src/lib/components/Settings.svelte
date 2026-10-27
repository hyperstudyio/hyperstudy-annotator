<script module lang="ts">
  /** A part of Settings another page can send you to (a step's missing key, Extract's "Add a remote server or cloud
   *  GPU", the rail's Update item). */
  export type SettingsSection = 'models' | 'machines' | 'updates';
</script>

<script lang="ts">
  // Settings, by what each thing is for: Models (what the steps' models need from you: a provider's key for shot
  // captions, access and a key for gated models), Machines (where steps can run: this computer, remote servers, cloud
  // GPU providers, each with what it needs, its key included) and App (its version and updates). A key appears where
  // it is used, not in a list of keys. This is the one place they are set; Extract shows what a run will use and sends
  // you here, and loads them again (and plans again) when you go back. Loaded again each time this page is shown.
  import { tick, untrack } from 'svelte';
  import Models from './Models.svelte';
  import Servers from './Servers.svelte';
  import Cloud from './Cloud.svelte';
  import { DOCS_URL, openExternal } from '../links';
  import type { Updates } from '../updates.svelte';
  import { placeName, type CliKeys, type CloudStatus, type Doctor, type Host, type KeyStatus, type ModelInfo, type PipelineApi } from '../pipeline';

  let { api, updates = null, active = true, holdRelaunch = null, relaunchCaution = null, show = null, onshown, onbusy }: {
    api: PipelineApi | null; updates?: Updates | null; active?: boolean;
    /** why the relaunch waits (a run going, or the pipeline being set up, which it would stop), or null */
    holdRelaunch?: string | null;
    /** what a relaunch might stop that could not be checked: said, without holding it */
    relaunchCaution?: string | null;
    /** bring a section into view (Extract's links, the rail's Update item); `onshown` once it is */
    show?: SettingsSection | null; onshown?: () => void;
    /** a key, server or the cloud being changed, then null: Start run on Extract waits for it */
    onbusy?: (busy: string | null) => void;
  } = $props();

  let keys = $state<KeyStatus[]>([]);
  let cli = $state<CliKeys | null>(null);
  let hosts = $state<Host[] | null>(null);   // null: a pipeline from before remote servers
  let cloud = $state<CloudStatus | null>(null);
  let doctor = $state<Doctor | null>(null);
  let models = $state<ModelInfo[] | null>(null);   // null: an older pipeline without `models`, or not listed yet
  let problems = $state<{ keys?: string; models?: string; servers?: string; cloud?: string; computer?: string }>({});
  let loaded = $state(false);
  // a tab per purpose; App (the version and its updates) is the only one without a pipeline (in a browser)
  type Tab = 'models' | 'machines' | 'app';
  const TABS: { key: Tab; label: string }[] = [{ key: 'models', label: 'Models' }, { key: 'machines', label: 'Machines' }, { key: 'app', label: 'App' }];
  // svelte-ignore state_referenced_locally
  let tab = $state<Tab>(api ? 'models' : 'app');
  let updatesSection = $state<HTMLElement>();
  const visibleTabs = $derived(TABS.filter((t) => t.key === 'app' || api).map((t) => t.key));
  function arrows(e: KeyboardEvent) {   // the tabs as one control: arrow keys move between them
    const i = visibleTabs.indexOf(tab), step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    tab = visibleTabs[(i + step + visibleTabs.length) % visibleTabs.length];
    (document.getElementById(`tab-${tab}`) as HTMLElement | null)?.focus();
  }

  // a pipeline from before a command does not know it (argparse: invalid choice); that is said as such, not as a failure
  const older = (r: PromiseSettledResult<unknown>, cmd: string) => r.status === 'rejected' && new RegExp(`invalid choice: '${cmd}'`).test(String(r.reason));
  const reason = (r: PromiseSettledResult<unknown>) => r.status === 'rejected' ? String(r.reason) : undefined;

  async function load(api: PipelineApi) {
    const [k, c, h, cl, d, m] = await Promise.allSettled([api.keys(), api.cliKeys(), api.hosts(), api.cloud(), api.doctor(), api.models()]);
    if (k.status === 'fulfilled') keys = k.value;
    cli = c.status === 'fulfilled' ? c.value : null;
    hosts = h.status === 'fulfilled' ? h.value : older(h, 'hosts') ? null : hosts;
    cloud = cl.status === 'fulfilled' ? cl.value : older(cl, 'cloud') ? null : cloud;
    if (d.status === 'fulfilled') doctor = d.value;
    models = m.status === 'fulfilled' ? m.value : null;
    problems = {
      keys: [reason(k), older(c, 'keys') ? undefined : reason(c)].filter(Boolean).join('; ') || undefined,
      models: older(m, 'models') ? undefined : reason(m),
      servers: older(h, 'hosts') ? undefined : reason(h),
      cloud: older(cl, 'cloud') ? undefined : reason(cl),
      computer: reason(d),
    };
    loaded = true;
  }
  $effect(() => { if (active && api) { const a = api; untrack(() => { load(a); }); } });
  // sent here at a part of Settings: its tab, then (the App tab's two parts) the part itself in view
  $effect(() => {
    if (!active || !show) return;
    const s = show;
    untrack(() => {
      tab = s === 'updates' ? 'app' : s;
      tick().then(() => { if (s === 'updates') updatesSection?.scrollIntoView({ block: 'start' }); onshown?.(); });
    });
  });
  const busy = (b: string | null) => onbusy?.(b);
  const u = $derived(updates?.phase);
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  const PLATFORM: Record<string, string> = { darwin: 'Mac', linux: 'Linux', windows: 'Windows' };
  const ARCH: Record<string, string> = { arm64: 'Apple silicon', aarch64: 'Arm', amd64: 'x86-64', x86_64: 'x86-64' };
  const pipeline = $derived(doctor?.pipeline?.version ? `Pipeline ${doctor.pipeline.version}` : 'The pipeline');
  const computer = $derived.by(() => {
    if (!doctor) return null;
    const [os, arch] = doctor.platform.split('/');
    const kind = os === 'darwin' && arch === 'arm64' ? 'Mac with Apple silicon' : `${PLATFORM[os] ?? os}${arch ? ` (${ARCH[arch] ?? arch})` : ''}`;
    const gpus = doctor.accelerators.filter((a) => a !== 'cpu').map((a) => placeName(`native:${a}`));
    return { kind, specs: `${doctor.cpu_cores} CPU cores, ${Math.round(doctor.memory_gb)} GB memory${gpus.length ? `, ${gpus.join(' and ')}` : ', no GPU the pipeline can use'}`,
             can: doctor.nodes.filter((n) => n.where).length, cannot: doctor.nodes.filter((n) => !n.where) };
  });
</script>

<section class="settings" aria-label="Settings">
  <header>
    <h1 class="page-title">Settings</h1>
  </header>

  <div class="tabs" role="tablist" aria-label="Settings" tabindex="-1" onkeydown={arrows}>
    {#each TABS as t (t.key)}
      {#if t.key === 'app' || api}
        <button role="tab" id={`tab-${t.key}`} aria-selected={tab === t.key} aria-controls={`panel-${t.key}`} tabindex={tab === t.key ? 0 : -1}
          class:on={tab === t.key} onclick={() => (tab = t.key)}>
          {t.label}
        </button>
      {/if}
    {/each}
  </div>

  <div class="panel-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
    {#if tab === 'models' && api}
      {#if problems.keys}<p class="error top">Could not read the keys: {problems.keys}</p>{/if}
      <Models {api} {keys} {cli} {models} problem={problems.models} onkeys={(now) => (keys = now)} onbusy={busy} />
      <p class="foot muted">Keys are kept in this computer's keychain, and each step gets only the keys it needs.</p>
    {:else if tab === 'machines' && api}
      <!-- what this computer can run: one line, with the steps it cannot and why only when there are some -->
      <section class="set-part" aria-labelledby="computer-heading">
        <div class="set-head"><h2 id="computer-heading">This computer</h2></div>
        {#if computer}
          <p>{computer.kind}, {computer.specs}.</p>
          <p class="muted">{computer.cannot.length ? `${computer.can} of ${doctor!.nodes.length} steps can run here.` : `All ${doctor!.nodes.length} steps can run here.`}</p>
          {#if computer.cannot.length}
            <ul class="cannot">
              {#each computer.cannot as n (n.ref)}<li><span>{n.description || n.ref}</span> <span class="muted">{n.why_not}</span></li>{/each}
            </ul>
          {/if}
        {:else if problems.computer}<p class="error">Could not check this computer: {problems.computer}</p>
        {:else}<p class="muted">Checking…</p>{/if}
      </section>
      {#if problems.servers}<p class="error">Could not list the remote servers: {problems.servers}</p>{/if}
      {#if hosts !== null}<Servers {api} {hosts} onchange={(now) => (hosts = now)} onbusy={busy} />
      {:else if loaded && !problems.servers}<p class="muted">This pipeline runs every step on this computer. Update hyperstudy-perception to use other machines.</p>{/if}
      {#if problems.cloud}<p class="error">Could not check the cloud GPU providers: {problems.cloud}</p>{/if}
      {#if cloud}<Cloud {api} {cloud} {keys} {cli} onchange={(now) => (cloud = now)} onkeys={(now) => (keys = now)} onbusy={busy} />
      {:else if loaded && !problems.cloud}<p class="muted">This pipeline cannot start cloud machines yet. Update hyperstudy-perception to use one.</p>{/if}
    {:else}
      <section class="set-part" aria-labelledby="updates-heading" bind:this={updatesSection}>
        <div class="set-head"><h2 id="updates-heading">Updates</h2></div>
        <p>{updates?.version ? `Version ${updates.version}` : 'HyperStudy Annotator'}. <button class="link" onclick={() => openExternal(DOCS_URL)}>Documentation</button></p>
        {#if !updates || !u}
          <p class="muted">The desktop app updates itself. In a browser, add <code>?update-demo</code> to the address to try it against a stand-in.</p>
        {:else if u.kind === 'available' || u.kind === 'downloading' || u.kind === 'ready'}
          <div class="panel update" aria-live="polite">
            {#if u.kind === 'available'}
              <p><strong>Version {u.version} is available.</strong></p>
              {#if u.notes}<p class="notes">{u.notes}</p>{/if}
              <div class="row"><button class="primary" onclick={() => updates.install()}>Install update</button>
                <span class="muted">It downloads now; the app relaunches when you say.</span></div>
            {:else if u.kind === 'downloading'}
              <p>Downloading version {u.version}{#if u.fraction != null}, {Math.round(u.fraction * 100)}%{/if}…</p>
              <div class="track" role="progressbar" aria-label="Download" aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={u.fraction == null ? undefined : Math.round(u.fraction * 100)}>
                <span class="bar" class:busy={u.fraction == null} style:width={u.fraction == null ? undefined : `${u.fraction * 100}%`}></span>
              </div>
            {:else}
              <p><strong>Version {u.version} is installed.</strong> Relaunch to finish: your corrections are saved as you make them.</p>
              <div class="row"><button class="primary" onclick={() => updates.relaunch()} disabled={!!holdRelaunch}>Relaunch now</button>
                {#if holdRelaunch}<span class="muted">{holdRelaunch}</span>{:else if relaunchCaution}<span class="caution">{relaunchCaution}</span>{/if}</div>
            {/if}
          </div>
        {:else}
          <div class="row" aria-live="polite">
            <button onclick={() => updates.check()} disabled={u.kind === 'checking'}>{u.kind === 'failed' ? 'Try again' : 'Check for updates'}</button>
            {#if u.kind === 'checking'}<span class="muted">Checking…</span>
            {:else if u.kind === 'current'}<span class="muted">Up to date, as of {time(u.at)}.</span>
            {:else if u.kind === 'failed'}<span class="error">{u.op === 'check' ? 'Could not check for updates' : 'The update did not install'}: {u.message}</span>
            {:else if updates.quietError}<span class="muted">The last check could not reach the releases ({updates.quietError}).</span>{/if}
          </div>
        {/if}
      </section>

      {#if doctor?.pipeline?.version}<p class="muted pipeline">{pipeline}.</p>{/if}
    {/if}
  </div>
</section>

<style>
  .settings { max-width: 760px; padding: 28px 24px 48px; }
  header { margin-bottom: 18px; }
  /* tabs on a rule; the one open sits on it in the accent, with its state beside its name */
  .tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--color-border-default); overflow-x: auto; }
  .tabs button { background: none; border: 0; border-radius: 6px 6px 0 0; padding: 8px 12px 9px; color: var(--color-text-muted); white-space: nowrap;
                 display: inline-flex; gap: 7px; align-items: baseline; box-shadow: inset 0 -2px 0 transparent; }
  .tabs button:hover:not(.on) { color: var(--color-text-secondary); background: none; }
  .tabs button.on { color: var(--color-text-primary); font-weight: 500; box-shadow: inset 0 -2px 0 var(--color-primary); }
  .tabs button:focus-visible { outline: 2px solid var(--color-info); outline-offset: -2px; }
  .foot { font-size: 12px; margin-top: 18px; }
  .top { margin-top: 16px; }
  .pipeline { margin-top: 12px; }
  p { margin: 0; }
  .panel { padding: 12px 14px; border: 1px solid var(--color-border-default); background: var(--color-bg-surface); border-radius: 8px; display: grid; gap: 8px; }
  .cannot { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 12px; }
  .cannot li { display: flex; gap: 10px; flex-wrap: wrap; }
  .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .caution { color: var(--color-caution); }
  .update { border-color: var(--color-primary); background: var(--color-primary-light); }
  .notes { white-space: pre-line; color: var(--color-text-secondary); max-height: 10em; overflow: auto; }
  .track { position: relative; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, .08); overflow: hidden; }
  .bar { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; background: var(--color-primary); transition: width .3s linear; }
  .bar.busy { width: 30%; animation: slide 1.4s ease-in-out infinite alternate; }
  @keyframes slide { from { left: 0; } to { left: 70%; } }
  @media (prefers-reduced-motion: reduce) { .bar { transition: none; } .bar.busy { animation: none; } }
  code { font-size: 12px; }
</style>
