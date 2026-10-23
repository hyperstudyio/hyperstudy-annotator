<script lang="ts">
  import { useSession } from '../../model/context';
  import { fmt, nearest } from '../../geometry';
  import { plural } from '../../model/session.svelte';
  import type { FaceTrack } from '../../types';
  import Toggle from '../ui/Toggle.svelte';
  import Crop from '../ui/Crop.svelte';
  import Swatch from '../ui/Swatch.svelte';
  import PersonSelect from '../ui/PersonSelect.svelte';
  import NewPerson from './NewPerson.svelte';
  import LiveFace from './LiveFace.svelte';

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

<div class="row">
  {#if track.crop}<Crop path={track.crop} size="lg" label="Enlarge" onclick={() => (s.lightbox = { kind: 'face', face: track.id })} />{/if}
  <div>
    <h2><Swatch colour={s.colourOf(p)} /> Face track {track.id.slice(5)}</h2>
    <div class="meta">Shot {(s.bundle.shotNumber(track.shot) ?? 0) + 1} · {fmt(track.start)}–{fmt(track.end)} · <button class="link" onclick={() => s.playback.playClip(track)}>play</button></div>
  </div>
</div>
<h3>Who is this?</h3>
<div class="row">This face is <PersonSelect current={p} onpick={assign} label="This face is" /></div>
{#if creating}<NewPerson oncreate={create} />{/if}
<div class="meta">Changes this track only. {#if !s.special(p)}<button class="link" onclick={() => s.select('person', p, { seek: false })}>Edit {s.nameOf(p)} instead</button>{/if}</div>
<h3>Send to agents</h3>
<div class="list">
  <Toggle label="Include this track" checked={s.includedFace(track)} onchange={(v) => s.commit({ op: 'entity.include', id: track.id, included: v })} />
  {#if !s.special(p)}<Toggle label={`Include ${s.nameOf(p)} everywhere`} checked={s.includedPerson(p)} onchange={(v) => s.commit({ op: 'entity.include', id: p, included: v })} />{/if}
</div>
{#if s.bundle.layers.bodies}
  <h3>Body · {model}</h3>
  {#if bodies.length}
    <div class="meta">{plural(bodies.length, 'body track')} linked ({bodies[0].link ?? 'linked'}).{#if facing} Facing {Math.round(facing[0])}° yaw{facing[1] === null ? ' (shoulders only, no pitch)' : `, ${Math.round(facing[1])}° pitch`} at the playhead.{/if}</div>
  {:else}<div class="meta">No body linked to this face track.</div>{/if}
{/if}
<h3>py-feat at the playhead (academic)</h3>
<LiveFace {track} />
<h3>Whole track</h3>
<div class="meta">Mean expression {track.summary?.dominant_emotion ?? 'unknown'}. Speaker in {plural(speaking, 'utterance')}.{#if looks} Looking at (Gaze-LLE): {looks}.{/if}</div>
