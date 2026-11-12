<script lang="ts">
  // A person's or an object's colour, as a swatch that opens the system colour picker: the colour the timeline, the
  // overlays and the panels use for it (the viewer's own choice, kept with the layout: never a correction).
  import { useSession } from '../../model/context';

  let { id, colour, size = 10, label }: { id: string; colour: string; size?: number; label: string } = $props();
  const s = useSession();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<label class="pick" style="--c:{colour}; --s:{size}px" title="{label} · click to change" onclick={(e) => e.stopPropagation()}>
  <input type="color" value={colour} aria-label={label} oninput={(e) => s.view.setColour(id, e.currentTarget.value)} onchange={(e) => e.currentTarget.blur()} />
</label>

<style>
  .pick { position: relative; flex: none; width: var(--s); height: var(--s); border-radius: 50%; background: var(--c); cursor: pointer;
          box-shadow: 0 0 0 1px rgba(0, 0, 0, .35); }
  .pick:hover { box-shadow: 0 0 0 2px var(--color-text-primary); }
  .pick:focus-within { box-shadow: 0 0 0 2px var(--color-primary); }
  /* the input fills the swatch, invisible: a click anywhere on it opens the picker */
  input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: 0; padding: 0; }
</style>
