<script lang="ts">
  // The machines steps can run on besides this one: lab servers reached over SSH (`perception hosts`) and a cloud GPU
  // started for a step and deleted after it (`perception cloud`). A machine added here shows up as places in the step
  // menus (onchange: the dialog plans again); choosing one there is still what sends a step's inputs to it.
  import { hostSummary, type CloudStatus, type Host, type HostAction, type PipelineApi } from '../pipeline';

  let { api, hosts, cloud, disabled = false, onchange, onbusy }: {
    api: PipelineApi; hosts: Host[]; cloud: CloudStatus | null; disabled?: boolean;
    /** an action is under way (Start run waits: a machine being cleaned or removed must not take a step meanwhile) */
    onbusy: (busy: boolean) => void;
    /** what the action left, as the CLI answered it (no second listing that could fail or be stale) */
    onchange: (now: { hosts?: Host[]; cloud?: CloudStatus }) => void;
  } = $props();

  let name = $state('');
  let dest = $state('');
  let root = $state('');
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);

  const act = async (label: string, f: () => Promise<{ hosts?: Host[]; cloud?: CloudStatus }>) => {
    busy = label; error = null; onbusy(true);
    try { onchange(await f()); } catch (e) { error = String(e); } finally { busy = null; onbusy(false); }
  };
  const host = (action: HostAction, n: string) => act(`${action === 'check' ? 'Checking' : action === 'clean' ? 'Cleaning' : 'Removing'} ${n}…`,
    async () => ({ hosts: await api.host(action, n) }));
  // a name already listed is another machine's: adding over it would change where a step placed there sends its inputs
  const taken = $derived(hosts.some((h) => h.name === name.trim()));
  const add = () => act(`Reaching ${dest}…`, async () => {
    const now = await api.host('add', name.trim(), dest.trim(), root.trim() || undefined);
    name = dest = root = '';
    return { hosts: now };
  });
  const setCloud = (on: boolean) => act(on ? 'Checking AWS…' : 'Turning the cloud GPU off…', async () => ({ cloud: await api.cloud(on) }));
  const when = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
</script>

<section class="machines" aria-label="Machines">
  <h4>Lab servers</h4>
  {#if hosts.length}
    <ul>
      {#each hosts as h (h.name)}
        <li aria-label={h.name}>
          <div class="host"><strong>{h.name}</strong> <span class="muted">{h.dest}</span></div>
          <div class="caps">{hostSummary(h)} <span class="muted">(checked {when(h.probed_at)})</span></div>
          <div class="actions">
            <button onclick={() => host('check', h.name)} disabled={disabled || !!busy} aria-label={`Check ${h.name}`}>Check</button>
            <button onclick={() => host('clean', h.name)} disabled={disabled || !!busy} aria-label={`Clean ${h.name}`} title="Remove the videos and code kept on it between runs">Clean</button>
            <button onclick={() => host('remove', h.name)} disabled={disabled || !!busy} aria-label={`Remove ${h.name}`}>Remove</button>
          </div>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">None yet. A lab server with an NVIDIA GPU can take the heavy steps.</p>
  {/if}
  <h5>Add a lab server</h5>
  <form class="add" aria-label="Add a lab server" onsubmit={(e) => { e.preventDefault(); add(); }}>
    <label>Name <input bind:value={name} placeholder="gpu1" autocomplete="off" spellcheck="false" required /></label>
    <label>SSH destination <input bind:value={dest} placeholder="you@gpu1.example.edu" autocomplete="off" spellcheck="false" required /></label>
    <label>Folder there <input bind:value={root} placeholder=".cache/hyperstudy-perception" autocomplete="off" spellcheck="false" /></label>
    <button type="submit" disabled={disabled || !!busy || !name.trim() || !dest.trim() || taken}>Add</button>
  </form>
  {#if taken}<p class="note error">{name.trim()} is already a lab server here: remove it first to add another machine under that name.</p>{/if}
  <p class="note muted">It is reached with your own SSH keys and ~/.ssh/config; nothing asks for a password.</p>

  <h4>Cloud GPU</h4>
  {#if !cloud}<p class="note muted">This pipeline cannot start cloud machines yet (update hyperstudy-perception).</p>{/if}
  {#if cloud}
    <div class="cloud">
      <span>{cloud.enabled ? 'On' : 'Off'}: {cloud.machine}, ${cloud.hourly_usd.toFixed(2)} an hour, started for a step and deleted after it</span>
      <button onclick={() => setCloud(!cloud!.enabled)} disabled={disabled || !!busy}>{cloud.enabled ? 'Turn off' : 'Turn on'}</button>
    </div>
    <p class="note muted">Uses your AWS account through SkyPilot. Each step shows the most it can cost before it runs.</p>
  {/if}

  <div class="status" aria-live="polite">
    {#if busy}<p class="muted">{busy}</p>{/if}
    {#if error}<p class="error">{error}</p>{/if}
  </div>
</section>

<style>
  .machines { display: grid; gap: 8px; padding: 12px 14px; border: 1px solid var(--color-border-default); background: var(--color-bg-surface); border-radius: 8px; }
  h4 { margin: 4px 0 0; font-size: 13px; font-weight: 600; }
  h5 { margin: 4px 0 0; font-size: 12px; font-weight: 600; color: var(--color-text-secondary); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; }
  .host, .caps { min-width: 0; overflow-wrap: anywhere; }   /* a long ssh destination wraps, not the dialog */
  .caps { grid-column: 1; font-size: 12px; }
  .actions { grid-column: 2; grid-row: 1 / span 2; display: flex; gap: 6px; align-items: center; }
  .add { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
  .add label { display: grid; gap: 2px; font-size: 12px; flex: 1 1 140px; min-width: 0; }
  .add input { min-width: 0; }
  .cloud { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
  .note { margin: 0; font-size: 12px; }
  .status p { margin: 0; }
</style>
