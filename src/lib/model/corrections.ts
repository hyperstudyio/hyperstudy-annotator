// Corrections: an append-only log of ops over a bundle, folded into the corrected state every view reads.
// Ops reference bundle ids ("face:12", "person:Person C", "utt:5"). Ops committed together share `at`, and undo
// removes them together. The prototype's v1 files (bare numbers and labels) are converted by importV1().
import type { Speaker } from '../types';

export const FORMAT = 'perception-corrections/2';
/** Identities that are not machine clusters. Not "person:" ids, so they cannot collide with a bundle's. */
export const UNKNOWN = 'unknown';        // faces the clusterer could not match (bundle person: null)
export const NOT_PERSON = 'not_person';  // false detections, faces in pictures and on screens

export type ValueKind = 'binary' | 'category' | 'number' | 'text';
export interface AnnotationType { id: string; name: string; kind: ValueKind; target: 'person' | 'scene'; options: string[]; min?: number; max?: number }
/** A type's fields an edit changes. A range bound is cleared with null: an op is stored as JSON, which drops a key
 *  whose value is undefined, so the cleared bound would come back when the log is read. */
export type TypeFields = Partial<Omit<AnnotationType, 'id' | 'min' | 'max'>> & { min?: number | null; max?: number | null };
/** A type made from the form's draft: only what its kind uses (a range entered while it was a number, or categories
 *  while it was a category, would otherwise stay in the log and the export). */
export function newType(draft: AnnotationType, id: string): AnnotationType {
  const { name, kind, target, options, min, max } = draft;
  return { id, name: name.trim(), kind, target, options: kind === 'category' ? [...options] : [],
    ...(kind === 'number' && min !== undefined ? { min } : {}), ...(kind === 'number' && max !== undefined ? { max } : {}) };
}
/** The edit that changes a type's kind: what the old kind used (its categories, its range) goes with it. */
export function kindChange(kind: ValueKind): TypeFields {
  return { kind, ...(kind === 'category' ? {} : { options: [] }), ...(kind === 'number' ? {} : { min: null, max: null }) };
}
export function applyTypeFields(t: AnnotationType, fields: TypeFields) {
  for (const [k, v] of Object.entries(fields)) { if (v === null) delete t[k as 'min' | 'max']; else Object.assign(t, { [k]: v }); }
}
export interface Note { id: string; type: string; start: number; end: number; value: boolean | string | number | null; person: string | null }

/** `carried_from`: an op carried over from an earlier version's log (a re-run), naming the op it copies there.
 *  `reanchored_from`: an op imported from a file made on another run, naming that run and the op's place in the file. */
export type Op = { at?: string; carried_from?: { bundle: string; index: number }; reanchored_from?: { bundle: string; index: number } } & (
  | { op: 'person.create'; person: string; name: string }
  | { op: 'person.rename'; person: string; name: string }
  | { op: 'person.merge'; from: string; into: string }
  | { op: 'person.not_person'; person: string }
  | { op: 'person.distinct'; a: string; b: string }
  | { op: 'voice.rename'; voice: string; name: string }
  | { op: 'object.rename'; identity: string; name: string }
  | { op: 'object.merge'; from: string; into: string }
  | { op: 'object.assign'; track: string; identity: string }
  | { op: 'track.assign'; track: string; person: string }
  | { op: 'utterance.speaker'; utt: string; speaker: Speaker | null }
  | { op: 'utterance.text'; utt: string; text: string }
  | { op: 'shot.caption'; shot: string; caption: string }
  | { op: 'entity.include'; id: string; included: boolean }
  | { op: 'category.include'; kind: string; label: string; included: boolean }
  | { op: 'annotation.type'; type: AnnotationType }
  | { op: 'annotation.type_edit'; id: string; fields: TypeFields }
  | { op: 'annotation.type_delete'; id: string }
  | { op: 'annotation.add'; note: Note }
  | { op: 'annotation.edit'; id: string; fields: Partial<Omit<Note, 'id' | 'type'>> }
  | { op: 'annotation.delete'; id: string }
);

/** The log folded: what every op so far adds up to. */
export interface Corrected {
  names: Record<string, string>;        // person -> name
  voiceNames: Record<string, string>;
  mergedInto: Record<string, string>;   // person -> person (follow with root())
  created: string[];                    // people made by the user
  distinct: Set<string>;                // pairKey(a, b) the user said are different people
  trackPerson: Record<string, string>;  // face track -> person
  uttSpeaker: Record<string, Speaker>;
  uttText: Record<string, string>;
  caption: Record<string, string>;      // shot -> caption
  included: Record<string, boolean>;    // any bundle id (or person) -> sent to agents?
  category: Record<string, boolean>;    // "sound:<label>" -> sent to agents?
  objNames: Record<string, string>;
  objMergedInto: Record<string, string>;
  objTrackIdentity: Record<string, string>;
  types: AnnotationType[];
  notes: Map<string, Note>;
}

export const pairKey = (a: string, b: string) => [a, b].sort().join('|');

/** Follow merges to the identity something ended up in. */
export function follow(map: Record<string, string>, id: string): string {
  for (let i = 0; map[id] && i < 1000; i++) id = map[id];
  return id;
}

export function fold(ops: Op[]): Corrected {
  const S: Corrected = {
    names: {}, voiceNames: {}, mergedInto: {}, created: [], distinct: new Set(), trackPerson: {}, uttSpeaker: {},
    uttText: {}, caption: {}, included: {}, category: {}, objNames: {}, objMergedInto: {}, objTrackIdentity: {},
    types: [], notes: new Map(),
  };
  for (const op of ops) {
    switch (op.op) {
      case 'person.create': S.created.push(op.person); S.names[op.person] = op.name; break;
      case 'person.rename': S.names[op.person] = op.name; break;
      case 'person.merge': { const a = follow(S.mergedInto, op.from), b = follow(S.mergedInto, op.into); if (a !== b) S.mergedInto[a] = b; break; }
      case 'person.not_person': { const a = follow(S.mergedInto, op.person); if (a !== NOT_PERSON) S.mergedInto[a] = NOT_PERSON; break; }
      case 'person.distinct': S.distinct.add(pairKey(op.a, op.b)); break;
      case 'voice.rename': S.voiceNames[op.voice] = op.name; break;
      case 'object.rename': S.objNames[op.identity] = op.name; break;
      case 'object.merge': { const a = follow(S.objMergedInto, op.from), b = follow(S.objMergedInto, op.into); if (a !== b) S.objMergedInto[a] = b; break; }
      case 'object.assign': S.objTrackIdentity[op.track] = op.identity; break;
      case 'track.assign': S.trackPerson[op.track] = op.person; break;
      case 'utterance.speaker': if (op.speaker) S.uttSpeaker[op.utt] = op.speaker; else delete S.uttSpeaker[op.utt]; break;
      case 'utterance.text': S.uttText[op.utt] = op.text; break;
      case 'shot.caption': S.caption[op.shot] = op.caption; break;
      case 'entity.include': S.included[op.id] = op.included; break;
      case 'category.include': S.category[`${op.kind}:${op.label}`] = op.included; break;
      // a copy, so a later edit does not change the op; v1 imports stored types without options
      case 'annotation.type': S.types.push({ ...op.type, options: op.type.options ?? [] }); break;
      case 'annotation.type_edit': {
        const t = S.types.find((x) => x.id === op.id);
        if (t) applyTypeFields(t, op.fields);
        break;
      }
      case 'annotation.type_delete': S.types = S.types.filter((x) => x.id !== op.id); break;
      case 'annotation.add': S.notes.set(op.note.id, { ...op.note }); break;
      case 'annotation.edit': { const n = S.notes.get(op.id); if (n) Object.assign(n, op.fields); break; }
      case 'annotation.delete': S.notes.delete(op.id); break;
    }
  }
  return S;
}

/** The annotation types other videos' logs define, by video (to copy from one); videos with none are left out. */
export function typesIn(logs: { key: string; title: string; ops: Op[] }[]): { key: string; title: string; types: AnnotationType[] }[] {
  return logs.map(({ key, title, ops }) => ({ key, title, types: fold(ops).types.filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i) }))
    .filter((x) => x.types.length);
}

/** Ops from the last commit: they share its timestamp. */
export function lastBatch(ops: Op[]): number {
  if (!ops.length) return 0;
  const at = ops[ops.length - 1].at;
  let n = 0;
  while (n < ops.length && ops[ops.length - 1 - n].at === at) n++;
  return n;
}

// --- the prototype's v1 files ------------------------------------------------------------------------------------

/** `bundle`: the manifest sha256 of the bundle the ops were made on (exports from 2026-10-24 on; older files say only
 *  which video). */
export interface CorrectionsFile { format: string; sha256: string; bundle?: string; exported_at?: string; ops: unknown[] }

/** Thrown when a v1 op refers to something this bundle has no id for; the import is refused as a whole. */
export class ImportError extends Error {}

/** A file that does not say which run it was made on, for a video the library has several runs of: the user says
 *  whether it was made on this one (then parseCorrections with `thisRun`). */
export class RunUnknownError extends ImportError {
  constructor(readonly runs: number) {
    super(`the file does not say which run of this video it was made on, and the library has ${runs} runs of it`);
  }
}

const v1Person = (p: unknown): string => {
  if (p === 'Unknown') return UNKNOWN;
  if (p === '__not_person') return NOT_PERSON;
  if (typeof p !== 'string' || !p) throw new ImportError(`unreadable person ${JSON.stringify(p)}`);
  return `person:${p}`;
};
const v1Num = (kind: string) => (n: unknown): string => {
  if (typeof n !== 'number' && !(typeof n === 'string' && /^\d+$/.test(n))) throw new ImportError(`unreadable ${kind} ${JSON.stringify(n)}`);
  return `${kind}:${n}`;
};
const v1Face = v1Num('face'), v1Utt = v1Num('utt'), v1Shot = v1Num('shot');

function v1Speaker(sp: Record<string, unknown> | null): Speaker | null {
  if (!sp) return null;
  switch (sp.kind) {
    case 'face': return { kind: 'face', face: v1Face(sp.track) };
    case 'person': return { kind: 'person', person: v1Person(sp.person) };
    case 'offscreen': return { kind: 'offscreen', voice: sp.voice ? `voice:${sp.voice}` : null };
    case 'multiple': case 'unsure': case 'not_speech': return { kind: sp.kind };
    default: throw new ImportError(`unknown speaker kind ${JSON.stringify(sp.kind)}`);
  }
}

/** An entity.include id from v1 ("track:12", "person:Person C", "objtrack:obj:3", "object:hat 1", "sound:4"). */
function v1IncludeId(id: string): string {
  const [kind, rest] = id.split(/:(.*)/s);
  switch (kind) {
    case 'track': return v1Face(rest);
    case 'person': return v1Person(rest);
    case 'objtrack': return rest;                // v1 object track ids were already "obj:N"
    case 'object': return `objid:${rest}`;
    case 'utt': case 'shot': case 'sound': case 'text': case 'gesture': case 'facing': return id;
    default: throw new ImportError(`cannot map ${id}: the bundle has no such layer`);
  }
}

/** Convert one v1 op (bare numbers and labels) to bundle ids. */
export function opFromV1(raw: Record<string, any>): Op {
  const at = raw.at as string | undefined;
  switch (raw.op) {
    case 'person.create': return { op: raw.op, person: v1Person(raw.person), name: raw.name, at };
    case 'person.rename': return { op: raw.op, person: v1Person(raw.person), name: raw.name, at };
    case 'person.merge': return { op: raw.op, from: v1Person(raw.from), into: v1Person(raw.into), at };
    case 'person.not_person': return { op: raw.op, person: v1Person(raw.person), at };
    case 'person.distinct': return { op: raw.op, a: v1Person(raw.a), b: v1Person(raw.b), at };
    case 'voice.rename': return { op: raw.op, voice: `voice:${raw.voice}`, name: raw.name, at };
    case 'object.rename': return { op: raw.op, identity: `objid:${raw.identity}`, name: raw.name, at };
    case 'object.merge': return { op: raw.op, from: `objid:${raw.from}`, into: `objid:${raw.into}`, at };
    case 'object.assign': return { op: raw.op, track: raw.track, identity: `objid:${raw.identity}`, at };
    case 'track.assign': return { op: raw.op, track: v1Face(raw.track), person: v1Person(raw.person), at };
    case 'utterance.speaker': return { op: raw.op, utt: v1Utt(raw.utt), speaker: v1Speaker(raw.speaker), at };
    case 'utterance.text': return { op: raw.op, utt: v1Utt(raw.utt), text: raw.text, at };
    case 'shot.caption': return { op: raw.op, shot: v1Shot(raw.shot), caption: raw.caption, at };
    case 'entity.include': return { op: raw.op, id: v1IncludeId(raw.id), included: raw.included, at };
    case 'category.include': return { op: raw.op, kind: raw.kind, label: raw.label, included: raw.included, at };
    // types made before value kinds existed carried only `options`: categories if any, else free text
    case 'annotation.type': return { op: raw.op, type: { kind: raw.type.options?.length ? 'category' : 'text', ...raw.type, options: raw.type.options ?? [] }, at };
    case 'annotation.add': return { op: raw.op, note: { ...raw.note, person: raw.note.person ? v1Person(raw.note.person) : null }, at };
    case 'annotation.edit': return { op: raw.op, id: raw.id, fields: raw.fields.person ? { ...raw.fields, person: v1Person(raw.fields.person) } : raw.fields, at };
    case 'annotation.delete': return { op: raw.op, id: raw.id, at };
    default: throw new ImportError(`unknown op ${JSON.stringify(raw.op)}`);
  }
}

/** An edits file from what was picked: an Export (`perception-annotated/1`, annotated.ts) carries its edits, the video
 *  and the run they were made on, so it imports as the edits file it holds; any other document is taken as it is. */
export function editsFile(doc: any): CorrectionsFile {
  if (doc?.format !== 'perception-annotated/1') return doc;
  return { format: FORMAT, sha256: doc.video?.sha256, bundle: doc.bundle?.manifest_sha256 ?? undefined, exported_at: doc.exported_at, ops: doc.edits ?? [] };
}

/** Read an exported corrections file (v1 from the prototype, or this app's v2) for a bundle's video. */
export function readCorrectionsFile(doc: CorrectionsFile, videoSha256: string): Op[] {
  if (doc.sha256 !== videoSha256) throw new ImportError('that file is for a different video');
  if (doc.format === FORMAT) return doc.ops as Op[];
  if (doc.format === 'perception-corrections/1') return doc.ops.map((o) => opFromV1(o as Record<string, any>));
  throw new ImportError(`unknown corrections format ${JSON.stringify(doc.format)}`);
}

/** Bundle ids an op refers to that the bundle does not define (checked before an import is accepted). */
export function unknownRefs(ops: Op[], has: (id: string) => boolean): string[] {
  const refs = new Set<string>();
  const check = (id: string | null | undefined) => { if (id && /^(face|utt|shot|voice|obj|objid|sound|text|gesture|facing|gaze):/.test(id) && !has(id)) refs.add(id); };
  for (const op of ops) {
    switch (op.op) {
      case 'track.assign': check(op.track); break;
      case 'utterance.speaker': check(op.utt); if (op.speaker?.kind === 'face') check(op.speaker.face); if (op.speaker?.kind === 'offscreen') check(op.speaker.voice); break;
      case 'utterance.text': check(op.utt); break;
      case 'shot.caption': check(op.shot); break;
      case 'entity.include': check(op.id); break;
      case 'object.assign': check(op.track); break;
      case 'voice.rename': check(op.voice); break;
    }
  }
  return [...refs];
}
