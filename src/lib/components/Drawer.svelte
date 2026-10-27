<script lang="ts">
  // The right-hand drawer: tabs (Inspect, Review, People, Annotate, Details), the keys for what is selected when asked
  // for (? or its button), and the handle that resizes it. Collapsed (\), the video and timeline take the width.
  import { useSession } from '../model/context';
  import type { Tab } from '../model/view.svelte';
  import Inspector from './inspect/Inspector.svelte';
  import ReviewTab from './tabs/ReviewTab.svelte';
  import PeopleTab from './tabs/PeopleTab.svelte';
  import AnnotateTab from './tabs/AnnotateTab.svelte';
  import DetailsTab from './tabs/DetailsTab.svelte';

  let { onresize, onresizeend, onresetwidth }: { onresize: (dx: number, start: number) => void; onresizeend: () => void; onresetwidth: () => void } = $props();
  const s = useSession();
  const closed = $derived(s.view.s.drawerClosed);
  let panel = $state<HTMLDivElement>();
  let aside = $state<HTMLElement>();
  let resizing = $state(false);
  const TABS: [Tab, string][] = [['inspect', 'Inspect'], ['review', 'Review'], ['people', 'People'], ['notes', 'Annotate'], ['data', 'Details']];

  function startResize(e: PointerEvent) {
    e.preventDefault();
    const x0 = e.clientX, w0 = aside!.getBoundingClientRect().width;
    resizing = true;
    const move = (ev: PointerEvent) => onresize(x0 - ev.clientX, w0);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); resizing = false; onresizeend(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
</script>

<aside class="drawer" class:closed bind:this={aside}>
  {#if !closed}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="drawer-resize" class:active={resizing} title="Drag to resize the panel · double-click to reset" onpointerdown={startResize} ondblclick={onresetwidth}></div>
  {/if}
  <nav class="tabs" aria-label="Panel">
    <button class="drawer-toggle" title={closed ? 'Show the panel (\\)' : 'Hide the panel (\\)'} aria-label={closed ? 'Show the panel' : 'Hide the panel'}
      onmousedown={(e) => e.preventDefault()} onclick={() => s.view.toggleDrawer()}>
      <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d={closed ? 'M7 1 3 5l4 4' : 'M3 1l4 4-4 4'} fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
    </button>
    {#if !closed}
      {#each TABS as [key, label] (key)}
        <button class="tab" class:active={s.tab === key} aria-pressed={s.tab === key} onmousedown={(e) => e.preventDefault()} onclick={() => (s.tab = key)}>
          {label}
        </button>
      {/each}
      <button class="keys-toggle" class:on={s.help} aria-pressed={s.help} title="Keyboard keys (?)" aria-label="Keyboard keys"
        onmousedown={(e) => e.preventDefault()} onclick={() => (s.help = !s.help)}>?</button>
    {/if}
  </nav>
  {#if !closed}
    <div class="drawer-panel" bind:this={panel}>
      {#if s.tab === 'review'}<ReviewTab />
      {:else if s.tab === 'people'}<PeopleTab />
      {:else if s.tab === 'notes'}<AnnotateTab />
      {:else if s.tab === 'data'}<DetailsTab />
      {:else}<Inspector />{/if}
    </div>
    {#if s.help}<div class="help">
      {#if s.selection?.kind === 'utt'}
        <kbd>1</kbd>–<kbd>9</kbd> face <kbd>o</kbd> voice <kbd>m</kbd> several <kbd>u</kbd> unsure <kbd>x</kbd> not speech <kbd>j</kbd>/<kbd>k</kbd> next/prev
      {:else}
        <kbd>space</kbd> play <kbd>⇧space</kbd> clip <kbd>l</kbd> loop <kbd>←</kbd><kbd>→</kbd> segment <kbd>⇧←→</kbd> 1 s <kbd>,</kbd><kbd>.</kbd> shot
        <kbd>e</kbd> include <kbd>[</kbd><kbd>]</kbd> annotate <kbd>j</kbd> review <kbd>\</kbd> panel
      {/if}
      <kbd>⌘Z</kbd> undo <kbd>?</kbd> hide these
    </div>{/if}
  {/if}
</aside>

<style>
  .drawer { position: relative; border-left: 1px solid var(--color-border-default); background: var(--color-bg-surface); display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  .drawer-resize { position: absolute; left: -4px; top: 0; bottom: 0; width: 7px; cursor: col-resize; z-index: 6; }
  .drawer-resize:hover, .drawer-resize.active { background: var(--color-primary-light); }
  .tabs { display: flex; border-bottom: 1px solid var(--color-border-default); }
  .closed .tabs { border: 0; flex: 1; }
  .tabs button { border: 0; border-radius: 0; background: none; padding: 9px 2px; color: var(--color-text-secondary); border-bottom: 2px solid transparent; }
  .tab { flex: 1; }
  .keys-toggle { flex: none; width: 30px; color: var(--color-text-muted); }
  .keys-toggle.on, .keys-toggle:hover { color: var(--color-text-primary); }
  .tab.active { color: var(--color-text-primary); border-bottom-color: var(--color-primary); }
  .drawer-toggle { flex: none; width: 28px; color: var(--color-text-muted); border-right: 1px solid var(--color-border-default) !important; display: grid; place-items: center; }
  .closed .drawer-toggle { width: 100%; height: 100%; border-right: 0 !important; }
  .drawer-toggle:hover { color: var(--color-text-primary); background: var(--color-bg-hover); }
  .drawer-panel { flex: 1; overflow-y: auto; padding: 14px 16px; min-height: 0; }
  .help { color: var(--color-text-muted); font-size: 12px; border-top: 1px solid var(--color-border-default); padding: 8px 16px; line-height: 1.8; }

  /* The views inside the panel share these; scoped to the panel. */
  .drawer-panel :global(h2) { font-size: 15px; margin: 0 0 2px; display: flex; align-items: center; gap: 8px; }
  .drawer-panel :global(h3) { font-size: 12.5px; color: var(--color-text-secondary); margin: 18px 0 6px; font-weight: 600; }
  .drawer-panel :global(.meta) { color: var(--color-text-muted); }
  .drawer-panel :global(.row) { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 6px 0; }
  .drawer-panel :global(.list) { display: flex; flex-direction: column; gap: 4px; }
  .drawer-panel :global(.item) { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; background: var(--color-bg-elevated); border: 1px solid transparent; cursor: pointer; text-align: left; width: 100%; }
  .drawer-panel :global(.item:hover) { background: var(--color-bg-hover); }
  .drawer-panel :global(.item.selected) { border-color: var(--color-primary); }
  .drawer-panel :global(.item.done) { opacity: .5; }
  .drawer-panel :global(.grow) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .drawer-panel :global(.choice) { display: flex; gap: 6px; flex-wrap: wrap; }
  .drawer-panel :global(.flag) { color: var(--color-caution); font-size: 12px; font-weight: 500; }
  .drawer-panel :global(.callout) { background: var(--color-caution-light); border-radius: 6px; padding: 6px 8px; margin: 8px 0; }
  .drawer-panel :global(.callout.info) { background: var(--color-primary-light); }
  .drawer-panel :global(.empty) { color: var(--color-text-muted); }
</style>
