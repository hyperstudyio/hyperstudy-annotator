<script lang="ts">
  // The people in the video, from face clustering: a person opens here (renamed, merged, their tracks), and "All
  // people" goes back to the list.
  import { useSession } from '../../model/context';
  import InspectPerson from '../inspect/InspectPerson.svelte';
  import Crop from '../ui/Crop.svelte';
  import Swatch from '../ui/Swatch.svelte';
  import Name from '../ui/Name.svelte';
  const s = useSession();
  const rows = $derived(s.people.filter((p) => (s.tracksOf.get(p)?.length ?? 0) > 0));
  const open = $derived(s.selection?.kind === 'person' ? s.selection.id : null);
</script>

{#if open}
  <button class="link back" onclick={() => (s.selection = null)}>← All people</button>
  <InspectPerson person={open} />
{:else}

<div class="meta" style="margin-bottom:8px">Who face clustering found. Double-click a name to rename it.</div>
<div class="list">
  {#each rows as p (p)}
    {@const crop = s.cropOf(p)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="item" class:selected={s.isSel('person', p)} role="button" tabindex="-1"
      onclick={() => s.select('person', p, { seek: false })}>
      {#if crop}<Crop path={crop} size="sm" label="Every track of this person" onclick={(e) => { e.stopPropagation(); s.lightbox = { kind: 'person', person: p }; }} />
      {:else}<Swatch colour={s.colourOf(p)} />{/if}
      <Name text={s.nameOf(p)} id={p} area="people" grow onrename={s.special(p) ? undefined : (name) => s.commit({ op: 'person.rename', person: p, name })} />
      <span class="meta">{(s.screenSeconds.get(p) ?? 0).toFixed(0)} s · {s.tracksOf.get(p)?.length}</span>
    </div>
  {/each}
</div>
{/if}

<style>
  .back { display: block; margin: -4px 0 10px; }
</style>
