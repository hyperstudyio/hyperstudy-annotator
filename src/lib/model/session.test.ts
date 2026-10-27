import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { Bundle, type Layers } from './bundle';
import { NOT_PERSON, RunUnknownError, UNKNOWN } from './corrections';
import { MemoryStorage, SHA, face, makeBundle } from './fixture.test-helpers';
import { Session, coVisible, stampAfter } from './session.svelte';
import { View } from './view.svelte';
import { LocalCorrectionStore, localTypesElsewhere } from '../source';
import type { AnnotationType } from './corrections';

function session(bundle = makeBundle(), storage = new MemoryStorage()) {
  const s = new Session(bundle, new LocalCorrectionStore(bundle.sha256, storage), new View(bundle.sha256, storage));
  return { s, storage };
}

describe('people', () => {
  test('a reassigned track and a merge both change who a face is', async () => {
    const { s } = session();
    const [f0, , , f3] = s.bundle.faces;
    expect(s.personOf(f3)).toBe(UNKNOWN);   // the clusterer's null
    await s.commit({ op: 'track.assign', track: 'face:3', person: 'person:Person B' });
    expect(s.personOf(f3)).toBe('person:Person B');
    await s.commit({ op: 'person.merge', from: 'person:Person B', into: 'person:Person A' });
    expect(s.personOf(f3)).toBe('person:Person A');
    expect(s.personOf(f0)).toBe('person:Person A');
    expect(s.people).toEqual(['person:Person A', 'person:Person C', UNKNOWN, NOT_PERSON]);
  });

  test('people are ordered by screen time; renamed people keep their machine label', async () => {
    const { s } = session();
    expect(s.people.slice(0, 3)).toEqual(['person:Person A', 'person:Person B', 'person:Person C']);
    await s.commit({ op: 'person.rename', person: 'person:Person C', name: 'Alyssa' });
    expect(s.nameOf('person:Person C')).toBe('Alyssa');
    expect(s.machineLabel('person:Person C')).toBe('Alyssa (Person C)');
  });

  test('not a person is excluded from agents by default, and a track follows its person unless set itself', async () => {
    const { s } = session();
    const f4 = s.bundle.face.get('face:4')!;
    await s.commit({ op: 'person.not_person', person: 'person:Person C' });
    expect(s.personOf(f4)).toBe(NOT_PERSON);
    expect(s.includedFace(f4)).toBe(false);
    await s.commit({ op: 'entity.include', id: 'face:4', included: true });
    expect(s.includedFace(f4)).toBe(true);
  });

  test('two faces of one person on screen together at different places are reported', () => {
    expect(coVisible([face(0, 'p', 0, 0, 2, 0), face(1, 'p', 0, 1, 3, 600)]).length).toBe(1);
    expect(coVisible([face(0, 'p', 0, 0, 2, 0), face(1, 'p', 0, 1, 3, 10)]).length).toBe(0);   // the same face twice
    expect(coVisible([face(0, 'p', 0, 0, 2, 0), face(1, 'p', 1, 1, 3, 600)]).length).toBe(0);  // different shots
  });
});

describe('speakers and the review queue', () => {
  test('only utterances with faces on screen and an unsure speaker model are queued', () => {
    const { s } = session();
    // utt:0 confident, utt:1 small gap, utt:2 no faces (off-screen by definition), utt:3 no face scored as speaking
    expect(s.queue.speakers.map((u) => u.id)).toEqual(['utt:1', 'utt:3']);
    expect(s.queue.sounds.map((x) => x.id)).toEqual(['sound:1']);
  });

  test('similar people are suggested once per pair, never when seen together, and not after "different"', async () => {
    const { s } = session();
    expect(s.queue.pairs.map((p) => [p.a, p.b])).toEqual([['person:Person A', 'person:Person C']]);
    await s.commit({ op: 'person.distinct', a: 'person:Person C', b: 'person:Person A' });
    expect(s.queue.pairs).toEqual([]);
  });

  test('choosing a speaker marks it reviewed and moves to the next open utterance', async () => {
    const { s } = session();
    const u1 = s.bundle.utt.get('utt:1')!;
    expect(s.openInQueue).toBe(3);   // two speakers and one pair
    s.select('utt', 'utt:1');
    await s.setSpeaker(u1, { kind: 'face', face: 'face:0' });
    expect(s.reviewed(u1)).toBe(true);
    expect(s.speakerPerson(s.speakerOf(u1))).toBe('person:Person A');
    expect(s.selection).toEqual({ kind: 'utt', id: 'utt:3' });
    expect(s.openInQueue).toBe(2);
  });

  test('speech dropped on a person is their face when on screen in that shot, else them off camera', () => {
    const { s } = session();
    const u0 = s.bundle.utt.get('utt:0')!, u3 = s.bundle.utt.get('utt:3')!;
    expect(s.speakerForPerson(u0, 'person:Person B')).toEqual({ kind: 'face', face: 'face:1' });
    expect(s.speakerForPerson(u3, 'person:Person A')).toEqual({ kind: 'person', person: 'person:Person A' });
    expect(s.speakerForPerson(u3, UNKNOWN)).toBeNull();
  });
});

describe('the op log', () => {
  test('undo removes the last commit as a whole', async () => {
    const { s } = session();
    await s.commit({ op: 'person.rename', person: 'person:Person A', name: 'x' });
    await s.commit({ op: 'person.create', person: 'person:New 1', name: 'y' }, { op: 'track.assign', track: 'face:3', person: 'person:New 1' });
    expect(s.ops.length).toBe(3);
    await s.undo();
    expect(s.ops.map((o) => o.op)).toEqual(['person.rename']);
    expect(await s.store.load()).toEqual(s.ops);
  });

  test('a commit made while another tab also saved keeps both', async () => {
    const storage = new MemoryStorage();
    const { s: a } = session(makeBundle(), storage);
    const { s: b } = session(makeBundle(), storage);
    await a.commit({ op: 'person.rename', person: 'person:Person A', name: 'from a' });
    await b.commit({ op: 'person.rename', person: 'person:Person B', name: 'from b' });   // b had loaded nothing
    expect(b.ops.map((o) => (o as { name: string }).name)).toEqual(['from a', 'from b']);
  });

  test('an import naming ids this bundle lacks is refused as a whole', async () => {
    const { s } = session();
    const file = (ops: unknown[]) => JSON.stringify({ format: 'perception-corrections/1', sha256: SHA, ops });
    expect(await s.parseCorrections(file([{ op: 'track.assign', track: 3, person: 'Person A', at: 't' }]))).toHaveLength(1);
    await expect(s.parseCorrections(file([{ op: 'track.assign', track: 99, person: 'Person A', at: 't' }]))).rejects.toThrow(/face:99/);
  });
});

describe('segments', () => {
  test('arrows step through the same person\'s tracks, and around the playhead with nothing selected', () => {
    const { s } = session();
    s.select('face', 'face:0');
    s.step(1);
    expect(s.selection).toEqual({ kind: 'face', id: 'face:2' });
    expect(s.playback.clip).toEqual({ start: 10, end: 14 });
    s.step(1);
    expect(s.selection).toEqual({ kind: 'face', id: 'face:2' });   // the last one: stays
    s.selection = null;
    s.playback.time = 3;
    s.step(-1);
    expect(s.selection).toEqual({ kind: 'utt', id: 'utt:1' });
  });
});

// A real corrections file from the annotator prototype, against the bundle converted from the same run: set
// PROTOTYPE_RUN to that run's folder (it holds perception_corrections.json and bundle/). Skipped without it.
const RUN = process.env.PROTOTYPE_RUN ?? '';
test.skipIf(!RUN || !existsSync(`${RUN}/perception_corrections.json`))('the prototype\'s real corrections file imports with no unknown ids', async () => {
  const manifest = JSON.parse(readFileSync(`${RUN}/bundle/manifest.json`, 'utf8'));
  const layers = Object.fromEntries(['shots', 'transcript', 'speakers', 'faces', 'bodies', 'hands', 'gestures', 'facing', 'gaze', 'objects', 'sounds', 'text', 'prosody', 'waveform']
    .map((n) => [n, manifest.layers[n] && n !== 'bodies' && n !== 'hands' ? JSON.parse(readFileSync(`${RUN}/bundle/${manifest.layers[n].file}`, 'utf8')) : null])) as unknown as Layers;
  const s = new Session(new Bundle(manifest, layers), new LocalCorrectionStore(manifest.video.sha256, new MemoryStorage()), new View('x', null));
  const ops = await s.parseCorrections(readFileSync(`${RUN}/perception_corrections.json`, 'utf8'));
  expect(ops.length).toBeGreaterThan(0);   // parseCorrections throws on an id the bundle does not have
});

test('two commits in the same millisecond get different timestamps', () => {
  const now = new Date('2026-10-23T10:00:00.000Z');
  expect(stampAfter('2026-10-23T10:00:00.000Z', now)).toBe('2026-10-23T10:00:00.001Z');
  expect(stampAfter('2026-10-23T09:00:00.000Z', now)).toBe('2026-10-23T10:00:00.000Z');
  expect(stampAfter(undefined, now)).toBe('2026-10-23T10:00:00.000Z');
});

describe('carry-over', () => {
  const unmatched = [{ index: 1, op: { op: 'entity.include', id: 'face:9', included: false } as const, reason: 'no counterpart', span: null }];
  const record = (carried: number) => ({ from_bundle_id: 'v1', status: 'carried' as const, carried, unmatched, created_at: '' });
  const lineage = (rec: ReturnType<typeof record> | null) => ({
    record: async () => rec, previous: async () => ({ id: 'v1', label: 'v1', corrections: 2, open: async () => { throw new Error('unused'); } }),
    carry: async () => 0, decline: async () => {}, dismiss: async () => rec!, others: async () => 1, find: async () => null,
  });

  test('a version opened with carried ops in its log shows what was not carried, and offers nothing', async () => {
    const { s } = session();
    await s.commit({ op: 'shot.caption', shot: 'shot:0', caption: 'a', carried_from: { bundle: 'v1', index: 0 } });
    expect(await s.checkCarry(lineage(record(1)))).toBeNull();
    expect(s.notCarried).toEqual(unmatched);
  });

  test('a carry-over that matched nothing still lists what it could not carry, and is not offered again', async () => {
    const { s } = session();
    expect(await s.checkCarry(lineage(record(0)))).toBeNull();
    expect(s.notCarried).toEqual(unmatched);
  });

  test('an undone carry-over is offered again and its list is hidden', async () => {
    const { s } = session();
    expect(await s.checkCarry(lineage(record(1)))).toMatchObject({ id: 'v1' });
    expect(s.notCarried).toEqual([]);
    expect(await s.checkCarry(lineage(null))).toMatchObject({ id: 'v1' });   // never carried: offered
  });
});

describe('which run a corrections file was made on', () => {
  const file = (ops: unknown[], bundle?: string) => JSON.stringify({ format: 'perception-corrections/2', sha256: SHA, ...(bundle ? { bundle } : {}), ops });
  const caption = { op: 'shot.caption', shot: 'shot:0', caption: 'a' };
  const lineage = (versions: Record<string, ReturnType<typeof makeBundle>>) => ({
    record: async () => null, previous: async () => null, carry: async () => 0, decline: async () => {}, dismiss: async () => { throw new Error(); },
    others: async () => Object.keys(versions).length,
    // library ids differ from manifest hashes: provenance must name the portable one
    find: async (key: string) => versions[key] ? { id: `lib-${key}`, label: key, corrections: 0, open: async () => ({ bundle: versions[key] }) } as never : null,
  });
  const load = async (v: { open(): Promise<unknown> }) => ((await v.open()) as { bundle: ReturnType<typeof makeBundle> }).bundle;

  test('an export records the bundle it was made on', () => {
    const { s } = session(makeBundle({}, 'this-run'));
    expect(JSON.parse(s.exportCorrections()).bundle).toBe('this-run');
  });

  test('a file made on this run imports as it is', async () => {
    const { s } = session(makeBundle({}, 'this-run'));
    expect(await s.parseCorrections(file([caption], 'this-run'), lineage({ other: makeBundle({}, 'other') }), load)).toEqual([caption]);
  });

  test('a file from another run in the library is re-anchored when everything matches', async () => {
    const { s } = session(makeBundle({}, 'this-run'));
    const ops = await s.parseCorrections(file([caption], 'other'), lineage({ other: makeBundle({}, 'other') }), load);
    expect(ops).toMatchObject([{ ...caption, reanchored_from: { bundle: 'other', index: 0 } }]);
  });

  test('re-anchored imports name the file position they came from, and do not count as a carry-over', async () => {
    const { s } = session(makeBundle({}, 'this-run'));
    s.carry = { from_bundle_id: 'v1', status: 'carried', carried: 3, created_at: '',
      unmatched: [{ index: 0, op: caption as never, reason: 'x', span: null }] };   // an earlier carry-over, since undone
    const ops = await s.parseCorrections(file([caption], 'other'), lineage({ other: makeBundle({}, 'other') }), load);
    expect(ops).toEqual([{ ...caption, reanchored_from: { bundle: 'other', index: 0 } }]);
    await s.replaceCorrections(ops);
    expect(s.notCarried).toEqual([]);   // the undone carry-over's list does not come back
  });

  test('a file from another run is refused when some of it does not match, pointing to carry-over', async () => {
    const other = makeBundle({}, 'other');
    const { s } = session(makeBundle({ faces: { ...other.layers.faces!, tracks: other.faces.filter((t) => t.id !== 'face:3') } }, 'this-run'));
    await expect(s.parseCorrections(file([caption, { op: 'entity.include', id: 'face:3', included: false }], 'other'), lineage({ other }), load))
      .rejects.toThrow(/1 of its 2 corrections could not be matched.*carry/);
  });

  test('a file from a run the library does not have is refused', async () => {
    const { s } = session(makeBundle({}, 'this-run'));
    await expect(s.parseCorrections(file([caption], 'gone'), lineage({}), load)).rejects.toThrow(/another run of this video that is not in the library/);
  });

  test('an old file that does not say its run asks on a video with several runs, imports once the user says it is this run\'s, and imports when the video has one run', async () => {
    const { s } = session(makeBundle({}, 'this-run'));
    const several = lineage({ other: makeBundle({}, 'other') });
    await expect(s.parseCorrections(file([caption]), several, load)).rejects.toBeInstanceOf(RunUnknownError);
    expect(await s.parseCorrections(file([caption]), several, load, { thisRun: true })).toEqual([caption]);
    expect(await s.parseCorrections(file([caption]), lineage({}), load)).toEqual([caption]);
  });
});

describe('what an earlier edit left out', () => {
  test('says why, and the edit that puts it back undoes just that', async () => {
    const { s } = session();
    const [f0] = s.bundle.faces;   // Person A's
    expect(s.leftOut({ kind: 'face', id: f0.id })).toBeNull();
    await s.commit({ op: 'entity.include', id: 'person:Person A', included: false });
    const out = s.leftOut({ kind: 'face', id: f0.id })!;
    expect(out.why).toBe('Person A was left out by an earlier edit.');
    await s.commit(out.putBack);
    expect(s.includedFace(f0)).toBe(true);
    await s.commit({ op: 'entity.include', id: f0.id, included: false });
    expect(s.leftOut({ kind: 'face', id: f0.id })!.why).toBe('Left out by an earlier edit.');
    const x = s.bundle.sounds[0];
    await s.commit({ op: 'category.include', kind: 'sound', label: x.label, included: false });
    const sound = s.leftOut({ kind: 'sound', id: x.id })!;
    expect(sound.why).toBe(`Every "${x.label}" was left out by an earlier edit.`);
    await s.commit(sound.putBack);
    expect(s.includedSound(x)).toBe(true);
  });

  test("a sound marked not there (by Review, or an edit from before it) is put right by marking it real", async () => {
    const { s } = session();
    const x = s.bundle.sounds[0];
    await s.commit({ op: 'entity.include', id: x.id, included: false });
    const out = s.leftOut({ kind: 'sound', id: x.id })!;
    expect(out.why).toBe('Marked not there.');
    expect(out.action).toBe('Mark real');
    await s.commit(out.putBack);
    expect(s.S.included[x.id]).toBe(true);
  });

  test('not a person is not this: it is put right by naming who the face is', async () => {
    const { s } = session();
    await s.commit({ op: 'person.not_person', person: 'person:Person C' });
    const t = s.bundle.faces.find((f) => f.person === 'person:Person C')!;
    expect(s.leftOut({ kind: 'face', id: t.id })).toBeNull();
  });
});

test('Back returns to the selections before, newest first, and after deselecting to what was selected', () => {
  const { s } = session();
  const note = () => s.noteSelection(s.selection);
  s.select('shot', 'shot:0', { seek: false }); note();
  s.select('person', 'person:Person A', { seek: false }); note();
  s.select('face', 'face:0', { seek: false }); note();
  expect(s.history.map((x) => x.id)).toEqual(['shot:0', 'person:Person A']);
  s.back(); note();
  expect(s.selection).toEqual({ kind: 'person', id: 'person:Person A' });
  expect(s.history.map((x) => x.id)).toEqual(['shot:0']);   // going back adds nothing
  s.selection = null; note();   // Esc
  expect(s.history.map((x) => x.id)).toEqual(['shot:0', 'person:Person A']);
  s.back(); note();
  expect(s.selection).toEqual({ kind: 'person', id: 'person:Person A' });
});

test('Back never returns to what is already selected', () => {
  const { s } = session();
  const note = () => s.noteSelection(s.selection);
  s.select('shot', 'shot:0', { seek: false }); note();
  s.select('person', 'person:Person A', { seek: false }); note();
  s.selection = null; note();   // Esc
  s.select('person', 'person:Person A', { seek: false }); note();   // the same again
  expect(s.history.map((x) => x.id)).toEqual(['shot:0']);
  s.back(); note();
  expect(s.selection).toEqual({ kind: 'shot', id: 'shot:0' });
});

describe('annotation types', () => {
  const mood: AnnotationType = { id: 'type:mood', name: 'Mood', kind: 'category', target: 'scene', options: ['calm', 'tense'] };
  const gaze: AnnotationType = { id: 'type:gaze', name: 'Gaze aversion', kind: 'binary', target: 'person', options: [] };

  test('A annotates the selection, else the shot under the playhead, with the type last used', async () => {
    const { s } = session();
    expect(await s.annotateHere()).toBe(false);   // no type yet
    await s.addType(mood);
    await s.addType(gaze);
    expect(s.currentType()?.id).toBe('type:gaze');
    const u = s.bundle.utterances[0];
    s.select('utt', u.id, { seek: false });
    await s.annotateHere();
    const first = [...s.S.notes.values()][0];
    expect(first).toMatchObject({ type: 'type:gaze', start: u.start, end: u.end });
    s.activeType = 'type:mood';
    s.selection = null;
    const shot = s.bundle.shotAt(s.playback.time)!;
    await s.annotateHere();
    expect([...s.S.notes.values()][1]).toMatchObject({ type: 'type:mood', start: shot.start, end: shot.end });
  });

  test("keys give the selected annotation its value: y or n a yes/no, 1-9 a category in its order", async () => {
    const { s } = session();
    await s.copyTypes([mood, gaze]);
    await s.addNote('type:mood', 0, 1);
    expect(s.valueFromKey('2')).toBe('tense');
    expect(s.valueFromKey('3')).toBeUndefined();
    expect(s.valueFromKey('y')).toBeUndefined();
    await s.addNote('type:gaze', 0, 1);
    expect(s.valueFromKey('y')).toBe(true);
    expect(s.valueFromKey('N')).toBe(false);   // Shift or Caps Lock
    expect(s.valueFromKey('1')).toBeUndefined();
  });

  test("another video's types are copied as they are, skipping those this one has, in one undo", async () => {
    const { s } = session();
    await s.addType(mood);
    expect(await s.copyTypes([mood, gaze])).toBe(1);
    expect(s.S.types.map((t) => t.id)).toEqual(['type:mood', 'type:gaze']);
    await s.undo();
    expect(s.S.types.map((t) => t.id)).toEqual(['type:mood']);
  });

  test('a type knows the annotations that use it', async () => {
    const { s } = session();
    await s.copyTypes([mood, gaze]);
    await s.addNote('type:mood', 0, 1);
    expect(s.usesOf('type:mood')).toHaveLength(1);
    expect(s.usesOf('type:gaze')).toHaveLength(0);
  });

  test("in a browser, other videos are the other logs it keeps, by log, named by their titles; this video's other runs are not", async () => {
    const storage = new MemoryStorage(), A = 'a'.repeat(64);
    const own = new LocalCorrectionStore(A, storage, 'run2'), ownFirst = new LocalCorrectionStore(A, storage);
    const b = new LocalCorrectionStore('b'.repeat(64), storage), c = new LocalCorrectionStore('c'.repeat(64), storage);
    for (const st of [own, ownFirst]) await st.append([{ op: 'annotation.type', type: gaze }]);
    for (const st of [b, c]) { await st.append([{ op: 'annotation.type', type: mood }]); storage.setItem(st.key.replace(':corrections:', ':title:'), 'clip'); }
    expect(localTypesElsewhere(A, storage)).toEqual([{ key: b.key, title: 'clip', types: [mood] }, { key: c.key, title: 'clip', types: [mood] }]);
  });

  test("a cleared number range stays cleared when the log is read back", async () => {
    const storage = new MemoryStorage();
    const { s } = session(makeBundle(), storage);
    const n: AnnotationType = { id: 'type:n', name: 'Intensity', kind: 'number', target: 'scene', options: [], min: 0, max: 10 };
    await s.addType(n);
    await s.commit({ op: 'annotation.type_edit', id: 'type:n', fields: { min: null } });
    const again = session(makeBundle(), storage).s;
    await again.load();
    expect(again.typeOf('type:n')).toEqual({ ...n, min: undefined });
    expect('min' in again.typeOf('type:n')!).toBe(false);
  });
});

describe("an annotation's menu", () => {
  test('offers the people on screen during the annotation, most on screen first, and no one unknown', () => {
    const { s } = session();
    expect(s.peopleDuring({ start: 9, end: 16 })).toEqual(['person:Person A', 'person:Person C']);
    expect(s.peopleDuring({ start: 0, end: 3 })).toEqual(['person:Person A', 'person:Person B']);
    expect(s.peopleDuring({ start: 5, end: 9 })).toEqual([]);
  });

  test('deleting the selected annotation closes its menu, and undo brings it back', async () => {
    const { s } = session();
    await s.addType({ id: 'type:x', name: 'X', kind: 'binary', target: 'scene', options: [] });
    await s.addNote('type:x', 1, 2);
    const id = s.selection!.id;
    s.noteMenu = id;
    await s.deleteNote(id);
    expect(s.S.notes.has(id)).toBe(false);
    expect(s.selection).toBeNull();
    expect(s.noteMenu).toBeNull();
    await s.undo();
    expect(s.S.notes.has(id)).toBe(true);
  });
});
