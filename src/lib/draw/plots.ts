// The timeline's plot rows: the waveform, the pitch contour and the affect lines. Each draws the visible stretch of
// the timeline into a canvas the width of the viewport (a canvas of the whole zoomed timeline would pass the
// browser's size limit), so `x0` is the content x (px) at the canvas's left edge.
import type { Span } from '../types';

export interface PlotView { x0: number; W: number; H: number; pps: number }

/** The loudest peak in the bins that fall under one pixel column (peaks are 0-100 at `hz` bins per second). */
export function columnPeak(peaks: number[], hz: number, pps: number, x: number): number {
  const i0 = Math.floor((x / pps) * hz), i1 = Math.max(i0 + 1, Math.floor(((x + 1) / pps) * hz));
  let m = 0;
  for (let i = Math.max(0, i0); i < i1 && i < peaks.length; i++) m = Math.max(m, peaks[i]);
  return m;
}

export function drawWaveform(g: CanvasRenderingContext2D, v: PlotView, peaks: number[], hz: number, colour: string) {
  g.fillStyle = colour;
  for (let x = 0; x < v.W; x++) {
    const h = (columnPeak(peaks, hz, v.pps, v.x0 + x) / 100) * (v.H - 4);
    g.fillRect(x, (v.H - h) / 2, 1, Math.max(1, h));
  }
}

export const PITCH_ST = 12;   // the pitch row spans ±12 semitones around each speaker's median
/** y of a pitch in semitones from the speaker's median, clamped to the row. */
export const pitchY = (st: number, H: number) => H / 2 - (Math.max(-PITCH_ST, Math.min(PITCH_ST, st)) / PITCH_ST) * (H / 2 - 2);

export interface Contour { t0: number; step: number; f0: (number | null)[]; speaker: (number | null)[] }

export function drawPitch(g: CanvasRenderingContext2D, v: PlotView, c: Contour, colourOf: (speaker: number) => string) {
  g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, v.H / 2); g.lineTo(v.W, v.H / 2); g.stroke();   // the speaker's median
  g.lineWidth = 1.5;
  const first = Math.max(0, Math.floor((v.x0 / v.pps - c.t0) / c.step) - 1);
  const last = Math.min(c.f0.length - 1, Math.ceil(((v.x0 + v.W) / v.pps - c.t0) / c.step) + 1);
  let prev: { x: number; y: number; spk: number } | null = null;
  for (let i = first; i <= last; i++) {
    const st = c.f0[i], spk = c.speaker[i];
    if (st === null || spk === null) { prev = null; continue; }
    const x = (c.t0 + i * c.step) * v.pps - v.x0, y = pitchY(st, v.H), col = colourOf(spk);
    if (prev && prev.spk === spk) { g.strokeStyle = col; g.beginPath(); g.moveTo(prev.x, prev.y); g.lineTo(x, y); g.stroke(); }
    else { g.fillStyle = col; g.fillRect(x - 0.75, y - 0.75, 1.5, 1.5); }
    prev = { x, y, spk };
  }
}

/** The smallest and largest value; [0, 0] for none. */
export function rangeOf(values: number[]): [number, number] {
  return values.length ? [Math.min(...values), Math.max(...values)] : [0, 0];
}
/** y of an affect value in a line that spans its own clip range (models differ in scale and spread). */
export const affectY = (v: number, [lo, hi]: [number, number], H: number) => H - 3 - (hi > lo ? (v - lo) / (hi - lo) : 0.5) * (H - 6);

export const AFFECT_COLOURS = { arousal: '#ff8a3d', valence: '#6fa8ff' } as const;
export type AffectDim = keyof typeof AFFECT_COLOURS;
export interface AffectPoint extends Span { id: string; arousal: number; valence: number }

// Arousal and valence as lines: each utterance is a flat segment at its value, joined to the next by a thin line, so
// changes between sentences read as rises and falls.
export function drawAffect(g: CanvasRenderingContext2D, v: PlotView, points: AffectPoint[], ranges: Record<AffectDim, [number, number]>, selected: string | null) {
  g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, v.H / 2); g.lineTo(v.W, v.H / 2); g.stroke();
  for (const dim of ['valence', 'arousal'] as const) {
    g.strokeStyle = AFFECT_COLOURS[dim];
    let prev: { x: number; y: number } | null = null;
    for (const p of points) {
      const y = affectY(p[dim], ranges[dim], v.H), x0 = p.start * v.pps - v.x0, x1 = Math.max(x0 + 2, p.end * v.pps - v.x0);
      if (prev) { g.globalAlpha = 0.35; g.lineWidth = 1; g.beginPath(); g.moveTo(prev.x, prev.y); g.lineTo(x0, y); g.stroke(); }
      const sel = p.id === selected;
      g.globalAlpha = sel ? 1 : 0.9; g.lineWidth = sel ? 4 : 2.5;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
      prev = { x: x1, y };
    }
  }
  g.globalAlpha = 1;
}

/** Linear blend of two #rrggbb colours. */
export const lerpHex = (a: string, b: string, f: number) => '#' + [0, 2, 4].map((i) =>
  Math.round(parseInt(a.slice(1 + i, 3 + i), 16) * (1 - f) + parseInt(b.slice(1 + i, 3 + i), 16) * f).toString(16).padStart(2, '0')).join('');
