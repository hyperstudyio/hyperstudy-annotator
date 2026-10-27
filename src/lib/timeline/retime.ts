// Moving an annotation along the timeline, or dragging one of its ends: where it goes for a pointer that has moved by
// dt seconds, and the times its edges snap to (shot cuts, the playhead, other annotations' ends).

import type { Span } from '../types';

export type RetimeMode = 'move' | 'start' | 'end';
export const MIN_LEN_S = 0.1;
/** How near, in pixels, an edge has to come to a time to snap to it. */
export const SNAP_PX = 6;

/** The span after the pointer moved by dt seconds: the whole span (kept inside the video), or one end (never past the
 *  other, less the minimum length; an annotation already shorter than that only gets longer). */
export function retime(mode: RetimeMode, from: Span, dt: number, duration: number): Span {
  const len = from.end - from.start;
  if (mode === 'move') {
    const start = Math.min(Math.max(0, from.start + dt), Math.max(0, duration - len));
    return { start, end: start + len };
  }
  if (mode === 'start') return { start: Math.min(Math.max(0, from.start + dt), Math.max(from.start, from.end - MIN_LEN_S)), end: from.end };
  return { start: from.start, end: Math.max(Math.min(duration, from.end + dt), Math.min(from.end, from.start + MIN_LEN_S)) };
}

/** The nearest of `times` within `tol` seconds of t, else null. */
export function nearest(t: number, times: number[], tol: number): number | null {
  let best: number | null = null;
  for (const x of times) if (Math.abs(x - t) <= tol && (best === null || Math.abs(x - t) < Math.abs(best - t))) best = x;
  return best;
}

/** The span snapped: the end being dragged, or (moving) whichever end is nearer a time, the length kept. `at` is the
 *  time it snapped to, to show; null when nothing was near. */
export function snap(mode: RetimeMode, span: Span, times: number[], tol: number, duration: number): { span: Span; at: number | null } {
  if (mode === 'start') {
    const at = nearest(span.start, times, tol);
    return at === null || at > span.end - MIN_LEN_S ? { span, at: null } : { span: { start: at, end: span.end }, at };
  }
  if (mode === 'end') {
    const at = nearest(span.end, times, tol);
    return at === null || at < span.start + MIN_LEN_S ? { span, at: null } : { span: { start: span.start, end: at }, at };
  }
  const len = span.end - span.start, a = nearest(span.start, times, tol), b = nearest(span.end, times, tol);
  const byStart = a === null ? Infinity : Math.abs(a - span.start), byEnd = b === null ? Infinity : Math.abs(b - span.end);
  if (byStart === Infinity && byEnd === Infinity) return { span, at: null };
  const start = byStart <= byEnd ? a! : b! - len;
  if (start < 0 || start + len > duration) return { span, at: null };
  return { span: { start, end: start + len }, at: byStart <= byEnd ? a : b };
}

/** Which part of a bar the pointer took: an end within the handle width (a third of a narrow bar), else the middle. */
export function partAt(x: number, width: number, handle = 6): RetimeMode {
  const h = Math.min(handle, width / 3);
  return x <= h ? 'start' : x >= width - h ? 'end' : 'move';
}
