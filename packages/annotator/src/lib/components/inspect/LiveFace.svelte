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
  let allShown = $state(false);
  const emotions = $derived(d && s.detail ? s.detail.emotion_names.map((n, i) => ({ n, v: d!.emo[i] })).sort((a, b) => b.v - a.v) : []);
</script>

{#if !s.bundle.layers.faces?.detail}
  <div class="meta">No py-feat detail in this bundle.</div>
{:else if !s.detail}
  <div class="meta">Loading…</div>
{:else if !d}
  <div class="meta">Move the playhead into this track to see its frame.</div>
{:else}
  <h3>At {fmt(d.t)} <span class="src">py-feat, academic use</span></h3>
  {#if look}<div class="row">Looking at {look}</div>{/if}
  <!-- the strongest emotions; the rest, the action units and the angles when asked -->
  <div class="bars">
    {#each (allShown ? emotions : emotions.slice(0, 3)) as e (e.n)}<span>{e.n}</span><div class="fill emo" style="width:{Math.round(e.v * 100)}%"></div><span class="val">{e.v.toFixed(2)}</span>{/each}
  </div>
  <button class="link more" onclick={() => (allShown = !allShown)}>{allShown ? 'Fewer' : 'All emotions, action units and angles'}</button>
  {#if allShown}
    <h3>Action units</h3>
    <div class="bars">
      {#each s.detail.au_names as n, i (n)}<span title={AU_NAMES[n] ?? ''}>{n}</span><div class="fill" title={AU_NAMES[n] ?? ''} style="width:{Math.round(Math.min(1, Math.max(0, d.au[i])) * 100)}%"></div><span class="val">{d.au[i].toFixed(2)}</span>{/each}
    </div>
    <div class="meta angles">Gaze yaw {deg(d.gaze[0])}, pitch {deg(d.gaze[1])} · head yaw {deg(d.head[0])}, pitch {deg(d.head[1])}, roll {deg(d.head[2])} · valence {d.va[0].toFixed(2)}, arousal {d.va[1].toFixed(2)}</div>
  {/if}
{/if}

<style>
  .bars { display: grid; grid-template-columns: 58px 1fr 36px; gap: 2px 8px; align-items: center; font-size: 12px; }
  .fill { height: 8px; border-radius: 4px; background: var(--color-info); min-width: 1px; }
  .fill.emo { background: #a78bfa; }
  .val { color: var(--color-text-muted); text-align: right; font-variant-numeric: tabular-nums; }
  .src { font-weight: 400; color: var(--color-text-muted); margin-left: 4px; }
  .more { margin-top: 6px; font-size: 12px; }
  .angles { margin-top: 8px; font-size: 12px; }
</style>
