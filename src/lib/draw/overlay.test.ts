import { expect, test } from 'vitest';
import { drawOverlay, Smoothed } from './overlay';
import { MemoryStorage, makeBundle } from '../model/fixture.test-helpers';
import { Session } from '../model/session.svelte';
import { View, defaultView, type OverlayKey, type OverlayStyle } from '../model/view.svelte';
import { LocalCorrectionStore } from '../source';

/** A canvas that records each face box drawn: its colour, width and opacity at the moment it was stroked. */
function recorder() {
  const boxes: { colour: string; width: number; alpha: number }[] = [];
  const stack: Record<string, unknown>[] = [];
  const g: Record<string, unknown> = {
    strokeStyle: '', fillStyle: '', lineWidth: 1, globalAlpha: 1, font: '',
    save() { stack.push({ strokeStyle: g.strokeStyle, fillStyle: g.fillStyle, lineWidth: g.lineWidth, globalAlpha: g.globalAlpha }); },
    restore() { Object.assign(g, stack.pop()); },
    strokeRect() { boxes.push({ colour: g.strokeStyle as string, width: g.lineWidth as number, alpha: g.globalAlpha as number }); },
    measureText: () => ({ width: 10 }),
  };
  for (const f of ['setLineDash', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'stroke', 'fill', 'fillRect', 'fillText', 'arc']) g[f] = () => {};
  return { g: g as unknown as CanvasRenderingContext2D, boxes };
}

function draw(styles: Partial<Record<OverlayKey, OverlayStyle>>) {
  const b = makeBundle();
  const s = new Session(b, new LocalCorrectionStore(b.sha256, new MemoryStorage()), new View(b.sha256, new MemoryStorage()));
  const { g, boxes } = recorder();
  drawOverlay(g, { s, t: 1, m: { scale: 1, ox: 0, oy: 0 }, layers: defaultView().layers, styles, gazeSource: 'pyfeat', detail: null, sm: new Smoothed() });
  return { s, boxes };
}

test('face boxes are drawn in each person\'s colour, unless a colour, opacity and width are chosen for them', () => {
  const plain = draw({});
  expect(plain.boxes.map((x) => x.colour)).toEqual([plain.s.colourOf('person:Person A'), plain.s.colourOf('person:Person B')]);
  expect(plain.boxes.every((x) => x.width === 2 && x.alpha === 1)).toBe(true);
  const styled = draw({ boxes: { colour: '#ff00ff', opacity: 0.5, width: 2.5 } });
  expect(styled.boxes).toEqual([{ colour: '#ff00ff', width: 5, alpha: 0.5 }, { colour: '#ff00ff', width: 5, alpha: 0.5 }]);
});
