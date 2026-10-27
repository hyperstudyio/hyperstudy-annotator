<script lang="ts">
  // The sticky label of a timeline row: what the row is (a person with their crop, a voice, an object, an annotation
  // type, a model), a grip to move the row within its group, and a button to hide it. An annotation type's name opens
  // the type to edit, and makes it the one keys annotate with (marked by its filled dot).
  import { useSession } from '../../model/context';
  import { AFFECT_COLOURS } from '../../draw/plots';
  import { NEUTRAL } from '../../model/session.svelte';
  import type { Row } from '../../timeline/rows';
  import Crop from '../ui/Crop.svelte';
  import Swatch from '../ui/Swatch.svelte';
  import Name from '../ui/Name.svelte';
  import ModelInfo from './ModelInfo.svelte';
  import Popover from '../ui/Popover.svelte';
  import TypeForm from './TypeForm.svelte';

  // `info`: a timeline group whose models an ⓘ beside the label lists (the shot rows, which are in no group)
  let { row, ongrip, onhide, info }: { row: Row; ongrip?: (e: PointerEvent) => void; onhide?: () => void; info?: string } = $props();
  const s = useSession();
  const L = $derived(row.label);
  const clickable = $derived(L.kind === 'person' || L.kind === 'object');

  function onclick() {
    if (L.kind === 'person') s.select('person', L.person, { seek: false });
    else if (L.kind === 'object') s.select('objid', L.identity, { seek: false });
  }
  const title = $derived(L.kind === 'person' ? (s.special(L.person) ? 'Click to inspect' : 'Click to inspect · double-click to rename')
    : L.kind === 'voice' ? 'Off-screen voice · double-click to rename' : L.kind === 'object' ? 'Click to inspect · double-click to rename'
    : 'title' in L ? L.title : undefined);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="lane-label" class:clickable {title} tabindex="-1" onclick={clickable ? onclick : undefined}>
  {#if ongrip}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span class="grip" title="Drag to move this row within its group" onpointerdown={ongrip} onclick={(e) => e.stopPropagation()}>
      <svg viewBox="0 0 6 10" width="6" height="10" aria-hidden="true"><g fill="currentColor"><circle cx="1.5" cy="2" r="1" /><circle cx="4.5" cy="2" r="1" /><circle cx="1.5" cy="5" r="1" /><circle cx="4.5" cy="5" r="1" /><circle cx="1.5" cy="8" r="1" /><circle cx="4.5" cy="8" r="1" /></g></svg>
    </span>
  {/if}
  {#if L.kind === 'person'}
    {@const crop = s.cropOf(L.person)}
    {#if crop}<Crop path={crop} size="row" label="Every track of this person" onclick={(e) => { e.stopPropagation(); s.lightbox = { kind: 'person', person: L.person }; }} />
    {:else}<Swatch colour={s.colourOf(L.person)} size={9} />{/if}
    <Name text={s.nameOf(L.person)} id={L.person} area="timeline" grow onrename={s.special(L.person) ? undefined : (name) => s.commit({ op: 'person.rename', person: L.person, name })} />
  {:else if L.kind === 'voice'}
    <Swatch colour={NEUTRAL} size={9} />
    <Name text={s.voiceName(L.voice)} id={L.voice ?? 'voice:'} area="timeline" grow onrename={L.voice ? (name) => s.commit({ op: 'voice.rename', voice: L.voice!, name }) : undefined} />
  {:else if L.kind === 'object'}
    {@const crop = s.objCrop(L.identity)}
    {#if crop}<Crop path={crop} size="row" />{:else}<Swatch colour={s.objColour(L.identity)} size={9} />{/if}
    <Name text={s.objName(L.identity)} id={L.identity} area="timeline" grow onrename={(name) => s.commit({ op: 'object.rename', identity: L.identity, name })} />
  {:else if L.kind === 'type'}
    {@const type = s.typeOf(L.type)}
    <span class="dot" class:current={s.currentType()?.id === L.type} title={s.currentType()?.id === L.type ? 'A and [ ] annotate with this type' : undefined}></span>
    {#if type}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="type-name" onclick={(e) => { e.stopPropagation(); s.activeType = L.type; }}>
        <Popover label={`Annotation type ${L.text}`} width={300} chevron={false} buttonClass="plain" title="Edit this type">
          {#snippet button()}<span class="text">{L.text}</span>{/snippet}
          {#snippet children(close)}<TypeForm {type} {close} />{/snippet}
        </Popover>
      </span>
    {/if}
  {:else if L.kind === 'affect'}
    <span class="text fixed">{L.model}</span>
    <span class="dims"><span style="color:{AFFECT_COLOURS.arousal}">arousal</span> <span style="color:{AFFECT_COLOURS.valence}">valence</span></span>
  {:else}
    <span class="text">{L.text}</span>
  {/if}
  {#if info}<ModelInfo group={info} title={L.kind === 'text' ? L.text : info} />{/if}
  {#if onhide}
    <button class="hide" title="Hide this row" aria-label="Hide this row" onclick={(e) => { e.stopPropagation(); onhide(); }}>
      <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true"><path d="M2 2l6 6M8 2 2 8" stroke="currentColor" stroke-width="1.5" /></svg>
    </button>
  {/if}
</div>

<style>
  .lane-label { position: sticky; left: 0; z-index: 3; width: var(--label-w); flex: none; padding: 3px 6px 3px 16px; background: var(--color-bg-surface);
                color: var(--color-text-secondary); display: flex; align-items: center; gap: 6px; border-right: 1px solid var(--color-border-default);
                overflow: hidden; white-space: nowrap; }
  .clickable { cursor: pointer; }
  .clickable:hover { color: var(--color-text-primary); }
  .text { overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; border: 1.5px solid #ce93d8; }
  .dot.current { background: #ce93d8; }
  .type-name { flex: 1; min-width: 0; display: flex; }
  .type-name :global(.pop) { min-width: 0; flex: 1; display: flex; }
  .type-name :global(.trigger) { min-width: 0; max-width: 100%; padding: 0; color: inherit; font: inherit; }
  .type-name :global(.trigger:hover) { color: var(--color-text-primary); text-decoration: underline dotted; text-underline-offset: 3px; }
  .text.fixed { flex: none; }
  .dims { font-size: 11px; white-space: nowrap; margin-left: 2px; }
  .grip { position: absolute; left: 3px; width: 10px; display: grid; place-items: center; color: var(--color-text-muted); cursor: grab; visibility: hidden; }
  .lane-label:hover .grip { visibility: visible; }
  .hide { visibility: hidden; background: none; border: 0; padding: 0 2px; color: var(--color-text-muted); line-height: 1; display: grid; place-items: center; }
  .lane-label:hover .hide { visibility: visible; }
  .hide:hover { color: var(--color-text-primary); }
</style>
