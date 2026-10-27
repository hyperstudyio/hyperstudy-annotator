import { describe, expect, test } from 'vitest';
import { FORMAT, ImportError, NOT_PERSON, UNKNOWN, follow, fold, lastBatch, readCorrectionsFile, typesIn, unknownRefs, type AnnotationType, type Op } from './corrections';

const SHA = 'a'.repeat(64);

describe('fold', () => {
  test('merges chain, and a later merge of the target carries earlier merges with it', () => {
    const S = fold([
      { op: 'person.merge', from: 'person:B', into: 'person:A' },
      { op: 'person.merge', from: 'person:A', into: 'person:C' },
    ]);
    expect(follow(S.mergedInto, 'person:B')).toBe('person:C');
    expect(follow(S.mergedInto, 'person:A')).toBe('person:C');
  });

  test('merging a person into itself through a chain is ignored rather than looping', () => {
    const S = fold([
      { op: 'person.merge', from: 'person:B', into: 'person:A' },
      { op: 'person.merge', from: 'person:A', into: 'person:B' },
    ]);
    expect(follow(S.mergedInto, 'person:A')).toBe('person:A');
    expect(follow(S.mergedInto, 'person:B')).toBe('person:A');
  });

  test('not a person moves the identity, and its earlier merges, out of the people', () => {
    const S = fold([
      { op: 'person.merge', from: 'person:B', into: 'person:A' },
      { op: 'person.not_person', person: 'person:A' },
    ]);
    expect(follow(S.mergedInto, 'person:B')).toBe(NOT_PERSON);
  });

  test('a speaker set back to null returns the utterance to the prediction', () => {
    const S = fold([
      { op: 'utterance.speaker', utt: 'utt:3', speaker: { kind: 'unsure' } },
      { op: 'utterance.speaker', utt: 'utt:3', speaker: null },
    ]);
    expect('utt:3' in S.uttSpeaker).toBe(false);
  });

  test('annotations are added, edited and deleted', () => {
    const note = { id: 'note:1', type: 'type:1', start: 1, end: 2, value: null, person: null };
    const S = fold([
      { op: 'annotation.add', note },
      { op: 'annotation.edit', id: 'note:1', fields: { value: 'calm' } },
      { op: 'annotation.add', note: { ...note, id: 'note:2' } },
      { op: 'annotation.delete', id: 'note:2' },
    ]);
    expect([...S.notes.values()]).toEqual([{ ...note, value: 'calm' }]);
    expect(note.value).toBeNull();   // the fold copies notes; the log is never mutated
  });

  test('a type is edited and deleted by later ops, and the op that made it is left as it was', () => {
    const type: AnnotationType = { id: 'type:1', name: 'Mood', kind: 'category', target: 'person', options: ['calm', 'tense'] };
    const ops: Op[] = [
      { op: 'annotation.type', type },
      { op: 'annotation.type', type: { ...type, id: 'type:2', name: 'Gaze' } },
      { op: 'annotation.type_edit', id: 'type:1', fields: { name: 'Mental state', options: ['calm', 'tense', 'bored'] } },
      { op: 'annotation.type_delete', id: 'type:2' },
    ];
    expect(fold(ops).types).toEqual([{ ...type, name: 'Mental state', options: ['calm', 'tense', 'bored'] }]);
    expect(type).toEqual({ id: 'type:1', name: 'Mood', kind: 'category', target: 'person', options: ['calm', 'tense'] });
  });
});

test('undo removes exactly the ops committed together', () => {
  const ops: Op[] = [
    { op: 'person.rename', person: 'person:A', name: 'x', at: 't1' },
    { op: 'person.create', person: 'person:New 1', name: 'y', at: 't2' },
    { op: 'track.assign', track: 'face:4', person: 'person:New 1', at: 't2' },
  ];
  expect(lastBatch(ops)).toBe(2);
  expect(lastBatch([])).toBe(0);
});

describe('prototype v1 files', () => {
  const v1 = (ops: unknown[]) => ({ format: 'perception-corrections/1', sha256: SHA, ops });

  test('bare numbers and labels become bundle ids', () => {
    const ops = readCorrectionsFile(v1([
      { op: 'track.assign', track: 126, person: 'Person O', at: 't' },
      { op: 'utterance.speaker', utt: 5, speaker: { kind: 'face', track: 12 }, at: 't' },
      { op: 'utterance.speaker', utt: 6, speaker: { kind: 'offscreen', voice: 'SPEAKER_00' }, at: 't' },
      { op: 'person.merge', from: 'Unknown', into: 'Person A', at: 't' },
      { op: 'person.not_person', person: 'Person Q', at: 't' },
      { op: 'entity.include', id: 'track:9', included: false, at: 't' },
      { op: 'annotation.type', type: { id: 'type:1', name: 'Mood', options: ['calm', 'tense'], target: 'person' }, at: 't' },
    ]), SHA);
    expect(ops).toEqual([
      { op: 'track.assign', track: 'face:126', person: 'person:Person O', at: 't' },
      { op: 'utterance.speaker', utt: 'utt:5', speaker: { kind: 'face', face: 'face:12' }, at: 't' },
      { op: 'utterance.speaker', utt: 'utt:6', speaker: { kind: 'offscreen', voice: 'voice:SPEAKER_00' }, at: 't' },
      { op: 'person.merge', from: UNKNOWN, into: 'person:Person A', at: 't' },
      { op: 'person.not_person', person: 'person:Person Q', at: 't' },
      { op: 'entity.include', id: 'face:9', included: false, at: 't' },
      { op: 'annotation.type', type: { id: 'type:1', name: 'Mood', kind: 'category', options: ['calm', 'tense'], target: 'person' }, at: 't' },
    ]);
  });

  test('a file for another video, or an op the bundle cannot hold, is refused', () => {
    expect(() => readCorrectionsFile(v1([]), 'b'.repeat(64))).toThrow(ImportError);
    expect(() => readCorrectionsFile(v1([{ op: 'entity.include', id: 'grw:3', included: false }]), SHA)).toThrow(/no such layer/);
    expect(() => readCorrectionsFile({ format: 'something/9', sha256: SHA, ops: [] }, SHA)).toThrow(/unknown corrections format/);
  });

  test('this app\'s own files are read as they are', () => {
    const ops: Op[] = [{ op: 'shot.caption', shot: 'shot:2', caption: 'two people talk', at: 't' }];
    expect(readCorrectionsFile({ format: FORMAT, sha256: SHA, ops }, SHA)).toEqual(ops);
  });
});

test('references to ids the bundle does not define are reported', () => {
  const has = (id: string) => ['face:1', 'utt:1'].includes(id);
  expect(unknownRefs([
    { op: 'track.assign', track: 'face:1', person: 'person:A' },
    { op: 'track.assign', track: 'face:999', person: 'person:A' },
    { op: 'utterance.speaker', utt: 'utt:1', speaker: { kind: 'face', face: 'face:7' } },
  ], has)).toEqual(['face:999', 'face:7']);
});

test("other videos' types are listed by video, each once, and videos with none are left out", () => {
  const mood: AnnotationType = { id: 'type:1', name: 'Mood', kind: 'binary', target: 'scene', options: [] };
  expect(typesIn([
    { key: 'b1', title: 'clip1', ops: [{ op: 'annotation.type', type: mood }, { op: 'annotation.type', type: mood }] },
    { key: 'b2', title: 'clip2', ops: [{ op: 'person.rename', person: 'person:A', name: 'x' }] },
    { key: 'b3', title: 'clip3', ops: [{ op: 'annotation.type', type: mood }, { op: 'annotation.type_delete', id: 'type:1' }] },
  ])).toEqual([{ key: 'b1', title: 'clip1', types: [mood] }]);
});
