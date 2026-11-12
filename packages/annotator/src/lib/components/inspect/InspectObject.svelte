<script lang="ts">
  import { useSession } from '../../model/context';
  import { fmt } from '../../geometry';
  import type { ObjectTrack } from '../../types';
  import ObjectHeading from './ObjectHeading.svelte';
  import Details from './Details.svelte';
  import { lookedAtBy } from './lookedAt';

  let { object: o }: { object: ObjectTrack } = $props();
  const s = useSession();
  const i = $derived(s.identityOf(o));
  const looked = $derived(lookedAtBy(s, new Set([o.id])));
  async function assign(v: string) {
    if (!v) return;
    if (v === '__new') {
      const id = `objid:user:${Date.now()}`;
      await s.commit({ op: 'object.assign', track: o.id, identity: id });
      s.renaming = `${id}@panel`;
    } else await s.commit({ op: 'object.assign', track: o.id, identity: v });
  }
</script>

<ObjectHeading identity={i}>
  {fmt(o.start)}–{fmt(o.end)} · shot {(s.bundle.shotNumber(o.shot) ?? 0) + 1} · <button class="link" onclick={() => s.playback.playClip(o)}>play</button>
</ObjectHeading>
<div class="row which">
  <select aria-label="Which object this is" title="Which object this is: changes this appearance only" onchange={(e) => { assign(e.currentTarget.value); e.currentTarget.blur(); }}>
    {#each s.objectIdentities as x (x)}<option value={x} selected={x === i}>{s.objName(x)}</option>{/each}
    <option value="__new">New object…</option>
  </select>
  <button class="link" onclick={() => s.select('objid', i, { seek: false })}>Open {s.objName(i)}</button>
</div>
<Details kind="object" summary={`detected as “${o.label}”`}>
  <div class="meta">Detected as “{o.label}”.{#if looked} Looked at by {looked} (estimated).{/if}</div>
</Details>

<style>
  .which { margin-top: 12px; }
</style>
