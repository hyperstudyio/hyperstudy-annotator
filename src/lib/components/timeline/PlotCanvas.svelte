<script lang="ts">
  // A plot row (waveform, pitch, affect lines), drawn for the visible stretch of the timeline only.
  import { useSession } from '../../model/context';
  import { drawAffect, drawPitch, drawWaveform } from '../../draw/plots';
  import { smoothPitch } from '../../draw/smooth';
  import { prosodySpeakerColour } from '../../timeline/rows';
  import type { Plot } from '../../timeline/rows';

  let { plot, height, x0, width, pps }: { plot: Plot; height: number; x0: number; width: number; pps: number } = $props();
  const s = useSession();
  let canvas = $state<HTMLCanvasElement>();
  const P = $derived(s.bundle.layers.prosody);
  const pitchSmoothed = $derived(P ? smoothPitch(P.contour.f0_st, P.contour.speaker) : null);   // display only; data stay raw
  const H = $derived(Math.max(1, height - 2));
  const selectedUtt = $derived(s.selection?.kind === 'utt' ? s.selection.id : null);

  $effect(() => {
    if (!canvas || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(H * dpr);
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, H);
    const v = { x0, W: width, H, pps };
    if (plot.kind === 'waveform') {
      const w = s.bundle.layers.waveform;
      if (w) drawWaveform(g, v, w.peaks, w.hz, '#5c8fbf');
    } else if (plot.kind === 'pitch' && P) {
      const names = P.contour.speakers, colours = names.map((n) => prosodySpeakerColour(s, n));
      drawPitch(g, v, { t0: P.contour.t0, step: P.contour.step, speaker: P.contour.speaker,
        f0: s.view.s.layers.smooth && pitchSmoothed ? pitchSmoothed : P.contour.f0_st }, (i) => colours[i]);
    } else if (plot.kind === 'affect') {
      drawAffect(g, v, plot.points, plot.ranges, selectedUtt);
    }
  });
</script>

<canvas bind:this={canvas} style="left:{x0}px; width:{width}px; height:{H}px" aria-hidden="true"></canvas>

<style>
  canvas { position: absolute; top: 0; pointer-events: none; }
</style>
