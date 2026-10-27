// The annotated result of a bundle: the pipeline's output for one video with the user's edits applied, one
// self-describing file for analysis (format perception-annotated/1). Every answer comes from the Session (who a face
// is, who speaks, what is sent to agents), so the file says what the app shows. The model's answers are the same
// questions asked of a Session with no edits: a field is marked edited where a person set it, or where the answers
// differ. Ids are the bundle's own, so records join back to the bundle's files. The full op log travels as `edits`
// (a perception-corrections/2 file is `{ format, sha256, bundle, ops: edits }`).
import { follow, NOT_PERSON, UNKNOWN, type AnnotationType, type Note, type Op } from './corrections';
import { Session } from './session.svelte';
import { strictest } from '../library';
import type {
  BodiesLayer, BundleSummary, FaceTrack, FacesLayer, FacingEvent, FacingLayer, FileEntry, GazeEvent, GazeLayer,
  GestureEvent, GesturesLayer, HandsLayer, LayerBase, LicenceMode, Manifest, ObjectIdentity, ObjectsLayer, ObjectTrack,
  Person, Producer, ProsodyLayer, Shot, ShotsLayer, SoundEvent, SoundsLayer, Speaker, SpeakersLayer, TextItem, TextLayer,
  TranscriptLayer, Utterance,
} from '../types';

export const ANNOTATED_FORMAT = 'perception-annotated/1';

/** Who made a record: the pipeline, or a person in the Annotator. */
export type Source = 'model' | 'human';
/** On every record of a layer edits can change. `edited`: fields a person set (confirming the model's value counts)
 *  or that changed because of an edit (a merge, a rename, an exclusion); `model`: the model's value of each of them.
 *  A human record has neither: all of it is theirs. */
export interface Provenance { source: Source; edited: string[]; model: Record<string, unknown> }
export type Rec<T> = T & Provenance;

type Header = 'layer' | 'schema_version' | 'producer';
type Body<L extends LayerBase> = Omit<L, Header>;
/** A person's status after merges: themselves, merged into someone (`resolves_to`), or not a person. */
export type PersonStatus = 'person' | 'merged' | 'not_person' | 'unknown';

export interface AnnotatedPerson extends Person { name: string; status: PersonStatus; resolves_to: string; included: boolean }
export interface AnnotatedFace extends FaceTrack { person: string; person_name: string; included: boolean }
export interface AnnotatedUtterance extends Utterance {
  speaker: Speaker; speaker_person: string | null; speaker_name: string; included: boolean;
}
export interface AnnotatedIdentity extends Omit<ObjectIdentity, 'label'> {
  label: string | null; name: string; status: 'object' | 'merged'; resolves_to: string; included: boolean;
}

export interface AnnotatedLayers {
  shots: (Body<ShotsLayer> & { shots: Rec<Shot & { included: boolean }>[] }) | null;
  transcript: (Body<TranscriptLayer> & { voices: Rec<{ id: string; name: string }>[]; utterances: Rec<AnnotatedUtterance>[] }) | null;
  /** The speaker model's predictions, as the bundle has them: the speaker after edits is on each utterance. */
  speakers: Body<SpeakersLayer> | null;
  faces: (Body<FacesLayer> & {
    people: Rec<AnnotatedPerson>[]; tracks: Rec<AnnotatedFace>[];
    /** Pairs of people a person said are different (never suggested as one again). */
    distinct: [string, string][];
  }) | null;
  bodies: Body<BodiesLayer> | null;
  hands: Body<HandsLayer> | null;
  gestures: (Body<GesturesLayer> & { events: Rec<GestureEvent & { included: boolean }>[] }) | null;
  facing: (Body<FacingLayer> & { events: Rec<FacingEvent & { included: boolean }>[] }) | null;
  gaze: (Body<GazeLayer> & { events: Rec<GazeEvent & { included: boolean }>[] }) | null;
  objects: (Omit<Body<ObjectsLayer>, 'tracks' | 'identities'> & {
    tracks: Rec<ObjectTrack & { identity_name: string; included: boolean }>[]; identities: Rec<AnnotatedIdentity>[];
  }) | null;
  sounds: (Body<SoundsLayer> & {
    events: Rec<SoundEvent & { included: boolean }>[];
    /** Sound labels, and whether events with that label are sent to agents (an event's own setting wins). */
    categories: Rec<{ label: string; included: boolean }>[];
  }) | null;
  text: (Body<TextLayer> & { items: Rec<TextItem & { included: boolean }>[] }) | null;
  prosody: Body<ProsodyLayer> | null;
}
export type ExportedLayer = keyof AnnotatedLayers;
const EXPORTED: ExportedLayer[] = ['shots', 'transcript', 'speakers', 'faces', 'bodies', 'hands', 'gestures', 'facing', 'gaze',
  'objects', 'sounds', 'text', 'prosody'];   // the bundle's layers but the waveform, which is only for drawing

export interface LayerProvenance extends FileEntry {
  stage: string; licence_mode: LicenceMode; side_files: FileEntry[];
  schema_version: string | null; producer: Producer | null;
  /** Whether the layer is in this file (the waveform is not, nor a layer this app does not read). */
  exported: boolean;
}

export interface Annotated {
  format: typeof ANNOTATED_FORMAT;
  exported_at: string;
  legend: Record<string, string>;
  video: { sha256: string; title: string; filename: string | null; duration: number; fps: number; width: number; height: number };
  bundle: {
    /** The bundle's identity: its manifest's sha256 (null when unknown). */
    manifest_sha256: string | null;
    format: Manifest['format']; schema_version: string; created_at: string; pipeline: Manifest['pipeline'];
    /** The most restrictive licence among the exported layers: what anyone using this file must keep to. */
    strictest_licence: LicenceMode;
    layers: Record<string, LayerProvenance>;
  };
  layers: AnnotatedLayers;
  annotations: { types: Rec<AnnotationType>[]; notes: Rec<Note & { person_name: string | null }>[] };
  /** The op log, verbatim, oldest first. */
  edits: Op[];
}

const LEGEND: Record<string, string> = {
  source: 'Who made the record: "model" (the pipeline) or "human" (made in the Annotator).',
  edited: 'Fields of a model record a person set (confirming the model counts) or that an edit changed (a merge, rename or exclusion).',
  model: "The model's value of each edited field.",
  included: 'Whether the record is sent to agents; false: a person excluded it, or it follows an excluded person, object or category.',
  resolves_to: 'The person or object identity this one ended up as after merges (itself when not merged).',
  unknown: 'The person of faces the clusterer could not match (null in the bundle).',
  not_person: 'The person of false detections and faces in pictures or on screens.',
  edits: 'Every edit, oldest first: applying them to the bundle in order gives this file.',
};

// --- records --------------------------------------------------------------------------------------------------------

/** A field of a model record: its value after edits, the model's, and whether an op set it directly. */
interface Field { value: unknown; model: unknown; set?: boolean }
const f = (value: unknown, model: unknown, set = false): Field => ({ value, model, set });

function rec<T extends object, R>(base: T, fields: Record<string, Field>): Rec<R> {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  const edited: string[] = [], model: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(fields)) {
    out[k] = x.value ?? null;
    if (x.set || !same(x.value, x.model)) { edited.push(k); model[k] = x.model ?? null; }
  }
  return { ...out, source: 'model', edited, model } as Rec<R>;
}
const human = <T extends object>(x: T): Rec<T> => ({ ...x, source: 'human', edited: [], model: {} });

const same = (a: unknown, b: unknown) => canonical(a ?? null) === canonical(b ?? null);
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x);

function body<L extends LayerBase>(l: L): Body<L> {
  const { layer: _l, schema_version: _s, producer: _p, ...rest } = l;
  return rest;
}

const ids = (xs: { id: string }[] | undefined) => (xs ?? []).map((x) => x.id).sort().join('\n');
const has = (m: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(m, k);

// --- the document ---------------------------------------------------------------------------------------------------

/** The annotated result of the session's bundle: its layers with the session's edits applied, and the edits. `title`:
 *  the bundle's name as the library shows it (the video's file name without extension by default). */
export function annotated(s: Session, { title, exportedAt = new Date() }: { title?: string; exportedAt?: Date } = {}): Annotated {
  const b = s.bundle, M = b.manifest;
  // the model's answers: the same questions asked with no edits (ops start empty and are never loaded here)
  const m = new Session(b, s.store, s.view);
  const L = b.layers;

  const layers: AnnotatedLayers = {
    shots: L.shots && { ...body(L.shots), shots: L.shots.shots.map((x) => shot(s, m, x)) },
    transcript: L.transcript && {
      ...body(L.transcript),
      voices: L.transcript.voices.map((v) => rec(v, { name: f(s.voiceName(v.id), m.voiceName(v.id), has(s.S.voiceNames, v.id)) })),
      utterances: L.transcript.utterances.map((u) => utterance(s, m, u)),
    },
    speakers: L.speakers && body(L.speakers),
    faces: L.faces && faces(s, m, L.faces),
    bodies: L.bodies && body(L.bodies),
    hands: L.hands && body(L.hands),
    gestures: L.gestures && { ...body(L.gestures), events: L.gestures.events.map((x) => byId(s, m, x)) },
    facing: L.facing && { ...body(L.facing), events: L.facing.events.map((x) => byId(s, m, x)) },
    gaze: L.gaze && { ...body(L.gaze), events: L.gaze.events.map((x) => byId(s, m, x)) },
    objects: L.objects && objects(s, m, L.objects),
    sounds: L.sounds && sounds(s, m, L.sounds),
    text: L.text && { ...body(L.text), items: L.text.items.map((x) => byId(s, m, x)) },
    prosody: L.prosody && body(L.prosody),
  };
  for (const k of EXPORTED) (layers as unknown as Record<string, unknown>)[k] ??= null;   // a layer not run: null, never absent

  const provenance: Record<string, LayerProvenance> = {};
  for (const [name, e] of Object.entries(M.layers)) {
    const layer = (L as unknown as Record<string, LayerBase | null | undefined>)[name] ?? null;
    provenance[name] = {
      file: e.file, sha256: e.sha256, bytes: e.bytes, stage: e.stage, licence_mode: e.licence_mode, side_files: e.side_files ?? [],
      schema_version: layer?.schema_version ?? null, producer: layer?.producer ?? null,
      exported: (EXPORTED as string[]).includes(name) && !!layer,
    };
  }
  const licences = Object.fromEntries(Object.entries(provenance).filter(([, p]) => p.exported).map(([k, p]) => [k, p.licence_mode]));

  const types = s.S.types.filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i).map(human);   // the first wins, as typeOf
  const notes = [...s.S.notes.values()].sort((a, b) => a.start - b.start || a.end - b.end).map((n) => {
    const person = n.person ? s.root(n.person) : null;
    return human({ ...n, person, person_name: person ? s.nameOf(person) : null });
  });

  const doc: Annotated = {
    format: ANNOTATED_FORMAT,
    exported_at: exportedAt.toISOString(),
    legend: LEGEND,
    video: {
      sha256: b.sha256, title: title ?? M.video.filename?.replace(/\.[^.]+$/, '') ?? b.sha256.slice(0, 12),
      filename: M.video.filename ?? null, duration: M.video.duration, fps: M.video.fps, width: M.video.width, height: M.video.height,
    },
    bundle: {
      manifest_sha256: b.key ?? null, format: M.format, schema_version: M.schema_version, created_at: M.created_at, pipeline: M.pipeline,
      strictest_licence: strictest({ layers: licences } as BundleSummary),   // reads only the layers' licences
      layers: provenance,
    },
    layers,
    annotations: { types, notes },
    edits: s.ops as Op[],
  };
  // a plain copy: nothing shared with the bundle or the session, and no undefined values
  return JSON.parse(JSON.stringify(doc));
}

function shot(s: Session, m: Session, x: Shot) {
  const set = has(s.S.caption, x.id);
  const caption = set ? { ...(x.caption ?? {}), description: s.S.caption[x.id] } : x.caption;
  return rec<Shot, Shot & { included: boolean }>(x, {
    caption: f(caption, x.caption, set),
    included: f(s.includedId(x.id), m.includedId(x.id), has(s.S.included, x.id)),
  });
}

function utterance(s: Session, m: Session, u: Utterance) {
  const sp = s.speakerOf(u), msp = m.speakerOf(u);
  return rec<Utterance, AnnotatedUtterance>(u, {
    text: f(s.uttText(u), m.uttText(u), has(s.S.uttText, u.id)),
    speaker: f(sp, msp, s.reviewed(u)),
    speaker_person: f(s.speakerPerson(sp), m.speakerPerson(msp)),
    speaker_name: f(s.speakerName(sp), m.speakerName(msp)),
    included: f(s.includedId(u.id), m.includedId(u.id), has(s.S.included, u.id)),
  });
}

/** Utterance-like segments edits can only include or exclude. */
function byId<T extends { id: string }>(s: Session, m: Session, x: T) {
  return rec<T, T & { included: boolean }>(x, { included: f(s.includedId(x.id), m.includedId(x.id), has(s.S.included, x.id)) });
}

function status(p: string, root: string): PersonStatus {
  if (root === p) return 'person';
  return root === NOT_PERSON ? 'not_person' : root === UNKNOWN ? 'unknown' : 'merged';
}

/** When and where a person is on screen, from their tracks after edits. */
function onScreen(s: Session, p: string) {
  const tracks = [...(s.tracksOf.get(p) ?? [])].sort((a, b) => a.start - b.start);
  return { first_seen: tracks[0]?.start ?? null, seconds_on_screen: s.screenSeconds.get(p) ?? 0, shots: [...new Set(tracks.map((t) => t.shot))] };
}

function faces(s: Session, m: Session, layer: FacesLayer): NonNullable<AnnotatedLayers['faces']> {
  const machine = new Set(layer.people.map((p) => p.id));
  const person = (p: string) => {
    const root = s.root(p);
    const fields = {
      name: f(s.nameOf(p), m.nameOf(p), has(s.S.names, p)),
      status: f(status(p, root), 'person'),
      resolves_to: f(root, m.root(p)),
      // a merged person's faces follow the one they ended up as (as includedFace)
      included: f(s.includedPerson(root), m.includedPerson(p), has(s.S.included, root)),
      crop: f(s.cropOf(p), m.cropOf(p)),
    };
    return { root, fields };
  };
  const people: Rec<AnnotatedPerson>[] = layer.people.map((P) => {
    const { fields } = person(P.id);
    // the bundle's on-screen figures, recomputed only for a person whose tracks an edit changed
    const moved = ids(s.tracksOf.get(P.id)) !== ids(m.tracksOf.get(P.id));
    const now = moved ? onScreen(s, P.id) : P;
    return rec<Person, AnnotatedPerson>(P, {
      ...fields,
      first_seen: f(now.first_seen, P.first_seen), seconds_on_screen: f(now.seconds_on_screen, P.seconds_on_screen),
      shots: f(now.shots, P.shots),
    });
  });
  for (const p of new Set(s.S.created)) {
    if (machine.has(p)) continue;
    const { root, fields } = person(p);
    people.push(human<AnnotatedPerson>({
      id: p, name: s.nameOf(p), status: status(p, root), resolves_to: root, included: s.includedPerson(p), crop: fields.crop.value as string | null,
      ...onScreen(s, p),
    }));
  }

  const tracks = layer.tracks.map((t) => {
    const p = s.personOf(t), mp = m.personOf(t);
    return rec<FaceTrack, AnnotatedFace>(t, {
      person: f(p, mp, has(s.S.trackPerson, t.id)),
      person_name: f(s.nameOf(p), m.nameOf(mp)),
      included: f(s.includedFace(t), m.includedFace(t), has(s.S.included, t.id)),
    });
  });

  const distinct = new Map<string, [string, string]>();
  for (const op of s.ops) if (op.op === 'person.distinct') distinct.set([op.a, op.b].sort().join('\n'), [op.a, op.b]);
  return { ...body(layer), people, tracks, distinct: [...distinct.values()] };
}

function objects(s: Session, m: Session, layer: ObjectsLayer): NonNullable<AnnotatedLayers['objects']> {
  const S = s.S;
  const tracks = layer.tracks.map((o) => {
    const i = s.identityOf(o), mi = m.identityOf(o);
    return rec<ObjectTrack, ObjectTrack & { identity_name: string; included: boolean }>(o, {
      identity: f(i, mi, has(S.objTrackIdentity, o.id)),
      identity_name: f(s.objName(i), m.objName(mi)),
      included: f(s.includedObject(o), m.includedObject(o), has(S.included, o.id)),
    });
  });

  const fields = (i: string) => {
    const root = follow(S.objMergedInto, i);
    return {
      root,
      name: f(s.objName(i), m.objName(i), has(S.objNames, i)),
      status: f(root === i ? 'object' : 'merged', 'object'),
      resolves_to: f(root, i),
      included: f(s.includedIdentity(i), m.includedIdentity(i), has(S.included, i)),
      crop: f(s.objCrop(i), m.objCrop(i)),
    };
  };
  const members = (x: Session, i: string) => (x.objectsOf.get(i) ?? []).map((o) => o.id);
  const identities: Rec<AnnotatedIdentity>[] = layer.identities.map((I) => {
    const { root: _r, ...fs } = fields(I.id);
    const moved = ids(s.objectsOf.get(I.id)) !== ids(m.objectsOf.get(I.id));   // the bundle's list unless an edit changed it
    return rec<ObjectIdentity, AnnotatedIdentity>(I, { ...fs, tracks: f(moved ? members(s, I.id) : I.tracks, I.tracks) });
  });
  // identities made by the user: the ones the edits name that the bundle does not have
  const made = new Set<string>();
  for (const op of s.ops) {
    if (op.op === 'object.assign' || op.op === 'object.rename') made.add(op.identity);
    if (op.op === 'object.merge') { made.add(op.from); made.add(op.into); }
  }
  for (const i of made) {
    if (s.bundle.identity.has(i)) continue;
    const x = fields(i);
    identities.push(human<AnnotatedIdentity>({
      id: i, label: null, family: null, worn_by: [], name: x.name.value as string, status: x.status.value as 'object' | 'merged',
      resolves_to: x.root, included: x.included.value as boolean, crop: x.crop.value as string | null, tracks: members(s, i),
    }));
  }
  return { ...body(layer), tracks, identities };
}

function sounds(s: Session, m: Session, layer: SoundsLayer): NonNullable<AnnotatedLayers['sounds']> {
  const events = layer.events.map((e) => rec<SoundEvent, SoundEvent & { included: boolean }>(e, {
    included: f(s.includedSound(e), m.includedSound(e), has(s.S.included, e.id)),
  }));
  const labels = new Set(layer.events.map((e) => e.label));
  for (const k of Object.keys(s.S.category)) if (k.startsWith('sound:')) labels.add(k.slice('sound:'.length));
  const categories = [...labels].map((label) => {
    const k = `sound:${label}`;
    return rec<{ label: string }, { label: string; included: boolean }>({ label }, {
      included: f(s.S.category[k] ?? true, m.S.category[k] ?? true, has(s.S.category, k)),   // as includedSound
    });
  });
  return { ...body(layer), events, categories };
}

// --- the file -------------------------------------------------------------------------------------------------------

const FIRST = ['format', 'id', 'op'];
const keyOrder = (a: string, b: string) => {
  const i = FIRST.indexOf(a), j = FIRST.indexOf(b);
  if (i >= 0 || j >= 0) return (i < 0 ? FIRST.length : i) - (j < 0 ? FIRST.length : j);
  return a < b ? -1 : a > b ? 1 : 0;
};

/** The file's text. The top level keeps its order (what the file is, then the video and bundle, the layers, the edits
 *  last); below it keys are sorted ("id" and "op" first), so two exports of the same edits differ only in
 *  `exported_at`. Short arrays and objects (a box, a sample, an op) sit on one line. */
export function serialiseAnnotated(doc: Annotated, indent = 1): string {
  const pad = (d: number) => ' '.repeat(indent * d);
  const sorted = (v: unknown, top: boolean): unknown => {
    if (Array.isArray(v)) return v.map((x) => sorted(x, false));
    if (v && typeof v === 'object') {
      const entries = Object.entries(v).filter(([, x]) => x !== undefined);
      if (!top) entries.sort(([a], [b]) => keyOrder(a, b));
      return Object.fromEntries(entries.map(([k, x]) => [k, sorted(x, false)]));
    }
    return v;
  };
  const write = (v: unknown, d: number): string => {
    const flat = JSON.stringify(v);
    if (!v || typeof v !== 'object' || d > 0 && flat.length <= 100) return flat;
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      return `[\n${v.map((x) => pad(d + 1) + write(x, d + 1)).join(',\n')}\n${pad(d)}]`;
    }
    const entries = Object.entries(v);
    if (!entries.length) return '{}';
    return `{\n${entries.map(([k, x]) => `${pad(d + 1)}${JSON.stringify(k)}: ${write(x, d + 1)}`).join(',\n')}\n${pad(d)}}`;
  };
  return write(sorted(doc, true), 0) + '\n';
}
