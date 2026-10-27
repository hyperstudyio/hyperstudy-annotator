import { describe, expect, test } from 'vitest';
import { ANNOTATED_FORMAT, annotated, serialiseAnnotated, type Annotated } from './annotated';
import { Bundle } from './bundle';
import { FORMAT, NOT_PERSON, UNKNOWN, fold, readCorrectionsFile, type Op } from './corrections';
import { MemoryStorage, SHA, makeBundle } from './fixture.test-helpers';
import { Session } from './session.svelte';
import { View } from './view.svelte';
import { LocalCorrectionStore } from '../source';
import type { LicenceMode, ObjectsLayer } from '../types';

const producer = { stage: 't', stage_version: '0', models: [{ id: 'm', source: null, revision: null, licence: null, licence_mode: 'commercial-ok' as const }],
  config: {}, device: null, run_at: null, timings: {} };
const base = (layer: string) => ({ layer, schema_version: '0.1.0', producer });
const AT = new Date('2026-10-26T12:00:00Z');
const KEY = 'b'.repeat(64);

/** The fixture with objects and a waveform, and a manifest listing its layers. */
function bundle(): Bundle {
  const objects: ObjectsLayer = { ...base('objects'), fps: 8,
    tracks: [
      { id: 'obj:0', label: 'cup', identity: 'objid:cup 1', shot: 'shot:0', start: 0, end: 3, samples: [] },
      { id: 'obj:1', label: 'cup', identity: 'objid:cup 2', shot: 'shot:1', start: 10, end: 12, samples: [] },
      { id: 'obj:2', label: 'hat', identity: 'objid:hat 1', shot: 'shot:1', start: 15, end: 18, samples: [] },
    ],
    identities: [
      { id: 'objid:cup 1', label: 'cup', worn_by: [], tracks: ['obj:0'], crop: null },
      { id: 'objid:cup 2', label: 'cup', worn_by: [], tracks: ['obj:1'], crop: null },
      { id: 'objid:hat 1', label: 'hat', worn_by: [], tracks: ['obj:2'], crop: null },
    ] };
  const b = makeBundle({ objects, waveform: { ...base('waveform'), hz: 50, peaks: [0.1, 0.5, 0.2] } }, KEY);
  const licence = (n: string): LicenceMode => (n === 'faces' ? 'academic-only' : n === 'waveform' ? 'needs-review' : 'commercial-ok');
  const layers = Object.fromEntries(['shots', 'transcript', 'speakers', 'faces', 'objects', 'sounds', 'waveform'].map((n) =>
    [n, { file: `layers/${n}.json`, sha256: 'a'.repeat(64), bytes: 100, stage: `stage.${n}`, licence_mode: licence(n) }]));
  return new Bundle({ ...b.manifest, layers }, b.layers, b.key);
}
function session() {
  const b = bundle();
  return new Session(b, new LocalCorrectionStore(b.sha256, new MemoryStorage()), new View(b.sha256, new MemoryStorage()));
}

/** Every record carrying provenance, anywhere in the document. */
function records(x: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(x)) x.forEach((y) => records(y, out));
  else if (x && typeof x === 'object') {
    if ('source' in x && 'edited' in x) out.push(x as Record<string, unknown>);
    Object.values(x).forEach((y) => records(y, out));
  }
  return out;
}
const byId = <T extends { id: string }>(xs: T[] | undefined, id: string): T => xs!.find((x) => x.id === id)!;

/** A realistic session: a rename, a merge, not a person, a new person with a track, an utterance's text and speaker,
 *  a caption, exclusions, objects, and an annotation. */
async function edited(): Promise<{ s: Session; doc: Annotated }> {
  const s = session();
  await s.commit({ op: 'person.rename', person: 'person:Person A', name: 'Alice' });
  await s.commit({ op: 'person.merge', from: 'person:Person B', into: 'person:Person A' });
  await s.commit({ op: 'person.not_person', person: 'person:Person C' });
  await s.commit({ op: 'person.create', person: 'person:user:1', name: 'Dan' }, { op: 'track.assign', track: 'face:3', person: 'person:user:1' });
  await s.commit({ op: 'person.distinct', a: 'person:Person A', b: 'person:user:1' });
  await s.commit({ op: 'utterance.text', utt: 'utt:2', text: 'hello there' });
  await s.commit({ op: 'utterance.speaker', utt: 'utt:3', speaker: { kind: 'person', person: 'person:Person B' } });
  await s.commit({ op: 'shot.caption', shot: 'shot:1', caption: 'a kitchen' });
  await s.commit({ op: 'entity.include', id: 'utt:1', included: false });
  await s.commit({ op: 'category.include', kind: 'sound', label: 'laughter', included: false });
  await s.commit({ op: 'object.rename', identity: 'objid:cup 1', name: 'mug' });
  await s.commit({ op: 'object.merge', from: 'objid:cup 2', into: 'objid:cup 1' });
  await s.commit({ op: 'object.assign', track: 'obj:2', identity: 'objid:user:1' }, { op: 'object.rename', identity: 'objid:user:1', name: 'red hat' });
  await s.commit({ op: 'annotation.type', type: { id: 'type:1', name: 'Smiles', kind: 'binary', target: 'person', options: [] } });
  await s.commit({ op: 'annotation.add', note: { id: 'note:1', type: 'type:1', start: 1, end: 2, value: true, person: 'person:Person B' } });
  return { s, doc: annotated(s, { title: 'Clip one', exportedAt: AT }) };
}

describe('the annotated result', () => {
  test('with no edits every value is the model\'s, marked as such, and the edit log is empty', () => {
    const s = session();
    const doc = annotated(s, { exportedAt: AT });
    const L = doc.layers;
    expect(doc.format).toBe(ANNOTATED_FORMAT);
    expect(doc.exported_at).toBe(AT.toISOString());
    expect(doc.edits).toEqual([]);
    expect(doc.annotations).toEqual({ types: [], notes: [] });

    const recs = records(doc.layers);
    expect(recs.length).toBeGreaterThan(20);
    for (const r of recs) {
      expect(r.source).toBe('model');
      expect(r.edited).toEqual([]);
      expect(r.model).toEqual({});
    }
    // the bundle's values, with the session's answers added
    expect(L.faces!.tracks.map((t) => t.person)).toEqual(['person:Person A', 'person:Person B', 'person:Person A', UNKNOWN, 'person:Person C']);
    expect(byId(L.faces!.people, 'person:Person A')).toMatchObject({ name: 'Person A', status: 'person', resolves_to: 'person:Person A',
      included: true, seconds_on_screen: 1, shots: [] });   // the bundle's figures, not recomputed
    expect(L.transcript!.utterances.map((u) => u.text)).toEqual(s.bundle.utterances.map((u) => u.text));
    expect(byId(L.transcript!.utterances, 'utt:0')).toMatchObject({ speaker: { kind: 'face', face: 'face:0' }, speaker_person: 'person:Person A',
      speaker_name: 'Person A', included: true });
    expect(byId(L.shots!.shots, 'shot:0').caption).toEqual({ description: 'two people' });
    expect(L.sounds!.categories.map((c) => [c.label, c.included])).toEqual([['music', true], ['laughter', true]]);
    expect(L.speakers!.utterances).toEqual(s.bundle.layers.speakers!.utterances);   // carried through as it is
    expect(L.faces!.person_pairs).toEqual(s.bundle.layers.faces!.person_pairs);

    // self-describing: the video, the bundle it came from, the strictest licence of what is in the file
    expect(doc.video).toEqual({ sha256: SHA, title: 'clip', filename: 'clip.mp4', duration: 20, fps: 25, width: 1920, height: 1080 });
    expect(doc.bundle).toMatchObject({ manifest_sha256: KEY, schema_version: '0.1.0', strictest_licence: 'academic-only' });
    expect(doc.bundle.layers.faces).toMatchObject({ stage: 'stage.faces', licence_mode: 'academic-only', schema_version: '0.1.0', exported: true,
      file: 'layers/faces.json' });
    expect(doc.bundle.layers.objects.producer!.models[0].id).toBe('m');   // models per layer, from its producer
    expect(L.faces).not.toHaveProperty('producer');   // provenance is under bundle.layers, once
  });

  test('a realistic sequence of edits shows up applied and marked human, with merges resolved', async () => {
    const { doc } = await edited();
    const L = doc.layers, faces = L.faces!;
    expect(doc.video.title).toBe('Clip one');

    // people: renamed, merged, not a person, made by the user
    expect(byId(faces.people, 'person:Person A')).toMatchObject({ name: 'Alice', status: 'person', resolves_to: 'person:Person A', source: 'model',
      seconds_on_screen: 12, shots: ['shot:0', 'shot:1'] });
    expect(byId(faces.people, 'person:Person A').edited).toEqual(['name', 'seconds_on_screen', 'shots']);
    expect(byId(faces.people, 'person:Person A').model).toEqual({ name: 'Person A', seconds_on_screen: 1, shots: [] });
    expect(byId(faces.people, 'person:Person B')).toMatchObject({ status: 'merged', resolves_to: 'person:Person A', seconds_on_screen: 0 });
    expect(byId(faces.people, 'person:Person B').edited).toEqual(expect.arrayContaining(['status', 'resolves_to']));
    expect(byId(faces.people, 'person:Person C')).toMatchObject({ status: 'not_person', resolves_to: NOT_PERSON, included: false });
    expect(byId(faces.people, 'person:user:1')).toMatchObject({ name: 'Dan', status: 'person', source: 'human', seconds_on_screen: 2,
      first_seen: 10, shots: ['shot:1'], edited: [] });
    expect(faces.distinct).toEqual([['person:Person A', 'person:user:1']]);

    // face tracks with their final person
    const track = (id: string) => byId(faces.tracks, id);
    expect(track('face:0')).toMatchObject({ person: 'person:Person A', person_name: 'Alice', edited: ['person_name'], model: { person_name: 'Person A' } });
    expect(track('face:1')).toMatchObject({ person: 'person:Person A', person_name: 'Alice', model: { person: 'person:Person B', person_name: 'Person B' } });
    expect(track('face:3')).toMatchObject({ person: 'person:user:1', person_name: 'Dan', model: { person: UNKNOWN } });
    expect(track('face:4')).toMatchObject({ person: NOT_PERSON, person_name: 'Not a person', included: false });
    expect(track('face:4').edited).toEqual(['person', 'person_name', 'included']);

    // utterances: final text and speaker, the speaker resolved through the merge
    const utt = (id: string) => byId(L.transcript!.utterances, id);
    expect(utt('utt:2')).toMatchObject({ text: 'hello there', edited: ['text'], model: { text: 'utterance 2' } });
    expect(utt('utt:3')).toMatchObject({ speaker: { kind: 'person', person: 'person:Person B' }, speaker_person: 'person:Person A',
      speaker_name: 'Alice (not on screen)', model: { speaker: { kind: 'offscreen', voice: 'voice:SPEAKER_00' } } });
    expect(utt('utt:3').edited).toEqual(['speaker', 'speaker_person', 'speaker_name']);
    expect(utt('utt:0')).toMatchObject({ speaker_name: 'Alice', edited: ['speaker_name'] });   // not reviewed, but the person was renamed
    expect(utt('utt:1')).toMatchObject({ included: false, speaker_person: 'person:Person A', speaker_name: 'Alice' });
    expect(utt('utt:1').edited).toContain('included');

    // shots, sounds
    expect(byId(L.shots!.shots, 'shot:1')).toMatchObject({ caption: { description: 'a kitchen' }, edited: ['caption'], model: { caption: null } });
    expect(byId(L.shots!.shots, 'shot:0').edited).toEqual([]);
    expect(byId(L.sounds!.events, 'sound:1')).toMatchObject({ included: false, edited: ['included'], model: { included: true } });
    expect(L.sounds!.categories.find((c) => c.label === 'laughter')).toMatchObject({ included: false, edited: ['included'] });

    // objects: renamed, merged, assigned to an identity the user made
    const objs = L.objects!;
    expect(byId(objs.tracks, 'obj:1')).toMatchObject({ identity: 'objid:cup 1', identity_name: 'mug', model: { identity: 'objid:cup 2', identity_name: 'cup 2' } });
    expect(byId(objs.tracks, 'obj:2')).toMatchObject({ identity: 'objid:user:1', identity_name: 'red hat' });
    expect(byId(objs.identities, 'objid:cup 1')).toMatchObject({ name: 'mug', tracks: ['obj:0', 'obj:1'], edited: ['name', 'tracks'] });
    expect(byId(objs.identities, 'objid:cup 2')).toMatchObject({ status: 'merged', resolves_to: 'objid:cup 1', tracks: [] });
    expect(byId(objs.identities, 'objid:user:1')).toMatchObject({ source: 'human', name: 'red hat', tracks: ['obj:2'], status: 'object' });

    // annotations: the type, and the note's person resolved through the merge
    expect(doc.annotations.types).toEqual([{ id: 'type:1', name: 'Smiles', kind: 'binary', target: 'person', options: [], source: 'human', edited: [], model: {} }]);
    expect(doc.annotations.notes).toEqual([{ id: 'note:1', type: 'type:1', start: 1, end: 2, value: true, person: 'person:Person A',
      person_name: 'Alice', source: 'human', edited: [], model: {} }]);

    // nothing a person did not touch is marked
    expect(byId(faces.tracks, 'face:2').edited).toEqual(['person_name']);
    expect(byId(L.transcript!.voices, 'voice:SPEAKER_01').edited).toEqual([]);
  });

  test('the edit log round-trips', async () => {
    const { s, doc } = await edited();
    expect(doc.edits).toEqual(s.ops);
    expect(doc.edits).not.toBe(s.ops);   // a copy
    // an old-style corrections file derives from it, and folds to the same state
    const file = { format: FORMAT, sha256: doc.video.sha256, bundle: doc.bundle.manifest_sha256 ?? undefined, ops: doc.edits as unknown[] };
    expect(readCorrectionsFile(file, SHA)).toEqual(s.ops);
    expect(fold(doc.edits as Op[])).toEqual(s.S);
  });

  test('an exported file imports as the edits it carries', async () => {
    const { s, doc } = await edited();
    const into = session();
    expect(await into.parseCorrections(serialiseAnnotated(doc))).toEqual(s.ops);
  });

  test('the file has no waveform and is plain JSON', async () => {
    const { doc } = await edited();
    expect(doc.layers).not.toHaveProperty('waveform');
    expect(doc.bundle.layers.waveform).toMatchObject({ exported: false });
    expect(doc.bundle.strictest_licence).toBe('academic-only');   // the waveform's needs-review does not count: it is not in the file
    expect(JSON.parse(JSON.stringify(doc))).toStrictEqual(doc);

    const text = serialiseAnnotated(doc);
    expect(text).not.toContain('peaks');
    expect(JSON.parse(text)).toStrictEqual(doc);
    expect(Object.keys(JSON.parse(text))).toEqual(['format', 'exported_at', 'legend', 'video', 'bundle', 'layers', 'annotations', 'edits']);
    expect(text.startsWith(`{\n "format": "${ANNOTATED_FORMAT}",`)).toBe(true);
    // the same content in another key order: the same text
    const reversed = (x: unknown): unknown => Array.isArray(x) ? x.map(reversed)
      : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).reverse().map(([k, v]) => [k, reversed(v)])) : x;
    expect(serialiseAnnotated({ ...doc, layers: reversed(doc.layers), edits: reversed(doc.edits) } as Annotated)).toBe(text);
  });
});
