<script lang="ts">
  // A button that opens a small panel under it (the video switcher, the timeline's layers): closed by choosing in it
  // (`close` given to the content), Escape, or a click anywhere else. The panel takes the keyboard when it opens.
  import type { Snippet } from 'svelte';

  let { label, button, children, align = 'left', width = 240, title, buttonClass = '' }: {
    /** what the button is called, for screen readers (its own text may be only part of it) */
    label: string;
    button: Snippet;
    children: Snippet<[() => void]>;
    align?: 'left' | 'right'; width?: number; title?: string; buttonClass?: string;
  } = $props();

  let open = $state(false);
  let root = $state<HTMLElement>();
  const close = () => { open = false; };
  const outside = (e: PointerEvent) => { if (open && root && !root.contains(e.target as Node)) open = false; };
  const focusFirst = (el: HTMLElement) => {
    (el.querySelector('input:not([type=checkbox]), [role=menuitem]:not(:disabled), button:not(:disabled), input') as HTMLElement | null)?.focus();
  };
</script>

<svelte:window onpointerdown={outside} />
<div class="pop" bind:this={root}>
  <button class="trigger {buttonClass}" aria-haspopup="true" aria-expanded={open} aria-label={label} {title} onclick={() => (open = !open)}
    onkeydown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); open = true; } }}>
    {@render button()}<span class="chev" aria-hidden="true"></span>
  </button>
  {#if open}
    <div class="panel {align}" style:width="{width}px" role="dialog" aria-label={label} tabindex="-1" use:focusFirst
      onkeydown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); open = false; (root?.querySelector('.trigger') as HTMLElement | null)?.focus(); } }}>
      {@render children(close)}
    </div>
  {/if}
</div>

<style>
  .pop { position: relative; flex: none; }
  .trigger { display: inline-flex; align-items: center; gap: 8px; max-width: 60vw; }
  .chev { flex: none; width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: translateY(-2px) rotate(45deg); opacity: .6; }
  .panel { position: absolute; top: calc(100% + 4px); z-index: 30; max-height: min(60vh, 480px); overflow: auto; padding: 4px;
           background: var(--color-bg-elevated); border: 1px solid var(--color-border-strong); border-radius: 8px; box-shadow: 0 10px 28px rgba(0, 0, 0, .5); }
  .panel.left { left: 0; }
  .panel.right { right: 0; }
  .panel:focus { outline: none; }
</style>
