<script lang="ts">
  // Remote servers: machines reached over SSH that steps can run on (`perception hosts`). A server added here shows up
  // as places in the step menus on Extract (onchange: Extract plans again when shown); choosing one there is still what
  // sends a step's inputs to it. It is reached through your own ssh: keys are never copied, and no password is asked
  // (ssh runs in batch mode). The form to add one opens only when asked for: a host from ~/.ssh/config (or user@host),
  // the name steps know it by, and, under Advanced, what overrides ~/.ssh/config for it (user, port, key file) and its
  // folder there. Test connection reaches it as adding would and says what it has, adding nothing (`hosts probe`); a
  // server's Test reaches it again (`hosts check`).
  import { hostSummary, tooOld, type Host, type HostAction, type HostProbe, type PipelineApi, type SshOverrides } from '../pipeline';
  let { api, hosts, onchange, onbusy }: {
    api: PipelineApi; hosts: Host[];
    /** what is under way, then null (Start run on Extract waits: a server being cleared or removed must not take a step) */
    onbusy: (busy: string | null) => void;
    /** the servers after an action, as the CLI answered it (no second listing that could fail or be stale) */
    onchange: (now: Host[]) => void;
  } = $props();
  let adding = $state(false);
  let dest = $state('');
  let name = $state('');
  let named = $state(false);   // the name was typed, not made from the host
  let user = $state('');
  let port = $state('');
  let identity = $state('');
  let root = $state('');
  let known = $state<string[]>([]);   // the hosts ~/.ssh/config names
  let probed = $state<HostProbe | null>(null);
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  const act = async (label: string, f: () => Promise<Host[]>) => {
    busy = label; error = null; onbusy(label);
    try { onchange(await f()); return true; } catch (e) { error = String(e); return false; } finally { busy = null; onbusy(null); }
  };
  const host = (action: HostAction, n: string) => act(`${action === 'check' ? 'Testing' : action === 'clean' ? 'Clearing the cache on' : 'Removing'} ${n}…`,
    () => api.host(action, n));
  // the name steps know it by, from the host: lower-case letters, digits and - (what the pipeline takes)
  const nameFrom = (d: string) => d.replace(/^.*@/, '').split('.')[0].toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 31);
  $effect(() => { if (!named) name = nameFrom(dest.trim()); });
  const nameOk = $derived(/^[a-z0-9][a-z0-9-]{0,30}$/.test(name) && !['native', 'self', 'cloud', 'runpod', 'local'].includes(name));
  // a name already listed is another machine's: adding over it would change where a step placed there sends its inputs
  const taken = $derived(hosts.some((h) => h.name === name.trim()));
  const overrides = (): SshOverrides => ({ ...(user.trim() ? { user: user.trim() } : {}), ...(port.trim() ? { port: Number(port) } : {}),
    ...(identity.trim() ? { identity: identity.trim() } : {}) });
  const portOk = $derived(!port.trim() || (/^\d+$/.test(port.trim()) && +port > 0 && +port < 65536));
  const ready = $derived(!!dest.trim() && nameOk && !taken && portOk);
  const open = async () => {
    adding = true; probed = null; error = null;
    known = await api.sshHosts().catch(() => []);
  };
  const reset = () => { dest = name = user = port = identity = root = ''; named = false; probed = null; adding = false; };
  const test = async () => {
    busy = `Reaching ${dest.trim()}…`; error = null; probed = null; onbusy(busy);
    try { probed = await api.probeHost(dest.trim(), overrides()); } catch (e) { error = tooOld(e, 'test a server before adding it'); }
    finally { busy = null; onbusy(null); }
  };
  const add = async () => {
    if (await act(`Reaching ${dest.trim()}…`, () => api.host('add', name.trim(), dest.trim(), root.trim() || undefined, overrides()))) reset();
  };
  // what changes how it is reached, as ssh would be told it
  const via = (h: Host) => `${h.user ? `${h.user}@` : ''}${h.dest}${h.port ? `:${h.port}` : ''}${h.identity ? `, key ${h.identity.replace(/^.*\//, '')}` : ''}`;
  const when = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const focus = (el: HTMLElement) => { el.focus(); };
</script>

<section class="set-part" aria-labelledby="servers-heading">
  <div class="set-head">
    <h2 id="servers-heading">Remote servers</h2>
    {#if !adding}<button onclick={open} disabled={!!busy}>Add server…</button>{/if}
  </div>
  {#if hosts.length}
    <ul class="set-rows">
      {#each hosts as h (h.name)}
        <li aria-label={h.name}>
          <div class="host"><strong>{h.name}</strong><span class="muted">{via(h)}</span></div>
          <div class="caps">{hostSummary(h)}. <span class="muted">Reached {when(h.probed_at)}.</span></div>
          <div class="actions">
            <button class="plain" onclick={() => host('check', h.name)} disabled={!!busy} aria-label={`Test ${h.name}`} title="Reach it again and see what it has">Test</button>
            <button class="plain" onclick={() => host('clean', h.name)} disabled={!!busy} aria-label={`Clear the cache on ${h.name}`} title="Remove the videos and code kept on it between runs">Clear cache</button>
            <button class="plain danger" onclick={() => host('remove', h.name)} disabled={!!busy} aria-label={`Remove ${h.name}`}>Remove</button>
          </div>
        </li>
      {/each}
    </ul>
  {:else if !adding}
    <p class="muted">None yet. A server you reach over SSH, with an NVIDIA GPU, can run the heavy steps.</p>
  {/if}
  {#if adding}
    <form class="add" aria-label="Add a remote server" onsubmit={(e) => { e.preventDefault(); add(); }}>
      <p class="lede">Reached through your own <code>ssh</code>: your keys are never copied, and no password is asked.</p>
      <label for="server-dest">Host</label>
      <div class="field">
        <input id="server-dest" bind:value={dest} list="ssh-hosts" placeholder="e.g. lab-gpu, or you@gpu.example.edu" autocomplete="off" spellcheck="false" required use:focus
          oninput={() => (probed = null)} />
        <datalist id="ssh-hosts">{#each known as k (k)}<option value={k}></option>{/each}</datalist>
        <span class="muted">{known.length ? 'A host from your ~/.ssh/config, or user@host.' : 'user@host, or a host from your ~/.ssh/config.'}</span>
      </div>
      <label for="server-name">Name</label>
      <div class="field">
        <input id="server-name" bind:value={name} oninput={() => (named = true)} placeholder="lab-gpu" autocomplete="off" spellcheck="false" required />
        <span class="muted">What Extract calls it. Lower-case letters, digits and -.</span>
      </div>
      <details class="advanced">
        <summary>Advanced (over ~/.ssh/config)</summary>
        <div class="grid">
          <label for="server-user">User</label>
          <div class="field"><input id="server-user" bind:value={user} placeholder="from ~/.ssh/config" autocomplete="off" spellcheck="false" /></div>
          <label for="server-port">Port</label>
          <div class="field"><input id="server-port" bind:value={port} inputmode="numeric" placeholder="22, or from ~/.ssh/config" autocomplete="off" />
            {#if !portOk}<span class="error">A port is a number from 1 to 65535.</span>{/if}</div>
          <label for="server-key">Key file</label>
          <div class="field"><input id="server-key" bind:value={identity} placeholder="~/.ssh/id_ed25519" autocomplete="off" spellcheck="false" />
            <span class="muted">A private key on this computer. It stays here.</span></div>
          <label for="server-root">Folder on it</label>
          <div class="field"><input id="server-root" bind:value={root} placeholder=".cache/hyperstudy-perception" autocomplete="off" spellcheck="false" />
            <span class="muted">Its own folder, under your home there. Clear cache empties it.</span></div>
        </div>
      </details>
      {#if taken}<p class="hint error">{name.trim()} is already a remote server here: remove it first to add another machine under that name.</p>
      {:else if name && !nameOk}<p class="hint error">A name is lower-case letters, digits and -, and not native, self, cloud, runpod or local.</p>{/if}
      {#if probed}<p class="hint ok" role="status">✓ Reached {probed.dest}: {hostSummary({ caps: probed.caps } as Host)}.</p>{/if}
      <div class="buttons">
        <button type="button" onclick={test} disabled={!!busy || !dest.trim() || !portOk}>Test connection</button>
        <button type="submit" class="primary" disabled={!!busy || !ready}>Add server</button>
        <button type="button" onclick={() => { reset(); error = null; }} disabled={!!busy}>Cancel</button>
      </div>
    </form>
  {/if}
  <div class="status" aria-live="polite">
    {#if busy}<p class="muted">{busy}</p>{/if}
    {#if error}<p class="error">{error}</p>{/if}
  </div>
</section>

<style>
  li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 16px; }
  .host { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; min-width: 0; overflow-wrap: anywhere; }   /* a long destination wraps */
  .caps { grid-column: 1; font-size: 12px; color: var(--color-text-secondary); min-width: 0; }
  .actions { grid-column: 2; grid-row: 1 / span 2; display: flex; gap: 4px; align-items: center; }
  /* one field to a row, its label beside it and what it is for under it */
  .add, .grid { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 12px 16px; align-items: baseline; }
  .add { padding: 16px 18px; border: 1px solid var(--color-border-default); border-radius: 8px; background: var(--color-bg-surface); }
  .add label { color: var(--color-text-secondary); }
  .lede { grid-column: 1 / -1; font-size: 13px; color: var(--color-text-secondary); }
  .field { display: grid; gap: 4px; min-width: 0; }
  .field input { max-width: 360px; width: 100%; }
  .field span { font-size: 12px; max-width: 60ch; }
  .advanced { grid-column: 1 / -1; border: 1px solid var(--color-border-default); border-radius: 6px; padding: 8px 12px; }
  .advanced summary { cursor: pointer; color: var(--color-text-secondary); font-size: 13px; }
  .advanced[open] summary { margin-bottom: 12px; }
  .hint, .buttons { grid-column: 1 / -1; margin: 0; font-size: 12px; }
  .ok { color: var(--color-primary); }
  code { font-size: 12px; }
  .buttons { display: flex; gap: 6px; }
  .status:empty { display: none; }
  .status p { margin: 0; }
  p { margin: 0; }
</style>
