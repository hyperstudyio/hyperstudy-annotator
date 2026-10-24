import { describe, expect, test } from 'vitest';
import { carryOver, describe as describeOp } from './carryover';
import { fold, type Op } from './corrections';
import { face, makeBundle, utt } from './fixture.test-helpers';
import type { FacesLayer, FaceTrack, TranscriptLayer } from '../types';

const old = makeBundle();
const producer = { stage: 't', stage_version: '0', models: [], config: {}, device: null, run_at: null, timings: {} };

/** A re-run of the same video: every id renumbered, the clusters relabelled, utterances a little later, and the
 *  unassigned face (face:3) not detected at all. Old A is new "Person B", old B new "Person A", old C new "Person D". */
function rerun(tracks?: FaceTrack[]) {
  tracks ??= [
    face(10, 'person:Person B', 0, 0, 4), face(11, 'person:Person A', 0, 0, 4, 500), face(12, 'person:Person B', 1, 10, 14),
    face(14, 'person:Person D', 1, 15, 18),
  ];
  const people = [...new Set(tracks.map((t) => t.person!))].map((id) => ({ id, first_seen: 0, seconds_on_screen: 1, crop: null, shots: [] }));
  const faces: FacesLayer = { layer: 'faces', schema_version: '0.1.0', producer, sample_fps: 8, detail: null, tracks, people, person_pairs: [] };
  const transcript: TranscriptLayer = { layer: 'transcript', schema_version: '0.1.0', producer,
    voices: [{ id: 'voice:SPEAKER_02' }, { id: 'voice:SPEAKER_03' }],
    utterances: [utt(10, 0.55, 2.05, 10, 'voice:SPEAKER_02'), utt(11, 2.55, 3.55, 10, 'voice:SPEAKER_02'),
      utt(12, 10.55, 11.55, 11, 'voice:SPEAKER_03'), utt(13, 16.05, 17.05, 11, 'voice:SPEAKER_02')] };
  const shots = { layer: 'shots', schema_version: '0.1.0', producer, shots: [
    { id: 'shot:10', index: 0, start: 0, end: 10, caption: null }, { id: 'shot:11', index: 1, start: 10, end: 20, caption: null }] };
  return makeBundle({ faces, transcript, shots, speakers: null });
}

describe('carryOver', () => {
  test('faces, people, utterances, shots and voices are found under the re-run’s ids', () => {
    const ops: Op[] = [
      { op: 'person.rename', person: 'person:Person C', name: 'Carol' },
      { op: 'track.assign', track: 'face:2', person: 'person:Person B' },
      { op: 'utterance.speaker', utt: 'utt:1', speaker: { kind: 'face', face: 'face:1' } },
      { op: 'shot.caption', shot: 'shot:1', caption: 'the kitchen' },
      { op: 'voice.rename', voice: 'voice:SPEAKER_01', name: 'Narrator' },
      { op: 'person.merge', from: 'person:Person C', into: 'person:Person A' },
    ];
    const { ops: carried, unmatched } = carryOver(ops, old, rerun(), 'v1');
    expect(unmatched).toEqual([]);
    expect(carried.map(({ carried_from, ...op }) => op)).toEqual([
      { op: 'person.rename', person: 'person:Person D', name: 'Carol' },
      { op: 'track.assign', track: 'face:12', person: 'person:Person A' },
      { op: 'utterance.speaker', utt: 'utt:11', speaker: { kind: 'face', face: 'face:11' } },
      { op: 'shot.caption', shot: 'shot:11', caption: 'the kitchen' },
      { op: 'voice.rename', voice: 'voice:SPEAKER_03', name: 'Narrator' },
      { op: 'person.merge', from: 'person:Person D', into: 'person:Person B' },
    ]);
  });

  test('an op whose face is not in the re-run is listed for review with why and when, not dropped', () => {
    const ops: Op[] = [{ op: 'entity.include', id: 'face:3', included: false }];
    const { ops: carried, unmatched } = carryOver(ops, old, rerun(), 'v1');
    expect(carried).toEqual([]);
    expect(unmatched).toEqual([{ index: 0, op: ops[0], reason: '3 has no counterpart in the new version', span: old.face.get('face:3') }]);
  });

  test('the user’s own people, types, categories and notes come along, with machine people in notes re-anchored', () => {
    const note = { id: 'note:1', type: 't1', start: 1, end: 2, value: true, person: 'person:Person A' };
    const ops: Op[] = [
      { op: 'person.create', person: 'person:New 1', name: 'Dana' },
      { op: 'track.assign', track: 'face:0', person: 'person:New 1' },
      { op: 'annotation.type', type: { id: 't1', name: 'smiles', kind: 'binary', target: 'person', options: [] } },
      { op: 'annotation.add', note },
      { op: 'category.include', kind: 'sound', label: 'music', included: false },
    ];
    const { ops: carried, unmatched } = carryOver(ops, old, rerun(), 'v1');
    expect(unmatched).toEqual([]);
    expect(carried[1]).toMatchObject({ op: 'track.assign', track: 'face:10', person: 'person:New 1' });
    expect(carried[3]).toMatchObject({ op: 'annotation.add', note: { ...note, person: 'person:Person B' } });
    expect(fold(carried).names['person:New 1']).toBe('Dana');
  });

  test('a person the re-run splits in two is not guessed', () => {
    const split = rerun([
      face(10, 'person:Person X', 0, 0, 4), face(11, 'person:Person A', 0, 0, 4, 500), face(12, 'person:Person Y', 1, 10, 14),
      face(14, 'person:Person D', 1, 15, 18),
    ]);
    const { unmatched } = carryOver([{ op: 'person.rename', person: 'person:Person A', name: 'Ann' }], old, split, 'v1');
    expect(unmatched.map((u) => u.reason)).toEqual(['Person A is split between Person X and Person Y in the new version']);
  });

  test('two people the re-run puts together: the one with less screen time is listed, and “different people” cannot be carried', () => {
    const together = rerun([
      face(10, 'person:Person A', 0, 0, 4), face(11, 'person:Person B', 0, 0, 4, 500), face(12, 'person:Person A', 1, 10, 14),
      face(14, 'person:Person A', 1, 15, 18),
    ]);
    const ops: Op[] = [
      { op: 'person.rename', person: 'person:Person A', name: 'Ann' },
      { op: 'person.rename', person: 'person:Person C', name: 'Carol' },
      { op: 'person.distinct', a: 'person:Person A', b: 'person:Person C' },
    ];
    const { ops: carried, unmatched } = carryOver(ops, old, together, 'v1');
    expect(carried.map((o) => o.op === 'person.rename' && o.name)).toEqual(['Ann']);
    expect(unmatched.map((u) => u.index)).toEqual([1, 2]);
    expect(unmatched[0].reason).toBe('Person C and Person A are one identity (Person A) in the new version');
  });

  test('a person seen in a single detection (a track of no duration) is still matched', () => {
    const one = (f: FaceTrack) => ({ ...f, end: f.start, samples: f.samples.slice(0, 1) });
    const before = makeBundle({ faces: { ...old.layers.faces!, tracks: old.faces.map((f) => (f.id === 'face:4' ? one(f) : f)) } });
    const after = rerun([
      face(10, 'person:Person B', 0, 0, 4), face(11, 'person:Person A', 0, 0, 4, 500), face(12, 'person:Person B', 1, 10, 14),
      one(face(14, 'person:Person D', 1, 15, 18)),
    ]);
    const { ops, unmatched } = carryOver([{ op: 'person.rename', person: 'person:Person C', name: 'Carol' }], before, after, 'v1');
    expect(unmatched).toEqual([]);
    expect(ops[0]).toMatchObject({ person: 'person:Person D' });
  });

  test('a person whose faces the re-run left unassigned is listed as such', () => {
    const unassigned = rerun([
      face(10, 'person:Person B', 0, 0, 4), face(11, 'person:Person A', 0, 0, 4, 500), face(12, 'person:Person B', 1, 10, 14),
      face(14, null, 1, 15, 18),
    ]);
    const { unmatched } = carryOver([{ op: 'person.rename', person: 'person:Person C', name: 'Carol' }], old, unassigned, 'v1');
    expect(unmatched.map((u) => u.reason)).toEqual(['Person C: their faces are unassigned (Unknown) in the new version']);
  });

  test('carried ops name the op they copy, and the earlier log is left as it was', () => {
    const ops: Op[] = [
      { op: 'entity.include', id: 'face:3', included: false, at: '2026-10-24T00:00:00.000Z' },
      { op: 'shot.caption', shot: 'shot:0', caption: 'a', at: '2026-10-24T00:00:01.000Z' },
    ];
    const before = structuredClone(ops);
    const { ops: carried } = carryOver(ops, old, rerun(), 'bundle-v1');
    expect(carried).toEqual([{ op: 'shot.caption', shot: 'shot:10', caption: 'a', at: '2026-10-24T00:00:01.000Z', carried_from: { bundle: 'bundle-v1', index: 1 } }]);
    expect(ops).toEqual(before);
  });

  test('every op kind has a line for the review list', () => {
    expect(describeOp({ op: 'person.rename', person: 'person:Person C', name: 'Carol' })).toBe('Person C named “Carol”');
    expect(describeOp({ op: 'shot.caption', shot: 'shot:4', caption: 'x' })).toBe('Caption of shot 5 edited');
  });
});
