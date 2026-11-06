import { describe, expect, test } from 'vitest';
import {
  FORMAT, ImportError, NOT_PERSON, UNKNOWN, batchOf, follow, fold, lastUndoable, live, newBatch, newType, readCorrectionsFile, typesIn, unknownRefs,
  upgrade, type AnnotationType, type Op,
} from './corrections';

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

  test('a type stored without options (an early import) still folds, as a type with none', () => {
    const raw = { op: 'annotation.type', type: { id: 'type:1', name: 'Mood', kind: 'text', target: 'scene' } } as unknown as Op;
    expect(fold([raw]).types).toEqual([{ id: 'type:1', name: 'Mood', kind: 'text', target: 'scene', options: [] }]);
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

describe('batches and undo', () => {
  const rename = (name: string, batch: string): Op => ({ op: 'person.rename', person: 'person:A', name, batch });

  test('undo takes back exactly the ops committed together, newest edit still in effect first', () => {
    const ops: Op[] = [
      rename('x', 'b1'),
      { op: 'person.create', person: 'person:New 1', name: 'y', batch: 'b2' },
      { op: 'track.assign', track: 'face:4', person: 'person:New 1', batch: 'b2' },
    ];
    expect(lastUndoable(ops)).toBe('b2');
    const once = [...ops, { op: 'revert', batches: ['b2'], batch: 'r1' } as Op];
    expect(live(once)).toEqual([ops[0]]);
    expect(lastUndoable(once)).toBe('b1');   // the revert itself is not what the next undo takes
    const twice = [...once, { op: 'revert', batches: ['b1'], batch: 'r2' } as Op];
    expect(live(twice)).toEqual([]);
    expect(lastUndoable(twice)).toBeNull();
    expect(lastUndoable([])).toBeNull();
  });

  test('a revert of a revert is a redo: the batch it took back is in effect again, and reverting the redo undoes it', () => {
    const ops: Op[] = [rename('Ann', 'b1'), { op: 'revert', batches: ['b1'], batch: 'r1' }];
    expect(fold(ops).names['person:A']).toBeUndefined();
    const redone = [...ops, { op: 'revert', batches: ['r1'], batch: 'r2' } as Op];
    expect(live(redone)).toEqual([ops[0]]);
    expect(fold(redone).names['person:A']).toBe('Ann');
    expect(lastUndoable(redone)).toBe('b1');
    const undoneAgain = [...redone, { op: 'revert', batches: ['r2'], batch: 'r3' } as Op];
    expect(live(undoneAgain)).toEqual([]);
    // two reverts naming the same batch: taking back one leaves the other in effect
    const twice = [rename('Ann', 'b1'), { op: 'revert', batches: ['b1'], batch: 'r1' } as Op, { op: 'revert', batches: ['b1'], batch: 'r2' } as Op];
    expect(live([...twice, { op: 'revert', batches: ['r1'], batch: 'r3' } as Op])).toEqual([]);
  });

  test('fold leaves out what was undone, so a name goes back to the one before', () => {
    const ops: Op[] = [rename('x', 'b1'), rename('y', 'b2'), { op: 'revert', batches: ['b2'], batch: 'r' }];
    expect(fold(ops).names['person:A']).toBe('x');
  });

  test('ops from before batches were committed together by sharing their time, and still undo together', () => {
    const v2: Op[] = [
      { op: 'person.rename', person: 'person:A', name: 'x', at: 't1' },
      { op: 'person.create', person: 'person:New 1', name: 'y', at: 't2' },
      { op: 'track.assign', track: 'face:4', person: 'person:New 1', at: 't2' },
    ];
    expect(batchOf(v2[1])).toBe('at:t2');
    expect(lastUndoable(v2)).toBe('at:t2');
    expect(live([...v2, { op: 'revert', batches: ['at:t2'], batch: 'r' }])).toEqual([v2[0]]);
  });

  test('a new batch names each op and shares one batch, keeping what each op says (an op\'s own id included)', () => {
    const ops = newBatch([{ op: 'entity.include', id: 'face:3', included: false }, rename('x', 'ignored')], 't', 'run-1');
    expect(ops[0]).toMatchObject({ op: 'entity.include', id: 'face:3', included: false, at: 't', base: 'run-1' });
    expect(new Set(ops.map((o) => o.op_id)).size).toBe(2);
    expect(new Set(ops.map((o) => o.batch)).size).toBe(1);
    expect(ops[1].batch).not.toBe('ignored');
    expect(newBatch(ops, 't')[0].batch).not.toBe(ops[0].batch);
  });

  test('a log from before op ids is named by place, the same way every time, and named ops keep their names', () => {
    const ops: Op[] = [{ op: 'shot.caption', shot: 'shot:1', caption: 'a', at: 't' }, { ...rename('x', 'b'), op_id: 'kept' }];
    expect(upgrade(ops)).toEqual([{ ...ops[0], op_id: 'v2-0', batch: 'at:t' }, ops[1]]);
    expect(upgrade(ops)).toEqual(upgrade(ops));
  });
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
    expect(ops).toEqual(upgrade([
      { op: 'track.assign', track: 'face:126', person: 'person:Person O', at: 't' },
      { op: 'utterance.speaker', utt: 'utt:5', speaker: { kind: 'face', face: 'face:12' }, at: 't' },
      { op: 'utterance.speaker', utt: 'utt:6', speaker: { kind: 'offscreen', voice: 'voice:SPEAKER_00' }, at: 't' },
      { op: 'person.merge', from: UNKNOWN, into: 'person:Person A', at: 't' },
      { op: 'person.not_person', person: 'person:Person Q', at: 't' },
      { op: 'entity.include', id: 'face:9', included: false, at: 't' },
      { op: 'annotation.type', type: { id: 'type:1', name: 'Mood', kind: 'category', options: ['calm', 'tense'], target: 'person' }, at: 't' },
    ]));
  });

  test('a file for another video, or an op the bundle cannot hold, is refused', () => {
    expect(() => readCorrectionsFile(v1([]), 'b'.repeat(64))).toThrow(ImportError);
    expect(() => readCorrectionsFile(v1([{ op: 'entity.include', id: 'grw:3', included: false }]), SHA)).toThrow(/no such layer/);
    expect(() => readCorrectionsFile({ format: 'something/9', sha256: SHA, ops: [] }, SHA)).toThrow(/unknown corrections format/);
  });

  test('this app\'s own files are read as they are, reverts included; a v2 file\'s ops are named on the way in', () => {
    const ops: Op[] = [
      { op: 'shot.caption', shot: 'shot:2', caption: 'two people talk', at: 't', op_id: 'o1', batch: 'b1' },
      { op: 'shot.caption', shot: 'shot:2', caption: 'no', at: 'u', op_id: 'o2', batch: 'b2' },
      { op: 'revert', batches: ['b2'], at: 'v', op_id: 'o3', batch: 'b3' },
    ];
    expect(FORMAT).toBe('perception-corrections/3');
    expect(readCorrectionsFile({ format: FORMAT, sha256: SHA, ops }, SHA)).toEqual(ops);
    const v2 = ops.slice(0, 1).map(({ op_id: _i, batch: _b, ...op }) => op as Op);
    expect(readCorrectionsFile({ format: 'perception-corrections/2', sha256: SHA, ops: v2 }, SHA)).toEqual([{ ...v2[0], op_id: 'v2-0', batch: 'at:t' }]);
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

test('a new type keeps only what its kind uses: categories for a category, a range for a number', () => {
  const draft = { id: '', name: ' Gaze ', kind: 'binary' as const, target: 'person' as const, options: ['a', 'b'], min: 0, max: 5 };
  expect(newType(draft, 'type:1')).toEqual({ id: 'type:1', name: 'Gaze', kind: 'binary', target: 'person', options: [] });
  expect(newType({ ...draft, kind: 'number' }, 'type:2')).toEqual({ id: 'type:2', name: 'Gaze', kind: 'number', target: 'person', options: [], min: 0, max: 5 });
  expect(newType({ ...draft, kind: 'category' }, 'type:3').options).toEqual(['a', 'b']);
});

test("a type keeps only what its kind uses, whatever its ops say: a kind changed, or a log saved before this rule", () => {
  const n: AnnotationType = { id: 'type:1', name: 'x', kind: 'number', target: 'scene', options: [], min: 0, max: 5 };
  const S = fold([
    { op: 'annotation.type', type: n }, { op: 'annotation.type_edit', id: 'type:1', fields: { kind: 'binary' } },
    { op: 'annotation.type', type: { ...n, id: 'type:2', kind: 'category', options: ['a', 'b'] } },
    { op: 'annotation.type_edit', id: 'type:2', fields: { kind: 'number' } },
    { op: 'annotation.type', type: { ...n, id: 'type:3', kind: 'text', options: ['stale'] } },   // as an older log may hold
    { op: 'annotation.type_edit', id: 'type:1', fields: { kind: 'number' } },   // back: the range does not return
  ]);
  const plain = { name: 'x', target: 'scene', options: [] };
  expect(S.types).toEqual([{ id: 'type:1', kind: 'number', ...plain }, { id: 'type:2', kind: 'number', ...plain }, { id: 'type:3', kind: 'text', ...plain }]);
});
