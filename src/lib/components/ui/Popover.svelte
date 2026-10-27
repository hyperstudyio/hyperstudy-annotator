<script lang="ts">
  // A button that opens a small panel under it (the video switcher, the timeline's layers): closed by choosing in it
  // (`close` given to the content), Escape, or a click anywhere else. The panel takes the keyboard when it opens. It is
  // placed against the window, under the button, so a scrolling or clipped container (the timeline's labels) cannot
  // cut it off; it follows the button when what holds the button scrolls. While open it lives at the end of the page,
  // so no stacking of the button's own (the timeline's sticky labels, each above the next) can draw over it.
  import type { Snippet } from 'svelte';

  let { label, button, children, align = 'left', width = 240, title, buttonClass = '', chevron = true }: {
    /** what the button is called, for screen readers (its own text may be only part of it) */
    label: string;
    button: Snippet;
    children: Snippet<[() => void]>;
    align?: 'left' | 'right'; width?: number; title?: string; buttonClass?: string; chevron?: boolean;
  } = $props();

  let open = $state(false);
  let root = $state<HTMLElement>();
  let panelEl = $state<HTMLElement>();
  const toBody = (el: HTMLElement) => { document.body.append(el); return { destroy: () => el.remove() }; };
  // under the button, or above it when there is more room there (an ⓘ near the foot of the timeline); never past the
  // window: what does not fit scrolls inside the panel
  let at = $state<{ top: number | null; bottom: number | null; left: number; max: number }>({ top: 0, bottom: null, left: 0, max: 480 });
  const close = () => { open = false; };
  const place = () => {
    if (!root) return;
    const r = root.getBoundingClientRect(), w = Math.min(width, window.innerWidth - 16);
    const left = Math.max(8, Math.min(align === 'right' ? r.right - w : r.left, window.innerWidth - w - 8));
    const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
    at = below >= Math.min(320, above) ? { top: r.bottom + 4, bottom: null, left, max: Math.min(480, below) }
      : { top: null, bottom: window.innerHeight - r.top + 4, left, max: Math.min(480, above) };
  };
  const toggle = () => { if (!open) place(); open = !open; };
  const outside = (e: PointerEvent) => { if (open && root && !root.contains(e.target as Node) && !panelEl?.contains(e.target as Node)) open = false; };
  const focusFirst = (el: HTMLElement) => {
    (el.querySelector('input:not([type=checkbox]), [role=menuitem]:not(:disabled), button:not(:disabled), input') as HTMLElement | null)?.focus();
  };
</script>

<svelte:window onpointerdown={outside} onresize={() => open && place()} onscrollcapture={() => open && place()} />
<div class="pop" bind:this={root}>
  <button class="trigger {buttonClass}" aria-haspopup="true" aria-expanded={open} aria-label={label} {title} onclick={toggle}
    onkeydown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); toggle(); } }}>
    {@render button()}{#if chevron}<span class="chev" aria-hidden="true"></span>{/if}
  </button>
  {#if open}
    <div class="panel" bind:this={panelEl} use:toBody style:width="{Math.min(width, window.innerWidth - 16)}px" style:top={at.top === null ? undefined : `${at.top}px`} style:bottom={at.bottom === null ? undefined : `${at.bottom}px`}
      style:left="{at.left}px" style:max-height="{at.max}px" role="dialog" aria-label={label} tabindex="-1" use:focusFirst
      onkeydown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); open = false; (root?.querySelector('.trigger') as HTMLElement | null)?.focus(); } }}>
      {@render children(close)}
    </div>
  {/if}
</div>

<style>
  .pop { position: relative; flex: none; }
  .trigger { display: inline-flex; align-items: center; gap: 8px; max-width: 60vw; }
  .chev { flex: none; width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: translateY(-2px) rotate(45deg); opacity: .6; }
  .panel { position: fixed; z-index: 40; overflow: auto; padding: 4px;
           background: var(--color-bg-elevated); border: 1px solid var(--color-border-strong); border-radius: 8px; box-shadow: 0 10px 28px rgba(0, 0, 0, .5); }
  .panel:focus { outline: none; }
</style>
