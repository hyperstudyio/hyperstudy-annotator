<script lang="ts">
  import { useSession } from '../../model/context';
  import Crop from '../ui/Crop.svelte';
  import Swatch from '../ui/Swatch.svelte';
  import Name from '../ui/Name.svelte';
  const s = useSession();
  const rows = $derived(s.people.filter((p) => (s.tracksOf.get(p)?.length ?? 0) > 0));
</script>

<div class="meta" style="margin-bottom:8px">Identities from face clustering. Double-click a name to rename; click a picture to see every track.</div>
<div class="list">
  {#each rows as p (p)}
    {@const crop = s.cropOf(p)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="item" class:selected={s.isSel('person', p)} class:done={!s.includedPerson(p)} role="button" tabindex="-1"
      onclick={() => s.select('person', p, { seek: false })}>
      {#if crop}<Crop path={crop} size="sm" label="Every track of this person" onclick={(e) => { e.stopPropagation(); s.lightbox = { kind: 'person', person: p }; }} />
      {:else}<Swatch colour={s.colourOf(p)} />{/if}
      <Name text={s.nameOf(p)} id={p} area="people" grow onrename={s.special(p) ? undefined : (name) => s.commit({ op: 'person.rename', person: p, name })} />
      <span class="meta">{(s.screenSeconds.get(p) ?? 0).toFixed(0)} s · {s.tracksOf.get(p)?.length}</span>
    </div>
  {/each}
</div>
