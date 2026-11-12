<script lang="ts">
  // Play (the clip when one is selected, else the whole video), the clip (cleared with its ×), Loop, the time, the shot, what is drawn over the video (Overlays), the volume (and mute) and the speed.
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
  <button class="play" onmousedown={keepFocusOff} onclick={() => pb.toggle()}
    title={pb.clip ? `Play or pause the clip${pb.loop ? ', looping' : ''} (Space)` : 'Play or pause the video from the playhead (Space)'}>{pb.paused ? 'Play' : 'Pause'}</button>
  {#if pb.clip}
    <span class="clip" title="Space plays this clip · drag its band on the timeline's ruler to move it or change its length">
      Clip {fmt(pb.clip.start)}–{fmt(pb.clip.end)}
      <button class="clear" onmousedown={keepFocusOff} onclick={() => pb.stop()} title="Let the clip go: Play plays the video (Esc)" aria-label="Clear the clip">
        <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true"><path d="M2 2l6 6M8 2 2 8" stroke="currentColor" stroke-width="1.6" /></svg>
      </button>
    </span>
  {:else if span}
    <button onmousedown={keepFocusOff} onclick={() => s.playSelection()} title="Play the selected item from its start to its end (Shift+Space)">Clip {fmt(span.start)}–{fmt(span.end)}</button>
  {/if}
  <button class:on={pb.loop} onmousedown={keepFocusOff} onclick={() => (pb.loop = !pb.loop)} title="Loop the clip (L)" aria-pressed={pb.loop}>Loop</button>
  <span class="time">{fmt(pb.time)} / {fmt(s.bundle.duration)}</span>
  {#if shot}<span>Shot {shot.index + 1} of {s.bundle.shots.length}</span>{/if}
  <span class="spacer"></span>
  <Popover label="What the video shows" title="What is drawn over the video, and how" width={300} align="right" buttonClass="plain">
    {#snippet button()}Overlays{/snippet}
    {#snippet children()}<OverlaySettings />{/snippet}
  </Popover>
  <span class="sound">
    <button class="plain mute" onmousedown={keepFocusOff} onclick={() => pb.toggleMute()} aria-pressed={pb.muted}
      title={pb.muted ? 'Unmute' : 'Mute'} aria-label={pb.muted ? 'Unmute' : 'Mute'}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" />
        {#if pb.muted || pb.volume === 0}<path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" stroke-width="1.5" />
        {:else}
          <path d="M11 5.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" stroke-width="1.4" />
          {#if pb.volume > 0.5}<path d="M12.5 3.5a6 6 0 0 1 0 9" fill="none" stroke="currentColor" stroke-width="1.4" />{/if}
        {/if}
      </svg>
    </button>
    <input type="range" min="0" max="1" step="0.05" aria-label="Volume" title="Volume" value={pb.muted ? 0 : pb.volume}
      oninput={(e) => pb.setVolume(Number(e.currentTarget.value))} onchange={(e) => e.currentTarget.blur()} />
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
  .clip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 4px 3px 10px; border-radius: 6px; font-variant-numeric: tabular-nums;
          background: rgba(76, 175, 80, .14); border: 1px solid var(--color-primary); color: var(--color-text-primary); }
  .clear { display: grid; place-items: center; padding: 3px; border: 0; background: none; color: var(--color-text-muted); }
  .clear:hover { color: var(--color-text-primary); }
  .sound { display: inline-flex; align-items: center; gap: 4px; }
  .mute { display: grid; place-items: center; padding: 4px; color: var(--color-text-secondary); }
  .mute:hover, .mute[aria-pressed='true'] { color: var(--color-text-primary); }
  .sound input { width: 72px; }
  .time { font-variant-numeric: tabular-nums; min-width: 128px; }
  .spacer { flex: 1; }
</style>
