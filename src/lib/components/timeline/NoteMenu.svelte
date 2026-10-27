<script lang="ts">
  // An annotation's menu, at its bar on the timeline (double-click the bar, or Enter when it is selected): its value
  // and who it is about, as in Inspect (NoteFields). It closes once the annotation says all it needs to (a value, and a
  // person when its type is about one), on Escape, or on a click anywhere else. It lives at the end of the page, as a
  // Popover's panel does, so no sticky label draws over it; it follows the bar when the timeline scrolls.
  import { tick, untrack } from 'svelte';
  import { useSession } from '../../model/context';
  import { fmt } from '../../geometry';
  import { placeBy, type Placement } from '../ui/place';
  import NoteFields from '../inspect/NoteFields.svelte';

  let { id }: { id: string } = $props();
  const s = useSession();
  const n = $derived(s.S.notes.get(id));
  const type = $derived(n ? s.typeOf(n.type) : undefined);
  const WIDTH = 300;
  let panel = $state<HTMLElement>();
  let at = $state<Placement | null>(null);
  // a field being typed in saves on `change`, which comes with its blur: blurred here, before the menu leaves the page,
  // as an engine need not blur a focused field it removes (WebKit, the app's, has not), and the typing would be lost
  const close = () => {
    const typing = document.activeElement as HTMLElement | null;
    if (typing && panel?.contains(typing)) typing.blur();
    if (s.noteMenu === id) s.noteMenu = null;
  };
  const bar = () => document.querySelector<HTMLElement>(`.bar[data-key="${CSS.escape(id)}"]`);
  function place() {
    const el = bar();
    if (!el) { close(); return; }   // its row was collapsed or hidden
    at = placeBy(el.getBoundingClientRect(), WIDTH);
  }
  $effect(() => { void id; tick().then(() => { place(); panel?.focus(); }); });
  // it is the selected annotation's: selecting something else closes it (⌫ deletes the selection, never another)
  $effect(() => { if (!n || s.modal || s.selection?.kind !== 'note' || s.selection.id !== id) close(); });

  // an edit that leaves it saying all it needs to closes the menu (a click, or a key: 1–9, y, n)
  const complete = $derived(!!n && s.hasValue(n) && (type?.target !== 'person' || !!n.person));
  const said = $derived(n ? JSON.stringify([n.value, n.person]) : '');
  let seen: string | null = null;
  $effect(() => {
    const now = said;
    untrack(() => { if (seen !== null && now !== seen && complete) close(); seen = now; });
  });

  const toBody = (el: HTMLElement) => { document.body.append(el); return { destroy: () => el.remove() }; };
  const outside = (e: PointerEvent) => { if (panel && !panel.contains(e.target as Node)) close(); };
  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  }
  const onfocusout = (e: FocusEvent) => { const to = e.relatedTarget as Node | null; if (to && !panel?.contains(to)) close(); };
</script>

<svelte:window onpointerdown={outside} onresize={place} onscrollcapture={place} />

{#if n && type && at}
  <div class="note-menu" bind:this={panel} use:toBody role="dialog" aria-label={`${type.name} annotation`} tabindex="-1"
    style:width="{Math.min(WIDTH, window.innerWidth - 16)}px" style:left="{at.left}px" style:max-height="{at.max}px"
    style:top={at.top === null ? undefined : `${at.top}px`} style:bottom={at.bottom === null ? undefined : `${at.bottom}px`}
    {onkeydown} {onfocusout}>
    <div class="head"><strong>{type.name}</strong><span class="meta">{fmt(n.start)}–{fmt(n.end)}</span></div>
    <NoteFields note={n} />
    <div class="foot">
      <button class="link danger" onclick={() => s.deleteNote(id)} title="Delete (⌫)">Delete</button>
      <button class="link" onclick={close}>Done</button>
    </div>
  </div>
{/if}

<style>
  .note-menu { position: fixed; z-index: 40; overflow: auto; padding: 10px 12px; display: grid; gap: 2px;
               background: var(--color-bg-elevated); border: 1px solid var(--color-border-strong); border-radius: 8px; box-shadow: 0 10px 28px rgba(0, 0, 0, .5); }
  .note-menu:focus { outline: none; }
  /* the annotation's name leads; what it holds is labelled quietly */
  .note-menu :global(h3) { margin: 10px 0 4px; font-size: 12px; font-weight: 500; color: var(--color-text-muted); }
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 14px; }
  .head .meta { font-size: 12px; font-variant-numeric: tabular-nums; }
  .foot { display: flex; justify-content: space-between; margin-top: 10px; }
  .danger { color: var(--color-danger); }
</style>
