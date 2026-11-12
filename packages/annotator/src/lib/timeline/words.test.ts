import { describe, expect, test } from 'vitest';
import { alignWords, replaceWord, type TimedWord } from './words';

// "As far as recent trends," heard at 0.1 s a word, with a 0.5 s pause before "trends,"
const heard: TimedWord[] = [
  { w: 'As', start: 0, end: 0.1 }, { w: 'far', start: 0.1, end: 0.2 }, { w: 'as', start: 0.2, end: 0.3 },
  { w: 'recent', start: 0.3, end: 0.4 }, { w: 'trends,', start: 0.9, end: 1.0 },
];
const words = (xs: TimedWord[]) => xs.map((x) => x.w);
const at = (xs: TimedWord[], w: string) => xs.find((x) => x.w === w)!;

describe('words where they are spoken', () => {
  test('the text as heard keeps every time', () => {
    expect(alignWords(heard, 'As far as recent trends,')).toEqual(heard);
  });

  test('a word corrected takes the time of the word it replaces; case and punctuation do not count as changes', () => {
    const out = alignWords(heard, 'as far as current trends.');
    expect(words(out)).toEqual(['as', 'far', 'as', 'current', 'trends.']);
    expect(at(out, 'current')).toMatchObject({ start: 0.3, end: 0.4 });
    expect(at(out, 'trends.')).toMatchObject({ start: 0.9, end: 1.0 });
  });

  test('one word made two shares its time, by length', () => {
    const out = alignWords(heard, 'As far as the recent trends,'.replace('the recent', 'very recent'));
    expect(words(out)).toEqual(['As', 'far', 'as', 'very', 'recent', 'trends,']);
    const split = alignWords(heard, 'As far as re cent trends,');
    expect(at(split, 're').start).toBeCloseTo(0.3);
    expect(at(split, 'cent').end).toBeCloseTo(0.4);
    expect(at(split, 're').end).toBeCloseTo(at(split, 'cent').start);
  });

  test('a word added goes into a pause wide enough, else shares the word before it', () => {
    const inPause = alignWords(heard, 'As far as recent fashion trends,');
    expect(at(inPause, 'fashion')).toMatchObject({ start: 0.4, end: 0.9 });
    const tight = alignWords(heard, 'As far as so recent trends,');
    expect(at(tight, 'as').start).toBeCloseTo(0.2);
    expect(at(tight, 'so').end).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(at(tight, 'recent')).toMatchObject({ start: 0.3, end: 0.4 });
  });

  test('a word added before the first shares the first word', () => {
    const out = alignWords(heard, 'So as far as recent trends,');
    expect(words(out)).toEqual(['So', 'as', 'far', 'as', 'recent', 'trends,']);
    expect(out[0].start).toBe(0);
    expect(out[1].end).toBeCloseTo(0.1);
    expect(at(out, 'far')).toMatchObject({ start: 0.1, end: 0.2 });
  });

  test('words deleted are gone, and the rest keep their times; nothing left, nothing shown', () => {
    const out = alignWords(heard, 'As recent trends,');
    expect(words(out)).toEqual(['As', 'recent', 'trends,']);
    expect(at(out, 'recent')).toMatchObject({ start: 0.3, end: 0.4 });
    expect(alignWords(heard, '  ')).toEqual([]);
  });

  test('a rewrite with nothing in common spreads over the whole utterance', () => {
    const out = alignWords(heard, 'completely different words');
    expect(out[0].start).toBe(0);
    expect(out.at(-1)!.end).toBe(1.0);
  });

  test('editing one word of an utterance', () => {
    const t = 'As far as recent trends,';
    expect(replaceWord(t, 3, 'current')).toBe('As far as current trends,');
    expect(replaceWord(t, 3, 'very  recent')).toBe('As far as very recent trends,');
    expect(replaceWord(t, 0, '')).toBe('far as recent trends,');
    expect(replaceWord(t, 4, '')).toBe('As far as recent');
    expect(replaceWord(t, 2, '')).toBe('As far recent trends,');
    expect(replaceWord('one', 0, '')).toBe('');
  });

  test('the rest of the text is left as it was, spacing and all; a word left as it is changes nothing', () => {
    const t = ' Hello  there,\nfriend.';   // a transcriber's leading space, a double space, a line break
    expect(replaceWord(t, 1, 'there,')).toBe(t);
    expect(replaceWord(t, 1, ' there, ')).toBe(t);
    expect(replaceWord(t, 2, 'friends.')).toBe(' Hello  there,\nfriends.');
    expect(replaceWord(t, 0, 'Hi')).toBe(' Hi  there,\nfriend.');
    expect(replaceWord(t, 9, 'x')).toBe(t);   // no such word
  });
});
