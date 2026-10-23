// The timeline's time scale: pixels per second, and the time under a pointer.

export const LABEL_W = 168;   // the sticky label column, px
export const ZOOM_MAX = 12;

/** Pixels per second at zoom 1: the whole video fits the scroller (less the label column and a margin). The width
 *  must be the scroller's own, which must not depend on what the timeline holds (see Viewer's grid). */
export const fitPps = (scrollerWidth: number, duration: number) => Math.max(4, (scrollerWidth - LABEL_W - 24) / Math.max(duration, 1));

/** The time under clientX, given where the timeline content starts on screen (its left edge, scroll included). */
export const timeAtX = (clientX: number, contentLeft: number, pps: number, duration: number) =>
  Math.min(duration, Math.max(0, (clientX - contentLeft - LABEL_W) / pps));

/** Ruler tick spacing, s, for a scale. */
export const tickStep = (pps: number) => (pps > 30 ? 2 : pps > 12 ? 5 : pps > 6 ? 10 : 20);

/** After zooming, the scrollLeft that keeps the moment that was under the pointer under it. */
export const scrollToKeep = (t: number, pointerX: number, pps: number) => Math.max(0, t * pps - pointerX);
