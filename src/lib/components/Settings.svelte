<script lang="ts">
  // Settings: the keys the pipeline's steps use, the machines they can run on, what this computer can run, and the
  // app's version and its updates. The keys and machines are the same controls Extract offers beside a plan; Extract
  // loads them again when you go back to it, and this page loads them again each time it is shown.
  import { untrack } from 'svelte';
  import Keys from './Keys.svelte';
  import Machines from './Machines.svelte';
  import { DOCS_URL, openExternal } from '../links';
  import type { Updates } from '../updates.svelte';
  import { placeName, type CliKeys, type CloudStatus, type Doctor, type Host, type KeyStatus, type PipelineApi } from '../pipeline';

  let { api, updates = null, active = true, holdRelaunch = null, showUpdates = false, onshown }: {
    api: PipelineApi | null; updates?: Updates | null; active?: boolean;
    /** a pipeline run is going: a relaunch now would stop it */
    /** why the relaunch waits (a run going, or the pipeline being set up, which it would stop), or null */
    holdRelaunch?: string | null;
    /** bring the updates into view (the rail's Update item); `onshown` once they are */
    showUpdates?: boolean; onshown?: () => void;
  } = $props();

  let keys = $state<KeyStatus[]>([]);
  let cli = $state<CliKeys | null>(null);
  let hosts = $state<Host[] | null>(null);   // null: a pipeline from before lab servers
  let cloud = $state<CloudStatus | null>(null);
  let doctor = $state<Doctor | null>(null);
  let problems = $state<{ keys?: string; machines?: string; computer?: string }>({});
  let loaded = $state(false);
  let updatesSection = $state<HTMLElement>();

  // a pipeline from before a command does not know it (argparse: invalid choice); that is said as such, not as a failure
  const older = (r: PromiseSettledResult<unknown>, cmd: string) => r.status === 'rejected' && new RegExp(`invalid choice: '${cmd}'`).test(String(r.reason));
  const reason = (r: PromiseSettledResult<unknown>) => r.status === 'rejected' ? String(r.reason) : undefined;

  async function load(api: PipelineApi) {
    const [k, c, h, cl, d] = await Promise.allSettled([api.keys(), api.cliKeys(), api.hosts(), api.cloud(), api.doctor()]);
    if (k.status === 'fulfilled') keys = k.value;
    cli = c.status === 'fulfilled' ? c.value : null;
    hosts = h.status === 'fulfilled' ? h.value : older(h, 'hosts') ? null : hosts;
    cloud = cl.status === 'fulfilled' ? cl.value : older(cl, 'cloud') ? null : cloud;
    if (d.status === 'fulfilled') doctor = d.value;
    problems = {
      keys: [reason(k), older(c, 'keys') ? undefined : reason(c)].filter(Boolean).join('; ') || undefined,
      machines: [older(h, 'hosts') ? undefined : reason(h), older(cl, 'cloud') ? undefined : reason(cl)].filter(Boolean).join('; ') || undefined,
      computer: reason(d),
    };
    loaded = true;
  }
  $effect(() => { if (active && api) { const a = api; untrack(() => { load(a); }); } });
  $effect(() => { if (active && showUpdates && updatesSection) { updatesSection.scrollIntoView({ block: 'start' }); onshown?.(); } });
  const u = $derived(updates?.phase);
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  const PLATFORM: Record<string, string> = { darwin: 'Mac', linux: 'Linux', windows: 'Windows' };
  const ARCH: Record<string, string> = { arm64: 'Apple silicon', aarch64: 'Arm', amd64: 'x86-64', x86_64: 'x86-64' };
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
    <p class="page-lead">The keys the pipeline's steps use and the machines they can run on. Extract uses whatever is set here.</p>
  </header>

  {#if !api}
    <p class="muted">The pipeline's settings live in the desktop app. In a browser, add <code>?pipeline-demo</code> to the address to try them against a stand-in.</p>
  {:else}
    <section class="group" aria-labelledby="keys-heading">
      <h2 id="keys-heading">API keys</h2>
      <p class="lead">Steps that call a cloud service, or download a model that needs permission, use these.</p>
      {#if problems.keys}<p class="error">Could not read the keys: {problems.keys}</p>{/if}
      {#if keys.length}<Keys {api} {keys} {cli} onchange={(now) => (keys = now)} onbusy={() => {}} />
      {:else if loaded && !problems.keys}<p class="muted">This pipeline uses no keys.</p>{/if}
    </section>

    <section class="group" aria-labelledby="machines-heading">
      <h2 id="machines-heading">Machines</h2>
      <p class="lead">Heavy steps can run on a lab server or a cloud GPU instead of this computer. Choose where each step runs on Extract.</p>
      {#if problems.machines}<p class="error">Could not list the machines: {problems.machines}</p>{/if}
      {#if hosts !== null}
        <Machines {api} {hosts} {cloud} onchange={(now) => { if (now.hosts) hosts = now.hosts; if (now.cloud) cloud = now.cloud; }} onbusy={() => {}} />
      {:else if loaded}<p class="muted">This pipeline runs every step on this computer. Update hyperstudy-perception to use other machines.</p>{/if}
    </section>

    <section class="group" aria-labelledby="computer-heading">
      <h2 id="computer-heading">This computer</h2>
      {#if computer}
        <p class="lead">{computer.kind}: {computer.specs}.</p>
        <div class="panel">
          <p><strong>{computer.can} of {doctor!.nodes.length}</strong> pipeline steps can run here.</p>
          {#if computer.cannot.length}
            <ul class="cannot">
              {#each computer.cannot as n (n.ref)}<li><span>{n.description || n.ref}</span> <span class="muted">{n.why_not}</span></li>{/each}
            </ul>
          {/if}
        </div>
      {:else if problems.computer}<p class="error">Could not check this computer: {problems.computer}</p>
      {:else}<p class="muted">Checking…</p>{/if}
    </section>
  {/if}

  <section class="group" aria-labelledby="updates-heading" bind:this={updatesSection}>
    <h2 id="updates-heading">Updates</h2>
    <p class="lead">{updates?.version ? `HyperStudy Annotator ${updates.version}` : 'HyperStudy Annotator'}. <button class="link" onclick={() => openExternal(DOCS_URL)}>Read the documentation</button></p>
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
            {#if holdRelaunch}<span class="muted">{holdRelaunch}</span>{/if}</div>
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
</section>

<style>
  .settings { max-width: 760px; padding: 28px 20px 48px; }
  header { margin-bottom: 8px; }
  .group { padding: 22px 0 4px; display: grid; gap: 10px; }
  .group + .group { border-top: 1px solid var(--color-border-default); margin-top: 18px; }
  h2 { font-size: 15px; font-weight: 600; margin: 0; }
  .lead { margin: -6px 0 2px; color: var(--color-text-secondary); max-width: 64ch; }
  p { margin: 0; }
  .panel { padding: 12px 14px; border: 1px solid var(--color-border-default); background: var(--color-bg-surface); border-radius: 8px; display: grid; gap: 8px; }
  .cannot { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 12px; }
  .cannot li { display: flex; gap: 10px; flex-wrap: wrap; }
  .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .update { border-color: var(--color-primary); background: var(--color-primary-light); }
  .notes { white-space: pre-line; color: var(--color-text-secondary); max-height: 10em; overflow: auto; }
  .track { position: relative; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, .08); overflow: hidden; }
  .bar { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; background: var(--color-primary); transition: width .3s linear; }
  .bar.busy { width: 30%; animation: slide 1.4s ease-in-out infinite alternate; }
  @keyframes slide { from { left: 0; } to { left: 70%; } }
  @media (prefers-reduced-motion: reduce) { .bar { transition: none; } .bar.busy { animation: none; } }
  code { font-size: 12px; }
</style>
