<script lang="ts">
  // A gesture, a facing event or a gaze event: who, when and how sure.
  import { useSession } from '../../model/context';
  import { fmt } from '../../geometry';
  import { facingLabel, gazeLabel } from '../../timeline/rows';
  import type { SelKind } from '../../model/session.svelte';
  import type { FacingEvent, GazeEvent, GestureEvent } from '../../types';

  let { kind, id }: { kind: Extract<SelKind, 'gesture' | 'facing' | 'gaze'>; id: string } = $props();
  const s = useSession();
  const e = $derived((kind === 'gesture' ? s.gesture(id) : kind === 'facing' ? s.facingEvent(id) : s.gazeEvent(id)) as (GestureEvent | FacingEvent | GazeEvent) | undefined);
  const layer = $derived(kind === 'gesture' ? s.bundle.layers.gestures : kind === 'facing' ? s.bundle.layers.facing : s.bundle.layers.gaze);
  const model = $derived(layer?.producer.models.map((m) => m.id).join(', ') ?? '');
  const licence = $derived(s.bundle.manifest.layers[kind === 'gesture' ? 'gestures' : kind]?.licence_mode ?? '');
  const title = (k: string) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const person = (face: string | null | undefined) => s.personOfFace(face);
</script>

{#if e}
  {#if kind === 'gesture'}
    {@const g = e as GestureEvent}
    {@const p = person(g.face)}
    {@const target = g.detail?.target}
    <h2>{title(g.kind)}</h2>
    <div class="meta">{fmt(g.start)}–{fmt(g.end)} · <button class="link" onclick={() => s.playback.playClip(g)}>play</button> · {model} ({licence})</div>
    <div class="row">Who: {#if p}<button class="link" onclick={() => s.select('person', p, { seek: false })}>{s.nameOf(p)}</button>{:else}not linked to a face{/if}</div>
    {#if target}<div class="row">Pointing at: {s.lookName(target)} <span class="meta">(estimated)</span></div>{/if}
  {:else if kind === 'facing'}
    {@const f = e as FacingEvent}
    {@const a = person(f.from)}
    {@const b = person(f.to)}
    <h2>{f.mutual ? 'Facing each other' : 'Facing'}</h2>
    <div class="meta">{fmt(f.start)}–{fmt(f.end)} · <button class="link" onclick={() => s.playback.playClip(f)}>play</button> · {model} ({licence})</div>
    <div class="row">
      {#if a}<button class="link" onclick={() => s.select('person', a, { seek: false })}>{s.nameOf(a)}</button>{:else}?{/if}
      {f.mutual ? '⇄' : '→'}
      {#if b}<button class="link" onclick={() => s.select('person', b, { seek: false })}>{s.nameOf(b)}</button>{:else}?{/if}
    </div>
    <div class="meta" title={facingLabel(s, f)}>{f.detail?.mean_angle_deg !== undefined ? `mean angle off ${f.detail.mean_angle_deg.toFixed(1)}° · ` : ''}{f.score !== undefined ? `score ${Number(f.score).toFixed(2)}` : ''}</div>
  {:else}
    {@const g = e as GazeEvent}
    <h2>{title(g.kind)}</h2>
    <div class="meta">{fmt(g.start)}–{fmt(g.end)} · <button class="link" onclick={() => s.playback.playClip(g)}>play</button> · Gaze-LLE ({licence})</div>
    <div class="row">{gazeLabel(s, g)}</div>
    {#if g.score !== undefined && g.score !== null}<div class="meta">score {Number(g.score).toFixed(2)}</div>{/if}
    <div class="meta">{model}</div>
  {/if}
  {#if kind === 'gesture' && (e as GestureEvent).score !== undefined}<div class="meta">score {Number((e as GestureEvent).score).toFixed(2)}</div>{/if}
{/if}
