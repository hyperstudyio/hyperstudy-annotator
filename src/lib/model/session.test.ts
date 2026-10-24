import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { Bundle, type Layers } from './bundle';
import { NOT_PERSON, UNKNOWN } from './corrections';
import { MemoryStorage, SHA, face, makeBundle } from './fixture.test-helpers';
import { Session, coVisible, stampAfter } from './session.svelte';
import { View } from './view.svelte';
import { LocalCorrectionStore } from '../source';

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

// The user's cleaned identity file from the prototype, against the bundle converted from the same run.
const RUN = '/Users/lukechang/Github/hyperstudy/.claude/worktrees/video-perception-bakeoff/tools/perception-bakeoff/runs/ooo-genz-clip1';
test.skipIf(!existsSync(`${RUN}/perception_corrections.json`))('the prototype\'s real corrections file imports with no unknown ids', async () => {
  const manifest = JSON.parse(readFileSync(`${RUN}/bundle/manifest.json`, 'utf8'));
  const layers = Object.fromEntries(['shots', 'transcript', 'speakers', 'faces', 'bodies', 'hands', 'gestures', 'facing', 'gaze', 'objects', 'sounds', 'text', 'prosody', 'waveform']
    .map((n) => [n, manifest.layers[n] && n !== 'bodies' && n !== 'hands' ? JSON.parse(readFileSync(`${RUN}/bundle/${manifest.layers[n].file}`, 'utf8')) : null])) as unknown as Layers;
  const s = new Session(new Bundle(manifest, layers), new LocalCorrectionStore(manifest.video.sha256, new MemoryStorage()), new View('x', null));
  const ops = await s.parseCorrections(readFileSync(`${RUN}/perception_corrections.json`, 'utf8'));
  expect(ops).toHaveLength(88);
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
    find: async (key: string) => versions[key] ? { id: key, label: key, corrections: 0, open: async () => ({ bundle: versions[key] }) } as never : null,
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
    expect(ops).toMatchObject([{ ...caption, carried_from: { bundle: 'other', index: 0 } }]);
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

  test('an old file that does not say its run is refused when the video has several runs, and imports when it has one', async () => {
    const { s } = session(makeBundle({}, 'this-run'));
    await expect(s.parseCorrections(file([caption]), lineage({ other: makeBundle({}, 'other') }), load)).rejects.toThrow(/does not say which run/);
    expect(await s.parseCorrections(file([caption]), lineage({}), load)).toEqual([caption]);
  });
});
