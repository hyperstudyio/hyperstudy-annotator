// A bundle's layers, loaded once and indexed. Immutable: corrections are folded over it elsewhere (corrections.ts),
// never written into it. Every layer is optional; a view whose layer is absent shows that it was not run.
import type { BundleSource } from '../source';
import type {
  BodiesLayer, BodyTrack, FaceTrack, FacesDetail, FacesLayer, FacingEvent, FacingLayer, GazeEvent, GazeLayer, GazeSample,
  GestureEvent, GesturesLayer,
  HandsLayer, HandTrack, Manifest, ObjectIdentity, ObjectTrack, ObjectsLayer, ProsodyLayer, ProsodyUtterance, Shot,
  ShotsLayer, SoundEvent, SoundsLayer, SpeakerPrediction, SpeakersLayer, Span, TextItem, TextLayer, TranscriptLayer,
  Utterance, WaveformLayer,
} from '../types';

export interface Layers {
  shots: ShotsLayer | null; transcript: TranscriptLayer | null; speakers: SpeakersLayer | null; faces: FacesLayer | null;
  bodies: BodiesLayer | null; hands: HandsLayer | null; gestures: GesturesLayer | null; facing: FacingLayer | null;
  gaze: GazeLayer | null; objects: ObjectsLayer | null; sounds: SoundsLayer | null; text: TextLayer | null;
  prosody: ProsodyLayer | null; waveform: WaveformLayer | null;
}
const NAMES: (keyof Layers)[] = ['shots', 'transcript', 'speakers', 'faces', 'bodies', 'hands', 'gestures', 'facing', 'gaze',
  'objects', 'sounds', 'text', 'prosody', 'waveform'];

const byId = <T extends { id: string }>(items: T[] | undefined) => new Map((items ?? []).map((x) => [x.id, x]));
function groupBy<T>(items: T[], key: (x: T) => string | null | undefined) {
  const m = new Map<string, T[]>();
  for (const x of items) { const k = key(x); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k)!.push(x); }
  return m;
}

export class Bundle {
  readonly manifest: Manifest;
  readonly layers: Layers;
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;

  readonly shots: Shot[];
  readonly utterances: Utterance[];
  readonly faces: FaceTrack[];
  readonly objects: ObjectTrack[];
  readonly sounds: SoundEvent[];
  readonly texts: TextItem[];
  readonly gestures: GestureEvent[];
  readonly facing: FacingEvent[];
  readonly gazeEvents: GazeEvent[];

  readonly shot: Map<string, Shot>;
  readonly utt: Map<string, Utterance>;
  readonly face: Map<string, FaceTrack>;
  readonly object: Map<string, ObjectTrack>;
  readonly identity: Map<string, ObjectIdentity>;
  readonly sound: Map<string, SoundEvent>;
  readonly text: Map<string, TextItem>;
  readonly gesture: Map<string, GestureEvent>;
  readonly facingEvent: Map<string, FacingEvent>;
  readonly gazeEvent: Map<string, GazeEvent>;
  readonly prediction: Map<string, SpeakerPrediction>;
  readonly prosodyOf: Map<string, ProsodyUtterance>;
  readonly facesByShot: Map<string, FaceTrack[]>;
  readonly objectsByShot: Map<string, ObjectTrack[]>;
  readonly bodiesByShot: Map<string, BodyTrack[]>;
  readonly bodiesByFace: Map<string, BodyTrack[]>;
  readonly handsByShot: Map<string, HandTrack[]>;
  readonly gazeOf: Map<string, GazeSample[]>;
  readonly voices: string[];
  /** py-feat per sample, loaded on demand (a large side file): see loadDetail(). */
  detail: FacesDetail | null = null;

  constructor(manifest: Manifest, layers: Layers) {
    this.manifest = manifest;
    this.layers = layers;
    this.duration = manifest.video.duration;
    this.width = manifest.video.width;
    this.height = manifest.video.height;
    this.sha256 = manifest.video.sha256;

    this.shots = [...(layers.shots?.shots ?? [])].sort((a, b) => a.start - b.start);
    this.utterances = [...(layers.transcript?.utterances ?? [])].sort((a, b) => a.start - b.start);
    this.faces = layers.faces?.tracks ?? [];
    this.objects = layers.objects?.tracks ?? [];
    this.sounds = [...(layers.sounds?.events ?? [])].sort((a, b) => a.start - b.start);
    this.texts = layers.text?.items ?? [];
    const sorted = <T extends Span>(xs: T[] | undefined) => [...(xs ?? [])].sort((a, b) => a.start - b.start);
    this.gestures = sorted(layers.gestures?.events);
    this.facing = sorted(layers.facing?.events);
    this.gazeEvents = sorted(layers.gaze?.events);

    this.shot = byId(this.shots);
    this.utt = byId(this.utterances);
    this.face = byId(this.faces);
    this.object = byId(this.objects);
    this.identity = byId(layers.objects?.identities);
    this.sound = byId(this.sounds);
    this.text = byId(this.texts);
    this.gesture = byId(this.gestures);
    this.facingEvent = byId(this.facing);
    this.gazeEvent = byId(this.gazeEvents);
    this.prediction = new Map((layers.speakers?.utterances ?? []).map((p) => [p.utt, p]));
    this.prosodyOf = new Map((layers.prosody?.utterances ?? []).map((p) => [p.utt, p]));
    this.facesByShot = groupBy(this.faces, (t) => t.shot);
    this.objectsByShot = groupBy(this.objects, (o) => o.shot);
    this.bodiesByShot = groupBy(layers.bodies?.tracks ?? [], (b) => b.shot);
    this.bodiesByFace = groupBy(layers.bodies?.tracks ?? [], (b) => b.face);
    this.handsByShot = groupBy(layers.hands?.hands ?? [], (h) => h.shot);
    this.gazeOf = new Map((layers.gaze?.tracks ?? []).map((g) => [g.face, g.samples]));
    this.voices = (layers.transcript?.voices ?? []).map((v) => v.id);
  }

  /** Load every layer the manifest lists. */
  static async load(source: BundleSource): Promise<Bundle> {
    const loaded = await Promise.all(NAMES.map((n) => source.layer<unknown>(n)));
    return new Bundle(source.manifest, Object.fromEntries(NAMES.map((n, i) => [n, loaded[i]])) as unknown as Layers);
  }

  async loadDetail(source: BundleSource): Promise<FacesDetail | null> {
    const file = this.layers.faces?.detail?.file;
    if (!file || this.detail) return this.detail;
    this.detail = await source.file<FacesDetail>(file);
    return this.detail;
  }

  /** Whether the bundle defines this id (corrections are checked against it before they are imported). */
  has(id: string): boolean {
    const [kind] = id.split(':', 1);
    switch (kind) {
      case 'face': return this.face.has(id);
      case 'person': return !!this.layers.faces?.people.some((p) => p.id === id);
      case 'utt': return this.utt.has(id);
      case 'shot': return this.shot.has(id);
      case 'voice': return this.voices.includes(id);
      case 'obj': return this.object.has(id);
      case 'objid': return this.identity.has(id);
      case 'sound': return this.sound.has(id);
      case 'text': return this.text.has(id);
      case 'gesture': return this.gesture.has(id);
      case 'facing': return this.facingEvent.has(id);
      case 'gaze': return this.gazeEvent.has(id);
      default: return false;
    }
  }

  /** The shot at time t (the last one starting at or before t). */
  shotAt(t: number): Shot | null {
    const s = this.shots;
    if (!s.length) return null;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid].start <= t) lo = mid; else hi = mid - 1; }
    return s[lo];
  }

  /** "shot:12" -> 12, the index people see as "shot 13". */
  shotNumber(id: string | null | undefined): number | null {
    return id ? this.shot.get(id)?.index ?? null : null;
  }
}

/** The extent of a set of spans, or null for none. */
export function extent(spans: Span[]): Span | null {
  if (!spans.length) return null;
  return { start: Math.min(...spans.map((s) => s.start)), end: Math.max(...spans.map((s) => s.end)) };
}
