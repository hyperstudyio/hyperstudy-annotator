<script lang="ts">
  // One of the user's keys, where it is used (Shot captions, Gated models, a cloud provider): kept in this computer's
  // keychain by the app (keys.rs). The page sends a key once, when saved, and never gets it back: it learns only
  // whether it is stored. A key the command line already finds (a private file, its own keychain entry) is said so and
  // need not be entered again. The field to paste one opens only when asked for. Test asks the key's provider whether
  // it accepts it (one request that costs nothing); a key that is part of something else's setup (a cloud provider's)
  // is removed with it, not on its own (`removable`).
  import { tooOld, type CheckResult, type KeyStatus, type PipelineApi } from '../pipeline';
  import { openExternal } from '../links';

  let { api, k, elsewhere = null, label = 'API key', removable = true, onchange, onbusy }: {
    api: PipelineApi; k: KeyStatus;
    /** false: removed with what it belongs to (a cloud provider), not on its own */
    removable?: boolean;
    /** where the command line finds it on its own, or null */
    elsewhere?: string | null;
    /** what the row is called where it is shown */
    label?: string;
    /** the keys after saving or removing, as the app answered */
    onchange: (now: KeyStatus[]) => void;
    /** what is being saved or removed, then null (Start run on Extract waits: a run started now would race the key) */
    onbusy: (busy: string | null) => void;
  } = $props();

  let editing = $state(false);
  let draft = $state('');
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  let tested = $state<CheckResult | null>(null);
  const CHECKABLE = ['ANTHROPIC_API_KEY', 'HF_TOKEN', 'RUNPOD_API_KEY'];
  const test = async () => {
    busy = `Testing the ${k.label} key…`; error = null; tested = null;
    try { tested = await api.checkKey(k.name); } catch (e) { error = tooOld(e, 'test keys'); } finally { busy = null; }
  };

  const act = async (what: string, f: () => Promise<KeyStatus[]>) => {
    busy = what; error = null; onbusy(what);
    tested = null;
    try { onchange(await f()); } catch (e) { error = String(e); } finally { busy = null; onbusy(null); }
  };
  const save = () => {
    const value = draft;
    draft = ''; editing = false;   // out of the page at once, whatever the keychain answers
    return act(`Saving the ${k.label} key…`, () => api.setKey(k.name, value));
  };
  const short = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const focus = (el: HTMLElement) => { el.focus(); };
</script>

<li class="key" aria-label={`${k.label} key`}>
  <span class="name">{label}</span>
  <span class="state">
    {#if k.stored}<span class="ok">Saved in the keychain</span>
    {:else if elsewhere}Found in <span class="path">{elsewhere}</span>
    {:else}<span class="muted">Not set.</span> <button class="link" onclick={() => openExternal(k.url)}>Get one at {short(k.url)}</button>{/if}
  </span>
  <span class="actions">
    {#if !editing}
      {#if (k.stored || elsewhere) && CHECKABLE.includes(k.name)}<button class="plain" onclick={test} disabled={!!busy} aria-label={`Test the ${k.label} key`}>Test</button>{/if}
      <button class:plain={k.stored || !!elsewhere} onclick={() => { editing = true; error = null; }} disabled={!!busy} aria-label={`${k.stored ? 'Replace' : 'Add'} the ${k.label} key`}>{k.stored || elsewhere ? 'Replace' : 'Add key'}</button>
      {#if k.stored && removable}<button class="plain danger" onclick={() => act(`Removing the ${k.label} key…`, () => api.removeKey(k.name))} disabled={!!busy} aria-label={`Remove the ${k.label} key`}>Remove</button>{/if}
    {/if}
  </span>
  {#if editing}
    <form class="enter" aria-label={`${k.label} key`} onsubmit={(e) => { e.preventDefault(); save(); }}>
      <input type="password" bind:value={draft} placeholder={`Paste the ${k.label} key`} aria-label={`${k.label} key`}
             autocomplete="off" spellcheck="false" use:focus onkeydown={(e) => { if (e.key === 'Escape') editing = false; }} />
      <button type="submit" class="primary" disabled={!draft.trim()}>Save</button>
      <button type="button" onclick={() => (editing = false)}>Cancel</button>
    </form>
  {/if}
  {#if busy}<p class="note muted" role="status">{busy}</p>{/if}
  {#if tested}<p class="note" class:ok={tested.ok} class:error={!tested.ok} role="status">{tested.ok ? '✓ ' : ''}{tested.detail}.</p>{/if}
  {#if error}<p class="note error" role="alert">{error}</p>{/if}
</li>

<style>
  .key { display: grid; grid-template-columns: 9rem minmax(0, 1fr) auto; gap: 4px 16px; align-items: center; }
  .name { color: var(--color-text-secondary); }
  .state { min-width: 0; overflow-wrap: anywhere; }
  .ok { color: var(--color-primary); }
  .path { color: var(--color-text-secondary); }
  .actions { display: flex; gap: 2px; }
  .enter { grid-column: 2 / -1; display: flex; gap: 6px; align-items: center; }
  .enter input { flex: 1 1 auto; min-width: 0; }
  .note { grid-column: 2 / -1; margin: 0; font-size: 12px; }
  @media (max-width: 560px) { .key { grid-template-columns: minmax(0, 1fr) auto; } .name { grid-column: 1 / -1; } .enter, .note { grid-column: 1 / -1; } }
</style>
