// Where a panel goes beside what opened it: under it, or above it when there is more room there (an anchor near the
// foot of the window); never past the window's edges, and what does not fit scrolls inside the panel.

export interface Placement { top: number | null; bottom: number | null; left: number; max: number }

export function placeBy(r: DOMRect, width: number, align: 'left' | 'right' = 'left', win = { w: window.innerWidth, h: window.innerHeight }): Placement {
  const w = Math.min(width, win.w - 16);
  const left = Math.max(8, Math.min(align === 'right' ? r.right - w : r.left, win.w - w - 8));
  const below = win.h - r.bottom - 12, above = r.top - 12;
  return below >= Math.min(320, above) ? { top: r.bottom + 4, bottom: null, left, max: Math.min(480, below) }
    : { top: null, bottom: win.h - r.top + 4, left, max: Math.min(480, above) };
}
