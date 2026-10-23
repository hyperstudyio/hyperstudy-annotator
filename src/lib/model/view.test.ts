import { expect, test } from 'vitest';
import { MemoryStorage } from './fixture.test-helpers';
import { GROUP_KEYS, MAX_ROW_H, MIN_ROW_H, View, moveTo, ordered } from './view.svelte';

test('moving an item lands it before the item that was at the drop index', () => {
  expect(moveTo(['a', 'b', 'c', 'd'], 'a', 3)).toEqual(['b', 'c', 'a', 'd']);
  expect(moveTo(['a', 'b', 'c', 'd'], 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
  expect(moveTo(['a', 'b', 'c'], 'b', 3)).toEqual(['a', 'c', 'b']);
  expect(moveTo(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'b', 'c']);
});

test('rows the viewer never moved keep their own order, after the ones they placed', () => {
  expect(ordered(['w', 'x', 'y', 'z'], (s) => s, ['z', 'x'])).toEqual(['z', 'x', 'w', 'y']);
});

test('the layout is saved per video and read back, and heights stay in bounds', () => {
  const storage = new MemoryStorage();
  const v = new View('abc', storage);
  v.hideRow('person:Person A');
  v.setHeight('waveform', 9999);
  v.setHeight('transcript', 1);
  v.moveGroup(['audio', 'people', 'sounds'], 'sounds', 0);
  v.setGroupShown('text', false);
  const again = new View('abc', storage);
  expect(again.s.hidden).toEqual(['person:Person A']);
  expect(again.s.heights).toEqual({ waveform: MAX_ROW_H, transcript: MIN_ROW_H });
  expect(again.s.groupOrder.slice(0, 3)).toEqual(['sounds', 'audio', 'people']);
  expect(again.s.groupOrder).toHaveLength(GROUP_KEYS.length);   // hidden groups keep a place
  expect(again.s.hiddenGroups).toEqual(['text']);
  expect(new View('other', storage).s.hidden).toEqual([]);
});
