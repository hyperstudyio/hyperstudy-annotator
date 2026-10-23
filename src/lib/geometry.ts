/** The sample nearest t, if within maxGap. */
export function nearest<T extends { t: number }>(samples: T[], t: number, maxGap: number): T | null {
  let best: T | null = null, d = Infinity;
  for (const s of samples) { const e = Math.abs(s.t - t); if (e < d) { d = e; best = s; } }
  return d <= maxGap ? best : null;
}

/** Where the video's picture sits inside its element (object-fit: contain letterboxes it). The bundle's own frame size
 *  is used, so boxes in source pixels map correctly before the video's metadata has loaded. */
export function contentRect(video: HTMLVideoElement, vw: number, vh: number) {
  const W = video.clientWidth, H = video.clientHeight;
  const scale = Math.min(W / vw, H / vh);
  return { scale, x: (W - vw * scale) / 2, y: (H - vh * scale) / 2 };
}

export const fmt = (t: number) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
