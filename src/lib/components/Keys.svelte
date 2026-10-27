<script lang="ts">
  // The user's own keys for the pipeline (API keys, tokens), kept in this computer's keychain by the app (keys.rs).
  // The page sends a key once, when saved, and never gets it back: it learns only whether each is stored. A key the
  // command line already finds (a private file, its own keychain entry) is said so and need not be entered again.
  // One line per key, what it is for and where it comes from; the field to paste one opens only when asked for.
  import { keyRows, type CliKeys, type KeyStatus, type PipelineApi } from '../pipeline';
  import { openExternal } from '../links';

  let { api, keys, cli, onchange, onbusy }: {
    api: PipelineApi; keys: KeyStatus[]; cli: CliKeys | null;
    /** what is being saved or removed, then null (Start run on Extract waits: a run started now would race the key) */
    onbusy: (busy: string | null) => void;
    /** the keys after an action, as the app answered (the plan's missing keys change with them) */
    onchange: (now: KeyStatus[]) => void;
  } = $props();

  let editing = $state<string | null>(null);   // the key whose field is open
  let draft = $state('');
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  const rows = $derived(keyRows(keys, cli));

  const act = async (label: string, f: () => Promise<KeyStatus[]>) => {
    busy = label; error = null; onbusy(label);
    try { onchange(await f()); } catch (e) { error = String(e); } finally { busy = null; onbusy(null); }
  };
  const edit = (name: string) => { editing = name; draft = ''; error = null; };
  const save = (name: string, label: string) => {
    const value = draft;
    draft = ''; editing = null;   // out of the page at once, whatever the keychain answers
    return act(`Saving the ${label} key…`, () => api.setKey(name, value));
  };
  const remove = (name: string, label: string) => act(`Removing the ${label} key…`, () => api.removeKey(name));
  const short = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const focus = (el: HTMLElement) => { el.focus(); };
</script>

<section class="keys" aria-label="Keys">
  <ul>
    {#each rows as k (k.name)}
      <li aria-label={k.label}>
        <div class="what"><strong>{k.label}</strong><span class="muted">{k.purpose}</span></div>
        <div class="state">
          {#if k.stored}<span class="ok">In the keychain</span>
          {:else if k.elsewhere}Found in <span class="path">{k.elsewhere}</span>
          {:else}Not set. <button class="link" onclick={() => openExternal(k.url)}>Get one at {short(k.url)}</button>{/if}
        </div>
        <div class="actions">
          {#if editing !== k.name}
            <button onclick={() => edit(k.name)} disabled={!!busy} aria-label={`${k.stored ? 'Replace' : 'Add'} the ${k.label} key`}>{k.stored ? 'Replace' : k.elsewhere ? 'Use another' : 'Add key'}</button>
            {#if k.stored}<button class="quiet" onclick={() => remove(k.name, k.label)} disabled={!!busy} aria-label={`Remove the ${k.label} key`}>Remove</button>{/if}
          {/if}
        </div>
        {#if editing === k.name}
          <form class="enter" aria-label={`${k.label} key`} onsubmit={(e) => { e.preventDefault(); save(k.name, k.label); }}>
            <input type="password" bind:value={draft} placeholder={`Paste the ${k.label} key`} aria-label={`${k.label} key`}
                   autocomplete="off" spellcheck="false" use:focus onkeydown={(e) => { if (e.key === 'Escape') editing = null; }} />
            <button type="submit" class="primary" disabled={!draft.trim()}>Save</button>
            <button type="button" onclick={() => (editing = null)}>Cancel</button>
          </form>
        {/if}
      </li>
    {/each}
  </ul>
  {#each cli?.problems ?? [] as p}<p class="note warn">Not used: {p}</p>{/each}
  <div class="status" aria-live="polite">
    {#if busy}<p class="note muted" role="status">{busy}</p>{/if}
    {#if error}<p class="note error" role="alert">{error}</p>{/if}
  </div>
</section>

<style>
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 16px; padding: 11px 0; border-top: 1px solid var(--color-border-default); }
  li:first-child { border-top: 0; padding-top: 4px; }
  .what { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; min-width: 0; }
  .state { grid-column: 1; font-size: 12px; min-width: 0; overflow-wrap: anywhere; color: var(--color-text-muted); }
  .ok { color: var(--color-primary); }
  .path { color: var(--color-text-secondary); }
  .actions { grid-column: 2; grid-row: 1 / span 2; display: flex; gap: 2px; align-items: center; }
  .quiet { background: none; border-color: transparent; color: var(--color-text-muted); }
  .quiet:hover:not(:disabled) { color: var(--color-danger); background: none; }
  .enter { grid-column: 1 / -1; display: flex; gap: 6px; align-items: center; margin-top: 8px; }
  .enter input { flex: 1 1 auto; min-width: 0; }
  .note { margin: 0; font-size: 12px; }
  .status:empty { display: none; }
  .warn { color: var(--color-text-secondary); }
</style>
