<script lang="ts">
  // A name that can be renamed in place: double-click it (or a "rename" link sets session.renaming to "<id>@<area>").
  import { useSession } from '../../model/context';

  let { text, id, area, onrename, grow = false }: {
    text: string; id: string; area: string; onrename?: (name: string) => void; grow?: boolean;
  } = $props();
  const s = useSession();
  const me = $derived(`${id}@${area}`);
  const editing = $derived(!!onrename && s.renaming === me);
  let input = $state<HTMLInputElement>();

  $effect(() => { if (editing && input) { input.focus(); input.select(); } });

  function done(save: boolean) {
    if (s.renaming !== me || !input) return;
    const v = input.value.trim();
    s.renaming = null;
    if (save && v && v !== text) onrename?.(v);
  }
</script>

{#if editing}
  <input bind:this={input} class="inline-name" type="text" value={text} aria-label="New name"
    onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); }}
    onblur={() => done(true)} onclick={(e) => e.stopPropagation()} onpointerdown={(e) => e.stopPropagation()} />
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span class="name" class:grow class:editable={!!onrename} title={onrename ? 'Double-click to rename' : undefined}
    ondblclick={(e) => { if (onrename) { e.stopPropagation(); s.renaming = me; } }}>{text}</span>
{/if}

<style>
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .grow { flex: 1; }
  .editable { cursor: text; border-bottom: 1px dashed transparent; }
  .editable:hover { border-bottom-color: var(--color-text-muted); }
  .inline-name { padding: 1px 6px; width: 100%; min-width: 0; font-weight: 600; }
</style>
