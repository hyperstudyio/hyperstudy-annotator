import { expect, test } from 'vitest';
import { MemoryStorage } from './fixture.test-helpers';
import { DEFAULT_STYLE, GROUP_KEYS, MAX_ROW_H, MIN_ROW_H, View, coloursOf, moveTo, ordered } from './view.svelte';

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

test('an overlay\'s style is saved per video, read back, and reset; a view saved before styles reads as the default', () => {
  const storage = new MemoryStorage();
  const v = new View('abc', storage);
  expect(v.styleOf('boxes')).toEqual(DEFAULT_STYLE);
  v.setStyle('boxes', { colour: '#ff00ff' });
  v.setStyle('boxes', { opacity: 0.5 });
  const again = new View('abc', storage);
  expect(again.styleOf('boxes')).toEqual({ colour: '#ff00ff', opacity: 0.5, width: 1 });
  expect(again.styleOf('gaze')).toEqual(DEFAULT_STYLE);
  again.resetStyles();
  expect(new View('abc', storage).styleOf('boxes')).toEqual(DEFAULT_STYLE);
  const old = new MemoryStorage();
  const before = new View('old', old);
  before.hideRow('waveform');
  const saved = JSON.parse(old.getItem(old.key(0)!)!);
  delete saved.styles;   // as a view saved by 0.0.2 has none
  old.setItem(old.key(0)!, JSON.stringify(saved));
  expect(new View('old', old).styleOf('objects')).toEqual(DEFAULT_STYLE);
});

test('chosen colours are kept per run, the layout per video: a re-run of the video starts with its own colours', () => {
  const storage = new MemoryStorage();
  const v = new View('video', storage, 'run-1');
  v.setColour('person:Person A', '#123456');
  v.hideRow('waveform');
  const rerun = new View('video', storage, 'run-2');
  expect(rerun.s.hidden).toEqual(['waveform']);
  expect(rerun.colours).toEqual({});   // its person:Person A may be someone else
  expect(new View('video', storage, 'run-1').colours).toEqual({ 'person:Person A': '#123456' });
  expect(coloursOf('run-1', storage)).toEqual({ 'person:Person A': '#123456' });
  expect(new View('video', storage).colours).toEqual({});   // a bundle without a key: the video's own
});

test('colours carried over from an earlier run are kept, and one already chosen on this run stays', () => {
  const storage = new MemoryStorage();
  const v = new View('video', storage, 'run-2');
  v.setColour('person:Person A', '#aaaaaa');
  v.adoptColours({ 'person:Person A': '#111111', 'person:Person B': '#222222' });
  expect(new View('video', storage, 'run-2').colours).toEqual({ 'person:Person A': '#aaaaaa', 'person:Person B': '#222222' });
});

test('colours saved in the layout by 0.0.6, whose run is not known, are not given to any run', () => {
  const storage = new MemoryStorage();
  storage.setItem('hyperstudy-annotator:view:video', JSON.stringify({ hidden: ['waveform'], colours: { 'person:Person A': '#123456' } }));
  const v = new View('video', storage, 'run-2');
  expect(v.colours).toEqual({});
  expect(v.s.hidden).toEqual(['waveform']);
  expect('colours' in v.s).toBe(false);
});
