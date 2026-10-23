<script lang="ts">
  // The video with the overlay canvas. Drawn at the media time of the frame on screen (Playback.time), so boxes
  // never lag the picture. A click on a face or an object selects it; anywhere else plays or pauses.
  import { useSession } from '../model/context';
  import { contentRect } from '../geometry';
  import { Smoothed, drawOverlay, hitTest } from '../draw/overlay';

  let { src }: { src: string | null } = $props();
  const s = useSession();
  let video = $state<HTMLVideoElement>();
  let canvas = $state<HTMLCanvasElement>();
  let w = $state(0), h = $state(0);
  const sm = new Smoothed();

  $effect(() => { if (video) s.playback.attach(video); });

  $effect(() => {
    if (!canvas || !video || !w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const { scale, x, y } = contentRect(video, s.bundle.width, s.bundle.height);
    drawOverlay(g, { s, t: s.playback.time, m: { scale, ox: x, oy: y }, layers: s.view.s.layers, gazeSource: s.bundle.layers.gaze ? s.view.s.gazeSource : 'pyfeat', detail: s.detail, sm });
  });

  function onclick(e: MouseEvent) {
    if (!video || !canvas) return;
    const r = canvas.getBoundingClientRect(), { scale, x, y } = contentRect(video, s.bundle.width, s.bundle.height);
    const px = (e.clientX - r.left - x) / scale, py = (e.clientY - r.top - y) / scale;
    const hit = hitTest(s, s.playback.time, px, py, scale, s.view.s.layers.objects);
    if (hit) { video.pause(); s.select(hit.kind, hit.id, { seek: false }); }
    else s.playback.toggle();
  }
</script>

<div class="video-wrap" bind:clientWidth={w} bind:clientHeight={h}>
  {#if src}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} {src} preload="auto" playsinline></video>
    <!-- the video's own controls are the keys (Space, arrows); a click here selects what is under it -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <canvas bind:this={canvas} style="width:{w}px; height:{h}px" aria-label="Video overlay: click a face or an object to select it" {onclick}></canvas>
  {:else}
    <div class="missing">No video located for this bundle yet.</div>
  {/if}
</div>

<style>
  .video-wrap { position: relative; flex: 1; min-height: 200px; background: #000; border-radius: 8px; overflow: hidden; }
  video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  canvas { position: absolute; inset: 0; cursor: pointer; }
  .missing { position: absolute; inset: 0; display: grid; place-items: center; color: var(--color-text-muted); }
</style>
