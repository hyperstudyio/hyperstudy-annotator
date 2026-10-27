<script lang="ts">
  // Play (the whole video), Clip (the selection), Loop, the time, the shot, what is drawn over the video (Overlays) and the speed.
  import { useSession, useSource } from '../model/context';
  import { fmt } from '../geometry';
  import type { OverlayLayers } from '../model/view.svelte';
  import Popover from './ui/Popover.svelte';

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
  <Popover label="What the video shows" title="Boxes and outlines drawn over the video" width={250} align="right" buttonClass="plain">
    {#snippet button()}Overlays{/snippet}
    {#snippet children()}
      {#snippet item(label: string, key: keyof OverlayLayers, on: boolean, disabled: boolean, title?: string)}
        <label class="menu-item" class:off={disabled} {title}><input type="checkbox" checked={on} {disabled} onchange={(e) => set(key, e.currentTarget.checked)} />{label}</label>
      {/snippet}
      {@render item('Faces', 'boxes', L.boxes, !b.faces)}
      {@render item('Objects', 'objects', L.objects, !b.objects)}
      {@render item('Skeletons', 'skeleton', L.skeleton, !b.bodies, b.bodies ? `Body skeletons (${b.bodies.producer.models[0]?.id ?? ''})` : 'No bodies layer for this video')}
      {@render item('Hands', 'hands', L.hands, !b.hands, b.hands ? 'Hand keypoints (dashed: found by the hand detector, no body)' : 'No hands layer for this video')}
      {#if handsUnlinked}{@render item('Hands with no body', 'unlinkedHands', L.unlinkedHands, false, 'Also hands the hand detector found with no body (often faces, logos or bokeh)')}{/if}
      {@render item('Face landmarks', 'landmarks', L.landmarks, noDetail, noDetail ? 'No py-feat face detail for this video' : 'py-feat landmarks')}
      {@render item('Gaze', 'gaze', L.gaze, !b.gaze && noDetail)}
      {#if b.gaze && !noDetail && L.gaze}
        <div class="sub"><select aria-label="Gaze source" title="Where the drawn gaze comes from (the Social rows always use Gaze-LLE)" value={s.view.s.gazeSource}
          onchange={(e) => s.view.setGazeSource(e.currentTarget.value as 'gaze_lle' | 'pyfeat')}>
          <option value="gaze_lle">From Gaze-LLE</option><option value="pyfeat">From py-feat's ray</option>
        </select></div>
      {/if}
      <div class="menu-sep"></div>
      {@render item('Smooth the drawing', 'smooth', L.smooth, false, 'Centred 1-2-1 smoothing of drawn points and the pitch contour (display only; data stay raw)')}
    {/snippet}
  </Popover>
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
  .off { color: var(--color-text-muted); }
  .sub { padding: 2px 10px 6px 34px; }
</style>
