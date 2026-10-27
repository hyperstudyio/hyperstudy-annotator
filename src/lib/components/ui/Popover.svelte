<script lang="ts">
  // A button that opens a small panel under it (the video switcher, the timeline's layers): closed by choosing in it
  // (`close` given to the content), Escape, or a click anywhere else. The panel takes the keyboard when it opens. It is
  // placed against the window, under the button, so a scrolling or clipped container (the timeline's labels) cannot
  // cut it off; it follows the button when what holds the button scrolls. While open it lives at the end of the page,
  // so no stacking of the button's own (the timeline's sticky labels, each above the next) can draw over it. Being
  // there, it keeps the page's order by hand: Tab past either end closes it and returns to the button, focus leaving it
  // closes it, and it does not open, or stays open, while the button is out of reach (inert: a dialog is open).
  import type { Snippet } from 'svelte';
  import { placeBy, type Placement } from './place';

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
  let at = $state<Placement>({ top: 0, bottom: null, left: 0, max: 480 });
  const close = () => { open = false; };
  const place = () => { if (root) at = placeBy(root.getBoundingClientRect(), width, align); };
  const trigger = () => root?.querySelector('.trigger') as HTMLElement | null;
  const unreachable = () => !!root?.closest('[inert]');
  const toggle = () => { if (open) { open = false; return; } if (unreachable()) return; place(); open = true; };
  const back = () => { open = false; trigger()?.focus(); };
  // a dialog opening behind the panel (the carry-over offer makes the viewer inert) closes it
  $effect(() => {
    if (!open) return;
    const watch = new MutationObserver(() => { if (unreachable()) open = false; });
    watch.observe(document.body, { attributes: true, attributeFilter: ['inert'], subtree: true });
    return () => watch.disconnect();
  });
  const focusable = () => [...(panelEl?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])];
  // Tab moves through the panel's own controls here, not by the engine's order: WebKit (the desktop app's) skips
  // buttons and checkboxes by default, which would take the focus out of an open panel. Past an end: back to the button.
  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); back(); return; }
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const f = focusable(), at = f.indexOf(document.activeElement as HTMLElement), next = at + (e.shiftKey ? -1 : 1);
    if (at < 0 || next < 0 || next >= f.length) back();
    else f[next].focus();
  }
  // focus gone somewhere that is neither the panel nor its button (a click elsewhere is `outside`)
  const onfocusout = (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (to && !panelEl?.contains(to) && !root?.contains(to)) open = false;
  };
  const outside = (e: PointerEvent) => { if (open && root && !root.contains(e.target as Node) && !panelEl?.contains(e.target as Node)) open = false; };
  const focusFirst = (el: HTMLElement) => {
    (el.querySelector('input:not([type=checkbox]), [role=menuitem]:not(:disabled), button:not(:disabled), input') as HTMLElement | null)?.focus();
  };
</script>

<svelte:window onpointerdown={outside} onresize={() => open && place()} onscrollcapture={() => open && place()} />
<div class="pop" bind:this={root}>
  <button class="trigger {buttonClass}" aria-haspopup="dialog" aria-expanded={open} aria-label={label} {title} onclick={toggle}
    onkeydown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); toggle(); } }}>
    {@render button()}{#if chevron}<span class="chev" aria-hidden="true"></span>{/if}
  </button>
  {#if open}
    <div class="panel" bind:this={panelEl} use:toBody style:width="{Math.min(width, window.innerWidth - 16)}px" style:top={at.top === null ? undefined : `${at.top}px`} style:bottom={at.bottom === null ? undefined : `${at.bottom}px`}
      style:left="{at.left}px" style:max-height="{at.max}px" role="dialog" aria-label={label} tabindex="-1" use:focusFirst
      {onkeydown} {onfocusout}>
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
