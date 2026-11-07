<script lang="ts">
  // Play (the whole video), Clip (the selection), Loop, the time, the shot, what is drawn over the video (Overlays) and the speed.
  import { useSession, useSource } from '../model/context';
  import { fmt } from '../geometry';
  import Popover from './ui/Popover.svelte';
  import OverlaySettings from './OverlaySettings.svelte';

  const s = useSession(), source = useSource();
  const pb = s.playback;
  const L = $derived(s.view.s.layers);
  const span = $derived(s.clipOf(s.selection));
  const shot = $derived(s.bundle.shotAt(pb.time));
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
  <Popover label="What the video shows" title="What is drawn over the video, and how" width={300} align="right" buttonClass="plain">
    {#snippet button()}Overlays{/snippet}
    {#snippet children()}<OverlaySettings />{/snippet}
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
</style>
