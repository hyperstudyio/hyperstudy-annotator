import { describe, expect, test } from 'vitest';
import { arrange, buildGroups, captionTags, rowHeight, shownDims, speakerForDrop, stack, ROW_H } from './rows';
import { fitPps, scrollToKeep, tickStep, timeAtX, LABEL_W } from './scale';
import { Session } from '../model/session.svelte';
import { View, defaultView } from '../model/view.svelte';
import { LocalCorrectionStore } from '../source';
import { MemoryStorage, makeBundle } from '../model/fixture.test-helpers';
import type { ProsodyLayer } from '../types';

const producer = { stage: 't', stage_version: '0', models: [], config: {}, device: null, run_at: null, timings: {} };
const prosody: ProsodyLayer = {
  layer: 'prosody', schema_version: '0.1.0', producer,
  contour: { step: 0.05, t0: 0, speakers: ['Person A'], f0_st: [], speaker: [] },
  default_dimensional: 'dimensional_odyssey',
  emotion_models: {
    dimensional: { model: 'audeering/x', licence_mode: 'academic-only', kind: 'dimensional' },
    dimensional_odyssey: { model: '3loi/SER-Odyssey', licence_mode: 'needs-review', kind: 'dimensional' },
    categorical: { model: 'emotion2vec/plus', licence_mode: 'needs-review', kind: 'categorical' },
  },
  caption_models: { gpt: { model: 'gpt-audio', licence_mode: 'commercial-ok' } },
  utterances: [
    { utt: 'utt:0', speaker: 'Person A', speaker_source: 'asd', measures: { final_movement: 'rise', final_delta_st: 3.1 }, words: [],
      emotion: { dimensional_odyssey: { arousal: 0.2, valence: 0.5, dominance: 0.5 } }, captions: { gpt: { description: 'calm', tags: ['clear', 'calm', 'slow'] } } },
    { utt: 'utt:1', speaker: 'off-screen SPEAKER_00', speaker_source: 'diar', measures: { final_movement: 'fall', final_delta_st: -1.5 }, words: [],
      emotion: { dimensional_odyssey: { arousal: 0.6, valence: 0.1, dominance: 0.5 } }, captions: {} },
  ],
};

function session(withProsody = false) {
  const b = makeBundle(withProsody ? { prosody } : {}), storage = new MemoryStorage();
  return new Session(b, new LocalCorrectionStore(b.sha256, storage), new View(b.sha256, storage));
}
const group = (s: Session, key: string) => buildGroups(s).find((g) => g.key === key)!;
const row = (s: Session, key: string, id: string) => group(s, key).rows.find((r) => r.id === id)!;

describe('people rows', () => {
  test('a person row holds their face tracks and their speech; the words stay in the transcript row', () => {
    const s = session();
    const a = row(s, 'people', 'person:Person A');
    expect(a.bars.filter((x) => x.flags.includes('vis')).map((x) => x.key)).toEqual(['face:0', 'face:2']);
    const speech = a.bars.filter((x) => x.flags.includes('speech'));
    expect(speech.map((x) => x.key)).toEqual(['utt:0']);
    expect(speech[0].text).toBeUndefined();
    expect(row(s, 'audio', 'transcript').bars[0].text).toBe('utterance 0');
  });

  test('off-screen speech goes to its voice\'s row, flagged when the speaker model is unsure', () => {
    const s = session();
    expect(row(s, 'people', 'voice:SPEAKER_01').bars.map((x) => x.key)).toEqual(['utt:2']);
    const v0 = row(s, 'people', 'voice:SPEAKER_00').bars;
    expect(v0.map((x) => x.key)).toEqual(['utt:3']);
    expect(v0[0].flags).toContain('flagged');
  });

  test('speech moves rows when its speaker is corrected, and loses its flag', async () => {
    const s = session();
    await s.commit({ op: 'utterance.speaker', utt: 'utt:3', speaker: { kind: 'person', person: 'person:Person B' } });
    const b = row(s, 'people', 'person:Person B').bars.find((x) => x.key === 'utt:3')!;
    expect(b.flags).not.toContain('flagged');
    expect(row(s, 'people', 'voice:SPEAKER_00')).toBeUndefined();
  });

  test('a drop on a row means that row\'s speaker', () => {
    const s = session(), u = s.bundle.utt.get('utt:0')!;
    expect(speakerForDrop(s, u, { person: 'person:Person B' })).toEqual({ kind: 'face', face: 'face:1' });
    expect(speakerForDrop(s, u, { voice: 'voice:SPEAKER_01' })).toEqual({ kind: 'offscreen', voice: 'voice:SPEAKER_01' });
    expect(speakerForDrop(s, u, { other: true })).toEqual({ kind: 'unsure' });
  });
});

describe('prosody rows', () => {
  test('only endings of at least 2 semitones are drawn, coloured by the speaker', () => {
    const s = session(true);
    const ending = row(s, 'prosody', 'prosody:ending');
    expect(ending.bars.map((x) => [x.key, x.text])).toEqual([['utt:0', '↗ +3.1']]);
    expect(ending.bars[0].colour).toBe(s.colourOf('person:Person A'));
  });

  test('arousal and valence are drawn for the default dimensional model only, each over its own clip range', () => {
    const s = session(true);
    expect(shownDims(s).map(([k]) => k)).toEqual(['dimensional_odyssey']);
    const affect = buildGroups(s).find((g) => g.key === 'prosody')!.rows.filter((r) => r.plot?.kind === 'affect');
    expect(affect.map((r) => r.id)).toEqual(['prosody:dimensional_odyssey']);
    const plot = affect[0].plot as Extract<NonNullable<typeof affect[0]['plot']>, { kind: 'affect' }>;
    expect(plot.ranges).toEqual({ arousal: [0.2, 0.6], valence: [0.1, 0.5] });
  });

  test('delivery captions show their informative tags; a captioner that only describes is read through the tagger', () => {
    const s = session(true);
    expect(row(s, 'prosody', 'prosody:caption:gpt').bars[0].text).toBe('calm, slow');
    expect(captionTags({ description: 'x', tags_from_text: ['breathy'] })).toEqual(['breathy']);
  });
});

test('overlapping items stack into sub-rows, and a row grows with them', () => {
  const spans = [{ start: 0, end: 5 }, { start: 1, end: 2 }, { start: 3, end: 6 }, { start: 5, end: 7 }];
  expect(stack(spans)).toEqual([0, 1, 1, 0]);
  expect(rowHeight({ id: 'x', label: { kind: 'text', text: '' }, bars: [{ key: 'a', start: 0, end: 1, row: 2, flags: [] }] }, {})).toBe(3 * ROW_H + 2);
  expect(rowHeight({ id: 'x', label: { kind: 'text', text: '' }, bars: [], height: 30 }, { x: 80 })).toBe(80);
});

test('the viewer\'s layout hides and orders groups and rows', () => {
  const s = session();
  const v = { ...defaultView(), hiddenGroups: ['sounds'], groupOrder: ['people', 'audio'], hidden: ['person:Person B'], rowOrder: { people: ['other'] } };
  const out = arrange(buildGroups(s), v);
  expect(out.map((g) => g.group.key)).toEqual(['people', 'audio', 'objects', 'annotations']);
  const people = out[0];
  expect(people.rows[0].id).toBe('other');
  expect(people.rows.map((r) => r.id)).not.toContain('person:Person B');
  expect(people.hiddenHere).toEqual(['person:Person B']);
});

test('the time scale: fitted to the scroller, the time under the pointer, zoom about the pointer', () => {
  expect(fitPps(LABEL_W + 24 + 1000, 100)).toBe(10);
  expect(fitPps(100, 100)).toBe(4);                               // never below 4 px/s
  expect(timeAtX(LABEL_W + 50 + 120, 50, 10, 100)).toBe(12);      // content starts 50 px into the window
  expect(timeAtX(0, 50, 10, 100)).toBe(0);
  expect(scrollToKeep(12, 300, 40)).toBe(180);                    // 12 s stays 300 px from the label column
  expect([tickStep(40), tickStep(20), tickStep(8), tickStep(5)]).toEqual([2, 5, 10, 20]);
});
