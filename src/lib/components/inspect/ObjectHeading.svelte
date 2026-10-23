<script lang="ts">
  import type { Snippet } from 'svelte';
  import { useSession } from '../../model/context';
  import Crop from '../ui/Crop.svelte';
  import Swatch from '../ui/Swatch.svelte';
  import Name from '../ui/Name.svelte';

  let { identity: i, children }: { identity: string; children: Snippet } = $props();
  const s = useSession();
  const crop = $derived(s.objCrop(i));
</script>

<div class="row">
  {#if crop}<Crop path={crop} size="lg" label="Enlarge" onclick={() => (s.lightbox = { kind: 'image', title: s.objName(i), src: crop })} />
  {:else}<Swatch colour={s.objColour(i)} size={28} />{/if}
  <div style="min-width:0; flex:1">
    <h2><Name text={s.objName(i)} id={i} area="panel" onrename={(name) => s.commit({ op: 'object.rename', identity: i, name })} /></h2>
    <div class="meta">{@render children()}</div>
  </div>
</div>
