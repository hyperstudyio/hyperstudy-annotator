<script lang="ts">
  // py-feat for the sample at the playhead, refreshed as the video moves.
  import { useSession, useSource } from '../../model/context';
  import { fmt, nearest } from '../../geometry';
  import type { FaceTrack } from '../../types';

  let { track }: { track: FaceTrack } = $props();
  const s = useSession(), source = useSource();
  const AU_NAMES: Record<string, string> = { AU01: 'inner brow raise', AU02: 'outer brow raise', AU04: 'brow lower', AU05: 'upper lid raise', AU06: 'cheek raise',
    AU07: 'lid tighten', AU09: 'nose wrinkle', AU10: 'upper lip raise', AU11: 'nasolabial deepen', AU12: 'lip corner pull (smile)',
    AU14: 'dimple', AU15: 'lip corner depress', AU17: 'chin raise', AU20: 'lip stretch', AU23: 'lip tighten', AU24: 'lip press',
    AU25: 'lips part', AU26: 'jaw drop', AU28: 'lip suck', AU43: 'eyes closed' };
  const fps = $derived(s.bundle.layers.faces?.sample_fps ?? 8);
  $effect(() => { s.needDetail(source); });
  const d = $derived(s.detail ? nearest(s.detail.tracks[track.id] ?? [], s.playback.time, 1 / fps) : null);
  const look = $derived.by(() => {
    if (!d) return null;
    const g = nearest(s.bundle.gazeOf.get(track.id) ?? [], d.t, 1 / (s.bundle.layers.gaze?.fps ?? 8));
    return g ? `${s.lookName(g.target)} (Gaze-LLE)` : null;
  });
  const deg = (r: number) => `${Math.round(r * 57.3)}°`;
</script>

{#if !s.bundle.layers.faces?.detail}
  <div class="meta">This bundle has no py-feat detail for faces.</div>
{:else if !s.detail}
  <div class="meta">Loading py-feat detail…</div>
{:else if !d}
  <div class="meta">Move the playhead inside this track ({fmt(track.start)}–{fmt(track.end)}) to see py-feat for that frame.</div>
{:else}
  <div class="meta">Sample at {fmt(d.t)}</div>
  {#if look}<div class="row"><b>Looking at:</b> {look}</div>{/if}
  <div class="meta">Gaze yaw {deg(d.gaze[0])}, pitch {deg(d.gaze[1])} · head yaw {deg(d.head[0])}, pitch {deg(d.head[1])}, roll {deg(d.head[2])} · valence {d.va[0].toFixed(2)}, arousal {d.va[1].toFixed(2)}</div>
  <h3>Emotions</h3>
  <div class="bars">
    {#each s.detail.emotion_names as n, i (n)}<span>{n}</span><div class="fill emo" style="width:{Math.round(d.emo[i] * 100)}%"></div><span class="val">{d.emo[i].toFixed(2)}</span>{/each}
  </div>
  <h3>Action units</h3>
  <div class="bars">
    {#each s.detail.au_names as n, i (n)}<span title={AU_NAMES[n] ?? ''}>{n}</span><div class="fill" title={AU_NAMES[n] ?? ''} style="width:{Math.round(Math.min(1, Math.max(0, d.au[i])) * 100)}%"></div><span class="val">{d.au[i].toFixed(2)}</span>{/each}
  </div>
{/if}

<style>
  .bars { display: grid; grid-template-columns: 58px 1fr 36px; gap: 2px 8px; align-items: center; font-size: 12px; }
  .fill { height: 8px; border-radius: 4px; background: var(--color-info); min-width: 1px; }
  .fill.emo { background: #a78bfa; }
  .val { color: var(--color-text-muted); text-align: right; font-variant-numeric: tabular-nums; }
</style>
