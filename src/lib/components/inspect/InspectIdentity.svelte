<script lang="ts">
  import { useSession } from '../../model/context';
  import { fmt } from '../../geometry';
  import { plural } from '../../model/session.svelte';
  import Swatch from '../ui/Swatch.svelte';
  import ObjectHeading from './ObjectHeading.svelte';
  import { lookedAtBy } from './lookedAt';

  let { identity: i }: { identity: string } = $props();
  const s = useSession();
  const tracks = $derived(s.objectsOf.get(i) ?? []);
  const looked = $derived(lookedAtBy(s, new Set(tracks.map((o) => o.id))));
  async function merge(v: string) {
    if (!v) return;
    const from = s.objName(i);
    await s.commit({ op: 'object.merge', from: i, into: v });
    s.select('objid', v, { seek: false });
    s.toast(`Merged ${from} into ${s.objName(v)}`);
  }
</script>

<ObjectHeading identity={i}>
  {plural(tracks.length, 'appearance')} · {tracks.reduce((a, o) => a + o.end - o.start, 0).toFixed(1)} s ·
  <button class="link" onclick={() => (s.renaming = `${i}@panel`)}>rename</button>
</ObjectHeading>
<h3>Same object as</h3>
<div class="row">
  <select aria-label="Same object as" onchange={(e) => { merge(e.currentTarget.value); e.currentTarget.blur(); }}>
    <option value="">Choose an object…</option>
    {#each s.objectIdentities.filter((x) => x !== i) as x (x)}<option value={x}>{s.objName(x)}</option>{/each}
  </select>
</div>
<div class="meta">Switch off for things that are irrelevant to the study.</div>
{#if looked}<h3>Looked at by (estimated)</h3><div class="meta">{looked}</div>{/if}
<h3>Appearances</h3>
<div class="list">
  {#each tracks as o (o.id)}
    <button class="item" class:done={!s.includedObject(o)} onclick={() => s.select('object', o.id)}>
      <Swatch colour={s.objColour(i)} />
      <span class="grow">{fmt(o.start)}–{fmt(o.end)} · shot {(s.bundle.shotNumber(o.shot) ?? 0) + 1}</span>
      <span class="meta">{o.label}</span>
    </button>
  {/each}
</div>
