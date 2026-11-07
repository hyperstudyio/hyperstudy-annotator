import { expect, test } from 'vitest';
import { MIN_LEN_S, partAt, retime, snap } from './retime';

const span = { start: 10, end: 14 };

test('moving keeps the length and stays inside the video', () => {
  expect(retime('move', span, 3, 60)).toEqual({ start: 13, end: 17 });
  expect(retime('move', span, -20, 60)).toEqual({ start: 0, end: 4 });
  expect(retime('move', span, 100, 60)).toEqual({ start: 56, end: 60 });
});

test('an end moves alone and never crosses the other', () => {
  expect(retime('start', span, -2, 60)).toEqual({ start: 8, end: 14 });
  expect(retime('start', span, 9, 60)).toEqual({ start: 14 - MIN_LEN_S, end: 14 });
  expect(retime('end', span, 1.5, 60)).toEqual({ start: 10, end: 15.5 });
  expect(retime('end', span, -9, 60)).toEqual({ start: 10, end: 10 + MIN_LEN_S });
  expect(retime('end', span, 99, 60)).toEqual({ start: 10, end: 60 });
});

test('the dragged end snaps to a near time, and moving snaps whichever end is nearer, keeping the length', () => {
  expect(snap('start', { start: 9.9, end: 14 }, [9.8, 12], 0.2, 60)).toEqual({ span: { start: 9.8, end: 14 }, at: 9.8 });
  expect(snap('end', { start: 10, end: 14 }, [9.8], 0.2, 60)).toEqual({ span: { start: 10, end: 14 }, at: null });
  const moved = snap('move', { start: 10.1, end: 14.1 }, [9.95, 14.15], 0.2, 60);   // the end is nearer its time
  expect(moved.at).toBe(14.15);
  expect(moved.span.start).toBeCloseTo(10.15);
  expect(moved.span.end).toBe(14.15);
  expect(snap('end', { start: 10, end: 10.15 }, [10.05], 0.2, 60).at).toBeNull();   // would make it shorter than the minimum
});

test('a bar is taken by an end near its edges, by its middle elsewhere, and narrow bars keep a middle', () => {
  expect(partAt(2, 80)).toBe('start');
  expect(partAt(77, 80)).toBe('end');
  expect(partAt(40, 80)).toBe('move');
  expect(partAt(4.5, 9)).toBe('move');
  expect(partAt(1, 9)).toBe('start');
});

test('an end of an annotation already shorter than the minimum never moves against the pointer', () => {
  const dot = { start: 5, end: 5 };   // ] while paused, or Start = playhead at its end
  expect(retime('end', dot, -1, 60)).toEqual(dot);
  expect(retime('start', dot, 1, 60)).toEqual(dot);
  expect(retime('end', dot, 0.5, 60)).toEqual({ start: 5, end: 5.5 });
  expect(retime('start', dot, -0.5, 60)).toEqual({ start: 4.5, end: 5 });
});
