<script lang="ts">
  // Play (the whole video), Clip (the selection), Loop, the time, the shot, the overlay layers and the speed.
  import { useSession, useSource } from '../model/context';
  import { fmt } from '../geometry';
  import type { OverlayLayers } from '../model/view.svelte';
  import Chip from './ui/Chip.svelte';

  const s = useSession(), source = useSource();
  const pb = s.playback;
  const L = $derived(s.view.s.layers);
  const span = $derived(s.clipOf(s.selection));
  const shot = $derived(s.bundle.shotAt(pb.time));
  const b = $derived(s.bundle.layers);
  const noDetail = $derived(!b.faces?.detail);
  const handsUnlinked = $derived((b.hands?.hands ?? []).some((x) => !x.body && !x.face));
  function set(key: keyof OverlayLayers, on: boolean) {
    s.view.setLayer(key, on);
    if (on && (key === 'landmarks' || key === 'gaze')) s.needDetail(source);
  }
  $effect(() => { if (L.landmarks || L.gaze) s.needDetail(source); });
  const keepFocusOff = (e: MouseEvent) => e.preventDefault();   // Space stays play/pause
</script>

<div class="transport">
  <button class="play" onmousedown={keepFocusOff} onclick={() => pb.toggle()} title="Play or pause the whole video from the playhead (Space)">{pb.paused || pb.clip ? 'Play' : 'Pause'}</button>
  <button disabled={!span && !pb.playingClip} onmousedown={keepFocusOff} onclick={() => (pb.playingClip ? pb.stop() : s.playSelection())}
    title={pb.playingClip ? 'Stop the clip' : 'Play the selected item from its start to its end (Shift+Space)'}>
    {#if pb.playingClip}Stop clip{:else if span}Clip {fmt(span.start)}–{fmt(span.end)}{:else}Clip{/if}
  </button>
  <button class:on={pb.loop} onmousedown={keepFocusOff} onclick={() => (pb.loop = !pb.loop)} title="Loop the clip (L)" aria-pressed={pb.loop}>Loop</button>
  <span class="time">{fmt(pb.time)} / {fmt(s.bundle.duration)}</span>
  {#if shot}<span>Shot {shot.index + 1} of {s.bundle.shots.length}</span>{/if}
  <span class="spacer"></span>
  <span class="layers">
    <Chip label="Faces" checked={L.boxes} disabled={!b.faces} onchange={(v) => set('boxes', v)} />
    <Chip label="Objects" checked={L.objects} disabled={!b.objects} onchange={(v) => set('objects', v)} />
    <Chip label="Skeleton" checked={L.skeleton} disabled={!b.bodies} title={b.bodies ? `Body skeletons (${b.bodies.producer.models[0]?.id ?? ''})` : 'No bodies layer in this bundle'} onchange={(v) => set('skeleton', v)} />
    <Chip label="Hands" checked={L.hands} disabled={!b.hands} title={b.hands ? 'Hand keypoints (dashed: found by the hand detector, no body)' : 'No hands layer in this bundle'} onchange={(v) => set('hands', v)} />
    {#if handsUnlinked}<Chip label="Unlinked hands" checked={L.unlinkedHands} title="Also draw hands the hand detector found with no body (often faces, logos or bokeh)" onchange={(v) => set('unlinkedHands', v)} />{/if}
    <Chip label="Landmarks" checked={L.landmarks} disabled={noDetail} title={noDetail ? 'No py-feat face detail in this bundle' : 'py-feat landmarks'} onchange={(v) => set('landmarks', v)} />
    <Chip label="Gaze" checked={L.gaze} disabled={!b.gaze && noDetail} onchange={(v) => set('gaze', v)} />
    {#if b.gaze && !noDetail}
      <select aria-label="Gaze source" title="Gaze source for the overlay (the Social rows always come from Gaze-LLE)" value={s.view.s.gazeSource}
        onchange={(e) => { s.view.setGazeSource(e.currentTarget.value as 'gaze_lle' | 'pyfeat'); e.currentTarget.blur(); }}>
        <option value="gaze_lle">gaze: Gaze-LLE</option>
        <option value="pyfeat">gaze: py-feat ray</option>
      </select>
    {/if}
    <Chip label="Smooth" checked={L.smooth} title="Centred 1-2-1 smoothing of drawn points and the pitch contour (display only; data stay raw)" onchange={(v) => set('smooth', v)} />
  </span>
  <label>Speed
    <select aria-label="Playback speed" value={String(pb.rate)} onchange={(e) => { pb.setRate(Number(e.currentTarget.value)); e.currentTarget.blur(); }}>
      {#each ['0.5', '0.75', '1', '1.5', '2'] as r (r)}<option value={r}>{r}</option>{/each}
    </select>
  </label>
</div>

<style>
  .transport { display: flex; align-items: center; gap: 10px; padding-top: 8px; color: var(--color-text-secondary); flex-wrap: wrap; min-width: 0; }
  .play { min-width: 64px; }
  .time { font-variant-numeric: tabular-nums; min-width: 128px; }
  .spacer { flex: 1; }
  .layers { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
</style>
