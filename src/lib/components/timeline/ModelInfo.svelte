<script lang="ts">
  // ⓘ beside a timeline group's name: the models behind what it draws, each with a page to read about it when one is
  // known, and what its licence allows (the bundle's own licence text on hover). Nothing when no model made the group
  // (your own annotations).
  import { useSession } from '../../model/context';
  import { groupModels } from '../../models';
  import { LICENCE_TEXT } from '../../library';
  import { openExternal } from '../../links';
  import Popover from '../ui/Popover.svelte';

  let { group, title }: { group: string; title: string } = $props();
  const s = useSession();
  const models = $derived(groupModels(s.bundle.layers, group));
  const caution = (mode: string) => mode === 'academic-only' || mode === 'needs-review';
</script>

{#if models.length}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span class="info" onclick={(e) => e.stopPropagation()} onpointerdown={(e) => e.stopPropagation()}>
    <Popover label={`The models behind ${title}`} title={`The models behind ${title}`} width={300} chevron={false} buttonClass="info-button">
      {#snippet button()}<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="8" r="6.5" /><path d="M8 7.2v4M8 4.8v.1" /></svg>{/snippet}
      {#snippet children()}
        <ul class="models">
          {#each models as m, i (i)}
            <li>
              {#if m.link}<button class="link name" onclick={() => openExternal(m.link!)}>{m.name}</button>{:else}<span class="name">{m.name}</span>{/if}
              {#if m.detail}<span class="detail">{m.detail}</span>{/if}
              <span class="licence" class:caution={caution(m.licence)} title={m.licenceText ?? undefined}>{LICENCE_TEXT[m.licence] ?? m.licence}</span>
            </li>
          {/each}
        </ul>
      {/snippet}
    </Popover>
  </span>
{/if}

<style>
  /* shown where the pointer is (or the keyboard), over the end of the label: the label keeps its width for its name */
  /* centred without a transform: a transformed box would hold the panel, which is placed against the window (fixed) */
  .info { position: absolute; right: 4px; top: 0; bottom: 0; display: flex; align-items: center; font-weight: 400; opacity: 0; }
  :global(.lane-label:hover) .info, .info:focus-within, .info:has(:global([aria-expanded='true'])) { opacity: 1; }
  .info :global(button.info-button) { background: none; border: 0; padding: 1px; color: var(--color-text-muted); border-radius: 50%; }
  .info :global(button.info-button:hover:not(:disabled)) { color: var(--color-text-primary); background: none; }
  .info svg { fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; }
  .models { list-style: none; margin: 0; padding: 6px 10px; display: grid; gap: 10px; font-size: 12.5px; }
  .models li { display: grid; gap: 1px; }
  .name { font-weight: 500; text-align: left; overflow-wrap: anywhere; }
  .detail { color: var(--color-text-muted); font-size: 12px; }
  .licence { color: var(--color-text-secondary); font-size: 12px; cursor: default; }
  .caution { color: var(--color-caution); }
</style>
