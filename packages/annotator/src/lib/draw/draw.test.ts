import { expect, test } from 'vitest';
import { bracket, lerpKpts, smoothKpts, smoothNums, smoothPitch } from './smooth';
import { affectY, columnPeak, lerpHex, pitchY, PITCH_ST } from './plots';
import { faceBoxAt, handThreshold, insidePoly } from './overlay';
import { face } from '../model/fixture.test-helpers';
import type { HandsLayer } from '../types';

const s = (t: number, v = t) => ({ t, v: [v] });

test('drawing blends the two samples around the frame, and does not bridge a missed detection', () => {
  const samples = [s(0), s(0.125), s(0.25), s(1.0)];
  expect(bracket(samples, 0.1875, 8)).toEqual({ a: samples[1], b: samples[2], f: 0.5 });
  expect(bracket(samples, 0.6, 8)).toBeNull();                             // between 0.25 and 1.0: nothing was seen
  expect(bracket(samples, 0.3, 8)).toEqual({ a: samples[2], b: samples[2], f: 0 });   // within half a gap of a sample
  expect(bracket(samples, -0.1, 8)).toBeNull();
});

test('centred 1-2-1 smoothing uses only near neighbours, and keypoints only visible ones', () => {
  const xs = [s(0, 0), s(0.125, 4), s(0.25, 0), s(2, 8)];
  expect(smoothNums(xs, (x) => x.v, 8).map((v) => v[0])).toEqual([(0 * 2 + 4) / 3, (4 * 2 + 0 + 0) / 4, (0 * 2 + 4) / 3, 8]);
  const k = (t: number, x: number, score: number) => ({ t, kpts: [[x, 0, score]] as [number, number, number][] });
  expect(smoothKpts([k(0, 0, 1), k(0.125, 4, 1), k(0.25, 100, 0)], 8, 0.5)[1][0][0]).toBe((4 * 2 + 0) / 3);
  expect(lerpKpts([[0, 0, 0.9]], [[10, 10, 0.2]], 0.5)).toEqual([[5, 5, 0.2]]);   // a blended joint is as sure as the less sure end
});

test('pitch smoothing drops voiced runs under 3 steps and median-filters the rest per speaker', () => {
  const f0 = [1, null, 5, 5, 50, 5, 5, null, 2, 2];
  const spk = [0, null, 0, 0, 0, 0, 0, null, 1, 1];
  expect(smoothPitch(f0, spk)).toEqual([null, null, 5, 5, 5, 5, 5, null, null, null]);
});

test('plot rows map values into the row', () => {
  expect(pitchY(0, 48)).toBe(24);
  expect(pitchY(PITCH_ST * 3, 48)).toBe(pitchY(PITCH_ST, 48));   // clamped
  expect(affectY(0.2, [0.2, 0.6], 56)).toBe(53);
  expect(affectY(0.6, [0.2, 0.6], 56)).toBe(3);
  expect(affectY(0.5, [0.5, 0.5], 56)).toBe(28);                 // a flat line sits in the middle
  expect(columnPeak([10, 90, 20, 0], 4, 2, 0)).toBe(90);          // 2 px/s, 4 bins/s: two bins per pixel
  expect(lerpHex('#000000', '#ff8000', 0.5)).toBe('#804000');
});

test('a face box is interpolated inside its track and held half a sample past its ends', () => {
  const f = face(1, null, 0, 1, 2, 0);
  f.samples[1].box = [8, 0, 100, 100];
  expect(faceBoxAt(f, 1.0625, 8)![0]).toBe(4);
  expect(faceBoxAt(f, 2.05, 8)).not.toBeNull();
  expect(faceBoxAt(f, 2.07, 8)).toBeNull();
});

test('hands use the layer threshold, else the hand bake-off\'s per model', () => {
  const layer = (score_threshold: number | null, id: string) => ({ score_threshold, producer: { models: [{ id }] } }) as unknown as HandsLayer;
  expect(handThreshold(layer(0.7, 'rtmw'))).toBe(0.7);
  expect(handThreshold(layer(null, 'rtmw'))).toBe(5);
  expect(handThreshold(layer(null, 'rtmpose_hand'))).toBe(0.3);
});

test('a click inside an object outline hits it', () => {
  const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  expect(insidePoly(5, 5, sq)).toBe(true);
  expect(insidePoly(15, 5, sq)).toBe(false);
});
