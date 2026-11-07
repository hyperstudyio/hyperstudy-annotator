// Drawing at the displayed frame: blend between samples, with optional centred smoothing.
// Stages sample at 6-8 fps. Snapping to the nearest sample made points jump every 125 ms and trail the picture by up
// to half a sample, so drawing blends the two samples around the frame time. Smoothing is centred (each sample
// averaged 1-2-1 with its neighbours), so unlike a live EMA it removes jitter without adding lag.
// Both are display-only: stored and exported data stay raw.
import type { Kpt } from '../types';

export interface Bracket<T> { a: T; b: T; f: number }

/** The two samples around t and how far t is between them; null outside the samples or across a missed detection. */
export function bracket<T extends { t: number }>(samples: T[], t: number, fps: number): Bracket<T> | null {
  const gap = 1 / fps;
  let lo = 0, hi = samples.length - 1;
  if (!samples.length || t < samples[0].t - gap / 2 || t > samples[hi].t + gap / 2) return null;
  if (t <= samples[0].t) return { a: samples[0], b: samples[0], f: 0 };
  if (t >= samples[hi].t) return { a: samples[hi], b: samples[hi], f: 0 };
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (samples[m].t <= t) lo = m; else hi = m; }
  const a = samples[lo], b = samples[hi];
  if (b.t - a.t > 1.5 * gap) {   // a missed detection between them: do not draw a face that was not there
    const n = t - a.t < b.t - t ? a : b;
    return Math.abs(n.t - t) <= gap / 2 ? { a: n, b: n, f: 0 } : null;
  }
  return { a, b, f: (t - a.t) / (b.t - a.t) };
}

export const lerpNums = (A: number[], B: number[], f: number) => (f === 0 ? A : A.map((v, i) => v + f * (B[i] - v)));
export const lerpKpts = (A: Kpt[], B: Kpt[], f: number): Kpt[] =>
  f === 0 ? A : A.map((k, i) => [k[0] + f * (B[i][0] - k[0]), k[1] + f * (B[i][1] - k[1]), Math.min(k[2], B[i][2])]);

/** 1-2-1 over neighbours at most 1.5 sample gaps away. */
export function smoothNums<T extends { t: number }>(samples: T[], get: (x: T) => number[], fps: number): number[][] {
  const gap = 1.5 / fps;
  return samples.map((x, i) => {
    const p = samples[i - 1], n = samples[i + 1], okP = !!p && x.t - p.t <= gap, okN = !!n && n.t - x.t <= gap;
    if (!okP && !okN) return get(x);
    const w = 2 + (okP ? 1 : 0) + (okN ? 1 : 0);
    return get(x).map((v, j) => (2 * v + (okP ? get(p)[j] : 0) + (okN ? get(n)[j] : 0)) / w);
  });
}

/** The same per joint, using only neighbours where that joint is visible. */
export function smoothKpts<T extends { t: number; kpts: Kpt[] }>(samples: T[], fps: number, threshold: number): Kpt[][] {
  const gap = 1.5 / fps;
  return samples.map((x, i) => {
    const p = samples[i - 1], n = samples[i + 1], okP = !!p && x.t - p.t <= gap, okN = !!n && n.t - x.t <= gap;
    return x.kpts.map((k, j): Kpt => {
      let sx = 2 * k[0], sy = 2 * k[1], w = 2;
      if (okP && p.kpts[j][2] >= threshold) { sx += p.kpts[j][0]; sy += p.kpts[j][1]; w++; }
      if (okN && n.kpts[j][2] >= threshold) { sx += n.kpts[j][0]; sy += n.kpts[j][1]; w++; }
      return [sx / w, sy / w, k[2]];
    });
  });
}

// Display smoothing of the pitch contour (data stay raw; the Smooth chip switches it off): voiced runs shorter than
// PITCH_MIN_RUN steps are dropped (isolated blips at 20 Hz are mostly onsets, offsets and laughter), and each run
// gets a centred running median over PITCH_MEDIAN steps, which removes single-step jumps without lagging.
export const PITCH_MIN_RUN = 3, PITCH_MEDIAN = 5;
export function smoothPitch(f0: (number | null)[], speaker: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = new Array(f0.length).fill(null);
  let i = 0;
  while (i < f0.length) {
    if (f0[i] === null || speaker[i] === null) { i++; continue; }
    let j = i;
    while (j < f0.length && f0[j] !== null && speaker[j] === speaker[i]) j++;
    if (j - i >= PITCH_MIN_RUN) for (let k = i; k < j; k++) {
      const half = PITCH_MEDIAN >> 1;
      const win = (f0.slice(Math.max(i, k - half), Math.min(j, k + half + 1)) as number[]).sort((a, b) => a - b);
      out[k] = win[win.length >> 1];
    }
    i = j;
  }
  return out;
}
