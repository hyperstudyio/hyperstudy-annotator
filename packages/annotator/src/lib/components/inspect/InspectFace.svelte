<script lang="ts">
  import { useSession } from '../../model/context';
  import { fmt, nearest } from '../../geometry';
  import { plural } from '../../model/session.svelte';
  import type { FaceTrack } from '../../types';
  import Crop from '../ui/Crop.svelte';
  import Swatch from '../ui/Swatch.svelte';
  import PersonSelect from '../ui/PersonSelect.svelte';
  import NewPerson from './NewPerson.svelte';
  import LiveFace from './LiveFace.svelte';
  import Details from './Details.svelte';

  let { track }: { track: FaceTrack } = $props();
  const s = useSession();
  const p = $derived(s.personOf(track));
  let creating = $state(false);
  $effect(() => { void track.id; creating = false; });
  const speaking = $derived(s.bundle.utterances.filter((u) => { const sp = s.speakerOf(u); return sp.kind === 'face' && sp.face === track.id; }).length);
  const looks = $derived.by(() => {   // where Gaze-LLE has this face looking, over the whole track
    const samples = s.bundle.gazeOf.get(track.id) ?? [];
    const counts = new Map<string, number>();
    for (const g of samples) { const k = s.lookName(g.target); counts.set(k, (counts.get(k) ?? 0) + 1); }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${Math.round((100 * n) / samples.length)}%`).join(', ');
  });
  const bodies = $derived(s.bundle.bodiesByFace.get(track.id) ?? []);
  const facing = $derived.by(() => {
    for (const b of bodies) { const x = nearest(b.samples, s.playback.time, 1 / (s.bundle.layers.bodies?.fps ?? 8)); if (x?.facing) return x.facing; }
    return null;
  });
  // closed, Details says the gist: what this face mostly shows, and who it mostly looks at
  const topLook = $derived(looks.split(',')[0]?.replace(/ \d+%$/, '').trim());
  const glance = $derived([track.summary?.dominant_emotion, topLook && `looks at ${topLook}`].filter(Boolean).join(', '));
  const model = $derived(s.bundle.layers.bodies?.producer.models[0]?.id ?? '');
  async function assign(v: string) {
    if (v === '__new') { creating = true; return; }
    await s.commit({ op: 'track.assign', track: track.id, person: v });
  }
  async function create(name: string) {
    const id = `person:New ${s.S.created.length + 1}`;
    creating = false;
    await s.commit({ op: 'person.create', person: id, name }, { op: 'track.assign', track: track.id, person: id });
  }
</script>

<!-- who this face is, as the heading: the one thing a face track asks -->
<div class="head">
  {#if track.crop}<Crop path={track.crop} size="lg" label="Enlarge" onclick={() => (s.lightbox = { kind: 'face', face: track.id })} />{/if}
  <div class="who">
    <div class="pick" title="Who this face is: changes this track only">
      <Swatch colour={s.colourOf(p)} size={12} />
      <PersonSelect current={p} onpick={assign} label="This face is" />
    </div>
    <div class="meta">{fmt(track.start)}–{fmt(track.end)} · shot {(s.bundle.shotNumber(track.shot) ?? 0) + 1} · <button class="link" onclick={() => s.playback.playClip(track)}>play</button></div>
    {#if !s.special(p)}<button class="link" onclick={() => s.select('person', p, { seek: false })}>Open {s.nameOf(p)}</button>{/if}
  </div>
</div>
{#if creating}<NewPerson oncreate={create} />{/if}
<Details kind="face" summary={glance}>
  <LiveFace {track} />
  {#if s.bundle.layers.bodies}
    <h3>Body</h3>
    <div class="meta">{#if bodies.length}{plural(bodies.length, 'body track')} linked ({model}).{#if facing} Facing {Math.round(facing[0])}° yaw{facing[1] === null ? '' : `, ${Math.round(facing[1])}° pitch`} at the playhead.{/if}{:else}None linked.{/if}</div>
  {/if}
  <h3>Whole track</h3>
  <div class="meta">Mostly {track.summary?.dominant_emotion ?? 'unknown'}. Speaks in {plural(speaking, 'utterance')}.{#if looks} Looking at: {looks}.{/if}</div>
</Details>

<style>
  .head { display: flex; gap: 12px; align-items: flex-start; }
  .who { display: grid; gap: 4px; min-width: 0; justify-items: start; }
  .pick { display: flex; align-items: center; gap: 8px; }
  .pick :global(select) { font-size: 15px; font-weight: 600; padding: 3px 8px; }
</style>
