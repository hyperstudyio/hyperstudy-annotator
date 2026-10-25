<script lang="ts">
  // The user's own keys for the pipeline (API keys, tokens), kept in this computer's keychain by the app (keys.rs).
  // The page sends a key once, when saved, and never gets it back: it learns only whether each is stored. A key the
  // command line already finds (a private file, its own keychain entry) is said so and need not be entered again.
  import { keyRows, type CliKeys, type KeyStatus, type PipelineApi } from '../pipeline';

  let { api, keys, cli, disabled = false, onchange, onbusy }: {
    api: PipelineApi; keys: KeyStatus[]; cli: CliKeys | null; disabled?: boolean;
    /** a key is being saved or removed (Start run waits: a run started now would race the key) */
    onbusy: (busy: boolean) => void;
    /** the keys after an action, as the app answered (the plan's missing keys change with them) */
    onchange: (now: KeyStatus[]) => void;
  } = $props();

  let drafts = $state<Record<string, string>>({});
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  const rows = $derived(keyRows(keys, cli));

  const act = async (label: string, f: () => Promise<KeyStatus[]>) => {
    busy = label; error = null; onbusy(true);
    try { onchange(await f()); } catch (e) { error = String(e); } finally { busy = null; onbusy(false); }
  };
  const save = (name: string, label: string) => {
    const value = drafts[name] ?? '';
    drafts = { ...drafts, [name]: '' };   // out of the page at once, whatever the keychain answers
    return act(`Saving the ${label} key…`, () => api.setKey(name, value));
  };
  const remove = (name: string, label: string) => act(`Removing the ${label} key…`, () => api.removeKey(name));
</script>

<section class="keys" aria-label="Keys">
  <p class="note muted">Kept in this computer's keychain, never shown again here. Each step gets only the keys it needs.</p>
  <ul>
    {#each rows as k (k.name)}
      <li aria-label={k.label}>
        <div class="what"><strong>{k.label}</strong> <span class="muted">{k.purpose}</span></div>
        <div class="state">
          {#if k.stored}Stored in the keychain{:else if k.elsewhere}Found in {k.elsewhere}{:else}Not set. Make one at <span class="url">{k.url}</span>{/if}
        </div>
        <form class="enter" aria-label={`${k.label} key`} onsubmit={(e) => { e.preventDefault(); save(k.name, k.label); }}>
          <input type="password" bind:value={drafts[k.name]} placeholder={k.stored ? 'Replace with a new key' : 'Paste the key'}
                 aria-label={`${k.label} key`} autocomplete="off" spellcheck="false" disabled={disabled || !!busy} />
          <button type="submit" disabled={disabled || !!busy || !(drafts[k.name] ?? '').trim()}>Save</button>
          {#if k.stored}<button type="button" onclick={() => remove(k.name, k.label)} disabled={disabled || !!busy} aria-label={`Remove the ${k.label} key`}>Remove</button>{/if}
        </form>
      </li>
    {/each}
  </ul>
  {#each cli?.problems ?? [] as p}<p class="note warn">Not used: {p}</p>{/each}
  {#if busy}<p class="note muted" role="status">{busy}</p>{/if}
  {#if error}<p class="note error" role="alert">{error}</p>{/if}
</section>

<style>
  .keys { display: grid; gap: 8px; padding: 12px 14px; border: 1px solid var(--color-border-default); background: var(--color-bg-surface); border-radius: 8px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  li { display: grid; gap: 4px; }
  .what, .state { min-width: 0; overflow-wrap: anywhere; }
  .state { font-size: 12px; }
  .url { user-select: all; }
  .enter { display: flex; gap: 6px; align-items: center; }
  .enter input { flex: 1 1 auto; min-width: 0; }
  .note { margin: 0; font-size: 12px; }
  .warn { color: var(--color-text-warning, var(--color-text-secondary)); }
</style>
