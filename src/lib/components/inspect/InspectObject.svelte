<script lang="ts">
  import { useSession } from '../../model/context';
  import { fmt } from '../../geometry';
  import type { ObjectTrack } from '../../types';
  import Toggle from '../ui/Toggle.svelte';
  import ObjectHeading from './ObjectHeading.svelte';
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
  detected as “{o.label}” · shot {(s.bundle.shotNumber(o.shot) ?? 0) + 1} · {fmt(o.start)}–{fmt(o.end)} ·
  <button class="link" onclick={() => s.playback.playClip(o)}>play</button> · <button class="link" onclick={() => (s.renaming = `${i}@panel`)}>rename</button>
</ObjectHeading>
<h3>Which object is this?</h3>
<div class="row">This is
  <select aria-label="Which object this is" onchange={(e) => { assign(e.currentTarget.value); e.currentTarget.blur(); }}>
    {#each s.objectIdentities as x (x)}<option value={x} selected={x === i}>{s.objName(x)}</option>{/each}
    <option value="__new">New object…</option>
  </select>
</div>
<div class="meta">Changes this appearance only. <button class="link" onclick={() => s.select('objid', i, { seek: false })}>Edit every {s.objName(i)} instead</button></div>
<h3>Send to agents</h3>
<div class="list">
  <Toggle label="Include this appearance" checked={s.includedObject(o)} onchange={(v) => s.commit({ op: 'entity.include', id: o.id, included: v })} />
  <Toggle label={`Include ${s.objName(i)} everywhere`} checked={s.includedIdentity(i)} onchange={(v) => s.commit({ op: 'entity.include', id: i, included: v })} />
</div>
{#if looked}<h3>Looked at by (estimated)</h3><div class="meta">{looked}</div>{/if}
