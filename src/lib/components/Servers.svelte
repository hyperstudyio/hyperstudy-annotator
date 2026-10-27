<script lang="ts">
  // Remote servers: machines reached over SSH that steps can run on (`perception hosts`). A server added here shows up
  // as places in the step menus on Extract (onchange: Extract plans again when shown); choosing one there is still what
  // sends a step's inputs to it. The form to add one opens only when asked for.
  import { hostSummary, type Host, type HostAction, type PipelineApi } from '../pipeline';

  let { api, hosts, onchange, onbusy }: {
    api: PipelineApi; hosts: Host[];
    /** what is under way, then null (Start run on Extract waits: a server being cleared or removed must not take a step) */
    onbusy: (busy: string | null) => void;
    /** the servers after an action, as the CLI answered it (no second listing that could fail or be stale) */
    onchange: (now: Host[]) => void;
  } = $props();

  let adding = $state(false);
  let name = $state('');
  let dest = $state('');
  let root = $state('');
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);

  const act = async (label: string, f: () => Promise<Host[]>) => {
    busy = label; error = null; onbusy(label);
    try { onchange(await f()); return true; } catch (e) { error = String(e); return false; } finally { busy = null; onbusy(null); }
  };
  const host = (action: HostAction, n: string) => act(`${action === 'check' ? 'Checking' : action === 'clean' ? 'Clearing the cache on' : 'Removing'} ${n}…`,
    () => api.host(action, n));
  // a name already listed is another machine's: adding over it would change where a step placed there sends its inputs
  const taken = $derived(hosts.some((h) => h.name === name.trim()));
  const add = async () => {
    if (await act(`Reaching ${dest.trim()}…`, () => api.host('add', name.trim(), dest.trim(), root.trim() || undefined))) {
      name = dest = root = ''; adding = false;
    }
  };
  const when = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const focus = (el: HTMLElement) => { el.focus(); };
</script>

<div class="servers">
  {#if hosts.length}
    <ul>
      {#each hosts as h (h.name)}
        <li aria-label={h.name}>
          <div class="host"><strong>{h.name}</strong><span class="muted">{h.dest}</span></div>
          <div class="caps">{hostSummary(h)}. <span class="muted">Checked {when(h.probed_at)}.</span></div>
          <div class="actions">
            <button onclick={() => host('check', h.name)} disabled={!!busy} aria-label={`Check ${h.name}`} title="Reach it again and see what it has">Check</button>
            <button onclick={() => host('clean', h.name)} disabled={!!busy} aria-label={`Clear the cache on ${h.name}`} title="Remove the videos and code kept on it between runs">Clear cache</button>
            <button class="quiet" onclick={() => host('remove', h.name)} disabled={!!busy} aria-label={`Remove ${h.name}`}>Remove</button>
          </div>
        </li>
      {/each}
    </ul>
  {:else if !adding}
    <p class="muted">None yet. A server with an NVIDIA GPU can run the heavy steps.</p>
  {/if}

  {#if adding}
    <form class="add" aria-label="Add a remote server" onsubmit={(e) => { e.preventDefault(); add(); }}>
      <h3>Add a remote server</h3>
      <label for="server-name">Name</label>
      <div class="field"><input id="server-name" bind:value={name} placeholder="gpu1" autocomplete="off" spellcheck="false" required use:focus /></div>
      <label for="server-dest">SSH destination</label>
      <div class="field"><input id="server-dest" bind:value={dest} placeholder="user@host" autocomplete="off" spellcheck="false" required />
        <span class="muted">As you would give it to <code>ssh</code>. Your SSH keys and ~/.ssh/config are used.</span></div>
      <label for="server-root">Folder on it</label>
      <div class="field"><input id="server-root" bind:value={root} placeholder=".cache/hyperstudy-perception" autocomplete="off" spellcheck="false" /></div>
      {#if taken}<p class="hint error">{name.trim()} is already a remote server here: remove it first to add another machine under that name.</p>{/if}
      <div class="buttons">
        <button type="submit" class="primary" disabled={!!busy || !name.trim() || !dest.trim() || taken}>Add server</button>
        <button type="button" onclick={() => { adding = false; error = null; }} disabled={!!busy}>Cancel</button>
      </div>
    </form>
  {:else}
    <div><button onclick={() => (adding = true)} disabled={!!busy}>Add a remote server…</button></div>
  {/if}

  <div class="status" aria-live="polite">
    {#if busy}<p class="muted">{busy}</p>{/if}
    {#if error}<p class="error">{error}</p>{/if}
  </div>
</div>

<style>
  .servers { display: grid; gap: 10px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 16px; padding: 11px 0; border-top: 1px solid var(--color-border-default); }
  li:first-child { border-top: 0; padding-top: 4px; }
  .host { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; min-width: 0; overflow-wrap: anywhere; }   /* a long destination wraps */
  .caps { grid-column: 1; font-size: 12px; color: var(--color-text-secondary); min-width: 0; }
  .actions { grid-column: 2; grid-row: 1 / span 2; display: flex; gap: 4px; align-items: center; }
  .quiet { background: none; border-color: transparent; color: var(--color-text-muted); }
  .quiet:hover:not(:disabled) { color: var(--color-danger); background: none; }
  /* one field to a row, its label beside it and what it is for under it */
  .add { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 12px 16px; align-items: baseline; padding: 16px 18px;
         border: 1px solid var(--color-border-default); border-radius: 8px; background: var(--color-bg-surface); }
  .add h3 { grid-column: 1 / -1; margin: 0 0 2px; font-size: 13px; font-weight: 600; }
  .add label { color: var(--color-text-secondary); }
  .field { display: grid; gap: 4px; min-width: 0; }
  .field input { max-width: 360px; width: 100%; }
  .field span { font-size: 12px; max-width: 60ch; }
  .hint, .buttons { grid-column: 1 / -1; margin: 0; font-size: 12px; }
  code { font-size: 12px; }
  .buttons { display: flex; gap: 6px; }
  .status:empty { display: none; }
  .status p { margin: 0; }
  p { margin: 0; }
</style>
