// An open bundle: the bundle itself, the corrections folded over it, the selection, the per-viewer layout and
// playback. Every view asks the session its questions (who a face is, who speaks, what is sent to agents, what the
// review queue holds), so the answers are the same everywhere and folded from the same op log.
import { Bundle, extent } from './bundle';
import { iou } from '../geometry';
import {
  FORMAT, ImportError, NOT_PERSON, UNKNOWN, follow, fold, lastBatch, pairKey, readCorrectionsFile, unknownRefs,
  type AnnotationType, type CorrectionsFile, type Note, type Op,
} from './corrections';
import { View, type Tab } from './view.svelte';
import { Playback } from '../playback.svelte';
import type { CarryRecord, CorrectionStore } from '../source';
import type {
  FaceTrack, FacesDetail, FacingEvent, GazeEvent, GestureEvent, ObjectTrack, Shot, SoundEvent, Span, Speaker, TextItem, Utterance,
} from '../types';

export const UNCERTAIN_GAP = 1.0;        // LR-ASD top-two gap below which an utterance is queued (holds 6 of 7 errors on OOO)
export const SIMILAR_DISTANCE = 0.75;    // ArcFace centroid distance below which two people are suggested as one
// Pairs of one person's face tracks detected in the same frames at different places: impossible for one person.
// Span overlap alone is not enough (a long track with gaps interleaves with others), so this needs CO_VISIBLE_MIN
// shared sample times whose boxes barely overlap (two boxes on one face would overlap).
export const CO_VISIBLE_MIN = 2, SAME_FACE_IOU = 0.3;

/** A lightbox over everything: every track of a person, one track's crop, two people side by side, an image. */
export type Lightbox = { kind: 'person'; person: string } | { kind: 'face'; face: string } | { kind: 'compare'; a: string; b: string }
  | { kind: 'image'; title: string; src: string };

export type SelKind = 'face' | 'person' | 'utt' | 'sound' | 'text' | 'shot' | 'note' | 'object' | 'objid' | 'gesture' | 'facing' | 'gaze';
export interface Selection { kind: SelKind; id: string }
/** A segment of a timeline row: what arrow keys step through. */
export interface Segment { kind: SelKind; id: string; span: Span }

const PALETTE = ['#4caf50', '#3b82f6', '#f59e0b', '#ec4899', '#14b8a6', '#a78bfa', '#ef4444', '#84cc16', '#06b6d4', '#f97316', '#e879f9', '#facc15'];
const OBJ_PALETTE = ['#90caf9', '#ffcc80', '#a5d6a7', '#f48fb1', '#80deea', '#ce93d8', '#fff59d', '#bcaaa4'];
export const NEUTRAL = '#8a8a8a';
const NOT_CLIPS = new Set<SelKind>(['person', 'objid']);   // identities span many shots; they are not a clip to play
export const VALUE_KINDS = { binary: 'Yes / no', category: 'Category', number: 'Number', text: 'Text' } as const;

export const sameSpan = (a: Span | null, b: Span | null) => !!a && !!b && Math.abs(a.start - b.start) < 1e-3 && Math.abs(a.end - b.end) < 1e-3;
export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const byStart = (list: Segment[]) => list.sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end);
const stripKind = (id: string) => id.replace(/^[a-z]+:/, '');

/** Face tracks of one person that are on screen together at different places (so one of them is someone else). */
export function coVisible(tracks: FaceTrack[]): [FaceTrack, FaceTrack][] {
  const pairs: [FaceTrack, FaceTrack][] = [];
  for (let i = 0; i < tracks.length; i++) for (let j = i + 1; j < tracks.length; j++) {
    const a = tracks[i], b = tracks[j];
    if (a.shot !== b.shot || a.start >= b.end || b.start >= a.end) continue;
    const at = new Map(a.samples.map((s) => [s.t.toFixed(2), s.box]));
    const apart = b.samples.filter((s) => { const box = at.get(s.t.toFixed(2)); return box && iou(box, s.box) < SAME_FACE_IOU; }).length;
    if (apart >= CO_VISIBLE_MIN) pairs.push([a, b]);
  }
  return pairs;
}

/** Now, or 1 ms after the newest op if that is not earlier: two commits never share a timestamp, so undo (which
 *  removes the ops sharing the newest one) never takes two commits made within the same millisecond. */
export function stampAfter(prev: string | undefined, now = new Date()): string {
  const p = prev ? Date.parse(prev) : NaN;
  return new Date(!Number.isNaN(p) && p >= now.getTime() ? p + 1 : now.getTime()).toISOString();
}

export class Session {
  readonly bundle: Bundle;
  readonly store: CorrectionStore;
  readonly view: View;
  readonly playback = new Playback();

  ops = $state.raw<Op[]>([]);
  readonly S = $derived(fold(this.ops));
  selection = $state<Selection | null>(null);
  tab = $state<Tab>('inspect');
  activeType = $state<string | null>(null);
  autoAdvance = $state(true);
  /** `[` marked a start; `]` ends the span. */
  marking = $state<number | null>(null);
  message = $state<{ text: string; n: number } | null>(null);
  lightbox = $state<Lightbox | null>(null);
  /** What this version carried over from an earlier one (the ops it could not match wait for review). */
  carry = $state<CarryRecord | null>(null);
  /** The name being edited, as "<id>@<area>" (a rename link opens the editor of the name in that area). */
  renaming = $state<string | null>(null);
  /** py-feat per sample (a large side file), loaded when a view first needs it. */
  detail = $state.raw<FacesDetail | null>(null);
  #detailLoading: Promise<void> | null = null;
  /** A URL for a bundle asset (a crop). */
  asset: (path: string) => string = (path) => path;
  #colour = new Map<string, string>();

  constructor(bundle: Bundle, store: CorrectionStore, view?: View) {
    this.bundle = bundle;
    this.store = store;
    this.view = view ?? new View(bundle.sha256);
    this.playback.duration = bundle.duration;
    (bundle.layers.faces?.people ?? []).forEach((p, i) => this.#colour.set(p.id, PALETTE[i % PALETTE.length]));
  }

  async load() { this.ops = await this.store.load(); }

  /** Load the py-feat side file once; views that need it call this and read `detail`. */
  needDetail(source: { file<T>(path: string): Promise<T> }) {
    const file = this.bundle.layers.faces?.detail?.file;
    if (!file || this.detail || this.#detailLoading) return;
    this.#detailLoading = source.file<FacesDetail>(file).then((d) => { this.detail = d; })
      .catch((e) => { this.toast(`Could not load ${file}: ${e}`); this.#detailLoading = null; });
  }

  toast(text: string) { this.message = { text, n: (this.message?.n ?? 0) + 1 }; }

  // --- corrections ------------------------------------------------------------------------------------------------

  /** Commit ops together (they share a timestamp, so undo removes them together). */
  async commit(...ops: Op[]) {
    const at = stampAfter(this.ops.at(-1)?.at);
    const stamped = ops.map((op) => ({ ...op, at }) as Op);
    const before = this.ops.length;
    const count = await this.store.append(stamped);
    // another writer (another tab of this bundle) appended in between: show the stored log, which holds both
    this.ops = count === before + stamped.length ? [...this.ops, ...stamped] : await this.store.load();
  }

  async undo() {
    const stored = await this.store.load();
    const n = lastBatch(stored);
    if (!n) return;
    await this.store.truncate(stored.length - n);
    this.ops = stored.slice(0, stored.length - n);
    this.toast('Undone');
  }

  /** Read a corrections file (the prototype's v1 or this app's v2) and check it against this bundle. */
  parseCorrections(text: string): Op[] {
    let doc: CorrectionsFile;
    try { doc = JSON.parse(text); } catch { throw new ImportError('that file is not JSON'); }
    const ops = readCorrectionsFile(doc, this.bundle.sha256);
    const missing = unknownRefs(ops, (id) => this.bundle.has(id));
    if (missing.length) throw new ImportError(`the file refers to ${plural(missing.length, 'id')} this bundle does not have (${missing.slice(0, 5).join(', ')})`);
    return ops;
  }

  async replaceCorrections(ops: Op[]) {
    await this.store.replace(ops);
    this.ops = await this.store.load();
    this.selection = null;
  }

  exportCorrections(): string {
    const doc = { format: FORMAT, clip: this.bundle.manifest.video.filename ?? null, sha256: this.bundle.sha256,
      exported_at: new Date().toISOString(), ops: this.ops };
    return JSON.stringify(doc, null, 2);
  }

  // --- people -----------------------------------------------------------------------------------------------------

  root(p: string) { return follow(this.S.mergedInto, p); }
  personOf(track: FaceTrack): string { return this.root(this.S.trackPerson[track.id] ?? track.person ?? UNKNOWN); }
  personOfFace(face: string | null | undefined): string | null {
    const t = face ? this.bundle.face.get(face) : null;
    return t ? this.personOf(t) : null;
  }
  special(p: string) { return p === UNKNOWN || p === NOT_PERSON; }
  nameOf(p: string): string {
    if (p === NOT_PERSON) return 'Not a person';
    if (p === UNKNOWN) return 'Unknown';
    return this.S.names[p] ?? stripKind(p);
  }
  /** A person's name with the machine label, which tells apart two people given the same name. */
  machineLabel(p: string) { return this.S.names[p] ? `${this.S.names[p]} (${stripKind(p)})` : stripKind(p); }
  voiceName(v: string | null) { return v ? this.S.voiceNames[v] ?? stripKind(v) : 'Unnamed voice'; }
  colourOf(p: string | null): string {
    if (!p || p === UNKNOWN) return NEUTRAL;
    if (p === NOT_PERSON) return '#5a5a5a';
    let c = this.#colour.get(p);
    if (!c) { c = PALETTE[this.#colour.size % PALETTE.length]; this.#colour.set(p, c); }
    return c;
  }
  readonly tracksOf = $derived.by(() => {
    const m = new Map<string, FaceTrack[]>();
    for (const t of this.bundle.faces) { const p = this.personOf(t); if (!m.has(p)) m.set(p, []); m.get(p)!.push(t); }
    return m;
  });
  readonly screenSeconds = $derived.by(() => {
    const s = new Map<string, number>();
    for (const [p, ts] of this.tracksOf) s.set(p, ts.reduce((a, t) => a + t.end - t.start, 0));
    return s;
  });
  /** Current identities, most screen time first; Unknown and Not a person last. */
  readonly people = $derived.by(() => {
    const machine = (this.bundle.layers.faces?.people ?? []).map((p) => p.id);
    const ids = [...new Set([...machine, ...this.S.created])].filter((p) => this.root(p) === p && !this.special(p));
    const secs = this.screenSeconds;
    return [...ids.sort((a, b) => (secs.get(b) ?? 0) - (secs.get(a) ?? 0)), UNKNOWN, NOT_PERSON];
  });
  isMachinePerson(p: string) { return (this.bundle.layers.faces?.people ?? []).some((x) => x.id === p); }
  /** A crop of the person: the bundle's, or (for a person made by the user) one of their tracks'. */
  cropOf(p: string): string | null {
    if (this.special(p)) return null;
    const own = this.bundle.layers.faces?.people.find((x) => x.id === p)?.crop;
    if (own) return own;
    return this.tracksOf.get(p)?.find((t) => t.crop)?.crop ?? null;
  }

  // --- speakers ---------------------------------------------------------------------------------------------------

  predicted(u: Utterance): Speaker {
    const p = this.bundle.prediction.get(u.id)?.predicted;
    return p ?? { kind: 'offscreen', voice: u.voice };   // no speakers layer: the diarized voice is all there is
  }
  speakerOf(u: Utterance): Speaker { return this.S.uttSpeaker[u.id] ?? this.predicted(u); }
  reviewed(u: Utterance) { return u.id in this.S.uttSpeaker; }
  speakerPerson(sp: Speaker): string | null {
    if (sp.kind === 'face') return this.personOfFace(sp.face);
    if (sp.kind === 'person') return this.root(sp.person);
    return null;
  }
  speakerName(sp: Speaker): string {
    const p = this.speakerPerson(sp);
    if (p) return this.nameOf(p) + (sp.kind === 'person' ? ' (not on screen)' : '');
    if (sp.kind === 'offscreen') return this.voiceName(sp.voice);
    return { multiple: 'Several speakers', unsure: 'Unsure', not_speech: 'Not speech' }[sp.kind as 'multiple'] ?? '';
  }
  speakerColour(sp: Speaker): string | null { const p = this.speakerPerson(sp); return p ? this.colourOf(p) : null; }
  /** Queue an utterance when faces are on screen and LR-ASD is unsure: a small gap between its top two faces, or no
   *  face scored as speaking. On the hand-labelled OOO clip, TalkNet disagreeing above that gap caught no extra
   *  errors, and with no face on screen the speaker is off-screen by definition, so neither queues. */
  uncertain(u: Utterance): boolean {
    const p = this.bundle.prediction.get(u.id);
    if (!p || !p.candidates.length) return false;
    return p.predicted.kind !== 'face' || (p.margin ?? 0) < UNCERTAIN_GAP;
  }
  uttText(u: Utterance) { return this.S.uttText[u.id] ?? u.text; }
  /** The speaker a drop onto a person's row means: that person's face if it is on screen in the utterance's shot,
   *  else the person off camera. Unknown has no off-camera form (null). */
  speakerForPerson(u: Utterance, p: string): Speaker | null {
    const edge = 0.5 / (this.bundle.layers.faces?.sample_fps ?? 8);
    const onScreen = (this.tracksOf.get(p) ?? []).find((t) => t.shot === u.shot && t.start - edge <= u.end && t.end + edge >= u.start);
    if (onScreen) return { kind: 'face', face: onScreen.id };
    return p === UNKNOWN ? null : { kind: 'person', person: p };
  }

  // --- objects ----------------------------------------------------------------------------------------------------

  identityOf(o: ObjectTrack) { return follow(this.S.objMergedInto, this.S.objTrackIdentity[o.id] ?? o.identity); }
  objName(i: string) { return this.S.objNames[i] ?? (i.startsWith('objid:user:') ? 'New object' : stripKind(i)); }
  objColour(i: string) { let h = 0; for (const c of i) h = (h * 31 + c.charCodeAt(0)) >>> 0; return OBJ_PALETTE[h % OBJ_PALETTE.length]; }
  readonly objectsOf = $derived.by(() => {
    const m = new Map<string, ObjectTrack[]>();
    for (const o of this.bundle.objects) { const i = this.identityOf(o); if (!m.has(i)) m.set(i, []); m.get(i)!.push(o); }
    return m;
  });
  /** Object identities, most screen time first. */
  readonly objectIdentities = $derived.by(() => {
    const secs = (i: string) => (this.objectsOf.get(i) ?? []).reduce((a, o) => a + o.end - o.start, 0);
    return [...this.objectsOf.keys()].sort((a, b) => secs(b) - secs(a));
  });
  objCrop(i: string): string | null {
    const ids = this.bundle.layers.objects?.identities ?? [];
    return ids.find((x) => x.id === i)?.crop ?? ids.find((x) => x.crop && follow(this.S.objMergedInto, x.id) === i)?.crop ?? null;
  }

  // --- what is sent to agents -------------------------------------------------------------------------------------

  includedPerson(p: string) { return this.S.included[p] ?? p !== NOT_PERSON; }
  includedFace(t: FaceTrack) { return this.S.included[t.id] ?? this.includedPerson(this.personOf(t)); }
  includedIdentity(i: string) { return this.S.included[i] ?? true; }
  includedObject(o: ObjectTrack) { return this.S.included[o.id] ?? this.includedIdentity(this.identityOf(o)); }
  includedSound(s: SoundEvent) { return this.S.included[s.id] ?? this.S.category[`sound:${s.label}`] ?? true; }
  /** Utterances, shots, texts and events: included unless switched off. */
  includedId(id: string) { return this.S.included[id] ?? true; }
  /** Whether the selected thing is sent to agents, for the `e` key. */
  included(sel: Selection): boolean {
    const b = this.bundle;
    switch (sel.kind) {
      case 'face': { const t = b.face.get(sel.id); return t ? this.includedFace(t) : true; }
      case 'person': return this.includedPerson(sel.id);
      case 'object': { const o = b.object.get(sel.id); return o ? this.includedObject(o) : true; }
      case 'objid': return this.includedIdentity(sel.id);
      case 'sound': { const s = b.sound.get(sel.id); return s ? this.includedSound(s) : true; }
      default: return this.includedId(sel.id);
    }
  }

  // --- spans, selection, segments ---------------------------------------------------------------------------------

  gesture(id: string): GestureEvent | undefined { return this.bundle.gesture.get(id); }
  facingEvent(id: string): FacingEvent | undefined { return this.bundle.facingEvent.get(id); }
  gazeEvent(id: string): GazeEvent | undefined { return this.bundle.gazeEvent.get(id); }
  shot(id: string): Shot | undefined { return this.bundle.shot.get(id); }
  text(id: string): TextItem | undefined { return this.bundle.text.get(id); }

  spanOf(sel: Selection | null): Span | null {
    if (!sel) return null;
    const b = this.bundle;
    switch (sel.kind) {
      case 'face': return b.face.get(sel.id) ?? null;
      case 'utt': return b.utt.get(sel.id) ?? null;
      case 'sound': return b.sound.get(sel.id) ?? null;
      case 'text': return b.text.get(sel.id) ?? null;
      case 'shot': return b.shot.get(sel.id) ?? null;
      case 'note': return this.S.notes.get(sel.id) ?? null;
      case 'object': return b.object.get(sel.id) ?? null;
      case 'gesture': return b.gesture.get(sel.id) ?? null;
      case 'facing': return b.facingEvent.get(sel.id) ?? null;
      case 'gaze': return b.gazeEvent.get(sel.id) ?? null;
      case 'objid': return extent(this.objectsOf.get(sel.id) ?? []);
      case 'person': return extent(this.tracksOf.get(sel.id) ?? []);
    }
  }
  clipOf(sel: Selection | null) { return sel && !NOT_CLIPS.has(sel.kind) ? this.spanOf(sel) : null; }
  isSel(kind: SelKind, id: string) { return this.selection?.kind === kind && this.selection.id === id; }

  select(kind: SelKind, id: string, { seek = true } = {}) {
    this.selection = { kind, id };
    if (!(this.tab === 'review' && (kind === 'utt' || kind === 'sound'))) this.tab = 'inspect';
    if (seek) { const span = this.spanOf(this.selection); if (span) this.playback.seek(span.start, { keepClip: true }); }
  }

  /** Play the selection as a clip. */
  playSelection() {
    const span = this.clipOf(this.selection);
    if (!span) { this.toast('Select an utterance, shot, sound, track or event to play it as a clip'); return; }
    this.playback.playClip(span);
  }
  /** A click on a timeline segment: play it (looping by default); a second click on the playing segment stops it. */
  clickPlay() {
    const span = this.clipOf(this.selection);
    if (span) this.playback.toggleClip(span);
  }

  /** The segments of the selection's row: the next utterance, the same person's next track, the same object's next
   *  appearance, the next event of the same kind. */
  siblings(sel: Selection | null): Segment[] | null {
    const b = this.bundle, seg = (kind: SelKind) => (x: Span & { id: string }): Segment => ({ kind, id: x.id, span: x });
    switch (sel?.kind) {
      case 'utt': return byStart(b.utterances.map(seg('utt')));
      case 'shot': return b.shots.map(seg('shot'));
      case 'face': { const t = b.face.get(sel.id); return t ? byStart((this.tracksOf.get(this.personOf(t)) ?? []).map(seg('face'))) : null; }
      case 'object': { const o = b.object.get(sel.id); return o ? byStart((this.objectsOf.get(this.identityOf(o)) ?? []).map(seg('object'))) : null; }
      case 'sound': return byStart(b.sounds.map(seg('sound')));
      case 'text': return byStart(b.texts.map(seg('text')));
      case 'note': { const type = this.S.notes.get(sel.id)?.type; return byStart([...this.S.notes.values()].filter((n) => n.type === type).map(seg('note'))); }
      case 'gesture': { const k = b.gesture.get(sel.id)?.kind; return byStart(b.gestures.filter((g) => g.kind === k).map(seg('gesture'))); }
      case 'facing': return byStart(b.facing.map(seg('facing')));
      case 'gaze': { const k = b.gazeEvent.get(sel.id)?.kind; return byStart(b.gazeEvents.filter((g) => g.kind === k).map(seg('gaze'))); }
      default: return null;
    }
  }

  /** Arrow keys: select and play the previous or next segment of the selection's row. With nothing (or an identity)
   *  selected, step through utterances around the playhead. */
  step(dir: 1 | -1) {
    const list = this.siblings(this.selection);
    const i = list && this.selection ? list.findIndex((x) => x.id === this.selection!.id) : -1;
    let target: Segment | undefined;
    if (i < 0) {
      const utts = this.siblings({ kind: 'utt', id: '' }) ?? [], t = this.playback.time;
      target = dir > 0 ? utts.find((x) => x.span.start > t + 1e-3) : [...utts].reverse().find((x) => x.span.start < t - 1e-3);
      if (!target) return;
    } else {
      target = list![i + dir];
      if (!target) { this.toast(dir > 0 ? 'That was the last one' : 'That was the first one'); return; }
    }
    this.select(target.kind, target.id);
    this.playback.playClip(target.span);
  }

  // --- review queue -----------------------------------------------------------------------------------------------

  readonly queue = $derived.by(() => {
    const speakers = this.bundle.utterances.filter((u) => this.uncertain(u));
    const seen = new Set<string>();
    const pairs = (this.bundle.layers.faces?.person_pairs ?? [])
      .filter((p) => !p.co_visible && p.distance < SIMILAR_DISTANCE)   // similar faces never on screen together
      .map((p) => ({ ...p, a: this.root(p.a), b: this.root(p.b) }))
      .filter((p) => {
        const k = pairKey(p.a, p.b);
        if (p.a === p.b || this.special(p.a) || this.special(p.b) || this.S.distinct.has(k) || seen.has(k)) return false;
        seen.add(k); return true;
      });
    const sounds = this.bundle.sounds.filter((s) => s.agreement === false);
    return { speakers, pairs, sounds };
  });
  /** Ops of an earlier version left for review: only while its carry-over is in the log (an undo takes it back). */
  readonly notCarried = $derived(this.carry?.status === 'carried' && this.ops.some((o) => o.carried_from) ? this.carry.unmatched : []);
  readonly openInQueue = $derived(this.queue.speakers.filter((u) => !this.reviewed(u)).length + this.queue.pairs.length
    + this.notCarried.length);

  nextInQueue(dir: 1 | -1 = 1) {
    const q = this.queue.speakers;
    if (!q.some((u) => !this.reviewed(u))) { this.toast('No uncertain utterances left'); return; }
    let i = this.selection?.kind === 'utt' ? q.findIndex((u) => u.id === this.selection!.id) : -1;
    if (i < 0 && dir < 0) i = 0;
    for (let n = 0; n < q.length; n++) { i = (i + dir + q.length) % q.length; if (!this.reviewed(q[i])) break; }
    this.select('utt', q[i].id);
    this.playback.playClip(q[i]);
  }

  async setSpeaker(u: Utterance, speaker: Speaker | null) {
    await this.commit({ op: 'utterance.speaker', utt: u.id, speaker });
    if (speaker && this.autoAdvance && this.uncertain(u)) this.nextInQueue(1);
  }

  // --- annotations ------------------------------------------------------------------------------------------------

  typeOf(id: string): AnnotationType | undefined { return this.S.types.find((t) => t.id === id); }
  hasValue(n: Note) { return n.value !== null && n.value !== undefined && n.value !== ''; }
  noteValue(n: Note) {
    if (!this.hasValue(n)) return '(no value)';
    return this.typeOf(n.type)?.kind === 'binary' ? (n.value ? 'yes' : 'no') : String(n.value);
  }
  /** The person in focus: the selection, else the only face on screen. */
  defaultPerson(): string | null {
    const sel = this.selection;
    if (sel?.kind === 'person' && !this.special(sel.id)) return sel.id;
    if (sel?.kind === 'face') { const t = this.bundle.face.get(sel.id); const p = t ? this.personOf(t) : null; return p && !this.special(p) ? p : null; }
    if (sel?.kind === 'utt') { const u = this.bundle.utt.get(sel.id); return u ? this.speakerPerson(this.speakerOf(u)) : null; }
    const on = [...new Set(this.facesAt(this.playback.time).map((t) => this.personOf(t)))].filter((p) => !this.special(p));
    return on.length === 1 ? on[0] : null;
  }
  async addNote(typeId: string, start: number, end: number) {
    const type = this.typeOf(typeId);
    if (!type) return;
    const note: Note = { id: `note:${Date.now()}`, type: typeId, start, end, value: null, person: type.target === 'person' ? this.defaultPerson() : null };
    this.marking = null;
    this.activeType = typeId;
    await this.commit({ op: 'annotation.add', note });
    this.select('note', note.id, { seek: false });
  }

  /** Face tracks in the shot at t whose span (with half a sample of slack) covers t. */
  facesAt(t: number): FaceTrack[] {
    const shot = this.bundle.shotAt(t), edge = 0.5 / (this.bundle.layers.faces?.sample_fps ?? 8);
    return (shot ? this.bundle.facesByShot.get(shot.id) ?? [] : []).filter((f) => t >= f.start - edge && t <= f.end + edge);
  }

  /** What a gaze target id names: a person, an object, the camera, or out of frame. */
  lookName(target: string | null | undefined): string {
    if (target === 'camera') return 'the camera';
    if (target === 'out') return 'out of frame';
    if (target?.startsWith('face:')) { const p = this.personOfFace(target); return p ? this.nameOf(p) : 'someone'; }
    if (target?.startsWith('obj:')) { const o = this.bundle.object.get(target); return o ? this.objName(this.identityOf(o)) : 'an object'; }
    return 'nobody on screen';
  }
}
