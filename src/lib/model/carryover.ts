// Carrying corrections over to a re-run. A newer bundle of the same video names the same faces, people, utterances
// and shots with new ids, so each id an op refers to is matched in the new bundle: segments by time overlap (faces
// also by box overlap at the same moments), identities (people, voices, object identities) by where their members
// went. An op is carried only when every id it refers to matches; the others are listed for review with the reason,
// never dropped or guessed. The earlier version's log is not touched: carried ops are copies, each naming the op it
// came from.
import type { Bundle } from './bundle';
import { extent } from './bundle';
import { NOT_PERSON, UNKNOWN, type Op } from './corrections';
import { iou, nearest } from '../geometry';
import type { FaceTrack, Span } from '../types';

export const SPAN_IOU = 0.5;      // time overlap (intersection over union) for a segment to be the same one
export const FACE_IOU = 0.5;      // mean box overlap at shared moments for a face track to be the same one
export const MEMBER_COVER = 0.5;  // share of an identity's screen or speech time that must be found in the new version
export const MEMBER_SHARE = 0.75; // share of what was found that must belong to one new identity

/** An op that could not be carried, with why, and when in the video it applies (for the review list). */
export interface Unmatched { index: number; op: Op; reason: string; span: Span | null }
export interface CarryResult { ops: Op[]; unmatched: Unmatched[] }

class Mismatch extends Error {}

const label = (id: string) => id.replace(/^[a-z]+:/, '');
const kindOf = (id: string) => id.slice(0, id.indexOf(':'));

function spanIou(a: Span, b: Span) {
  const inter = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const union = Math.max(a.end, b.end) - Math.min(a.start, b.start);
  return union > 0 ? inter / union : a.start === b.start ? 1 : 0;
}

/** Pairs old -> new by score, best first, each used once. */
function greedy<T extends { id: string }>(olds: T[], news: T[], score: (a: T, b: T) => number, min: number) {
  const pairs: [number, string, string][] = [];
  for (const a of olds) for (const b of news) { const s = score(a, b); if (s >= min) pairs.push([s, a.id, b.id]); }
  pairs.sort((x, y) => y[0] - x[0]);
  const map = new Map<string, string>(), used = new Set<string>();
  for (const [, a, b] of pairs) if (!map.has(a) && !used.has(b)) { map.set(a, b); used.add(b); }
  return map;
}

type Seg = Span & { id: string; key?: string };
const matchSpans = (olds: Seg[], news: Seg[]) =>
  greedy(olds, news, (a, b) => (a.key === b.key ? spanIou(a, b) : 0), SPAN_IOU);

/** Mean box overlap of two tracks at the moments either was sampled (a moment only one has counts as 0). */
function faceScore(a: FaceTrack, b: FaceTrack, gap: number) {
  if (a.start > b.end || b.start > a.end) return 0;
  let sum = 0;
  for (const s of a.samples) { const o = nearest(b.samples, s.t, gap); if (o) sum += iou(s.box, o.box); }
  return sum / Math.max(a.samples.length, b.samples.length);
}

/** Old identity -> new identity, from where its members (weighted by samples or seconds) went. */
function matchIdentities(
  members: Map<string, { id: string; weight: number }[]>, memberMap: Map<string, string>,
  owner: (newMember: string) => string | null, what: string,
) {
  const found = new Map<string, { to: string; votes: number }>(), reasons = new Map<string, string>();
  for (const [ident, ms] of members) {
    const total = ms.reduce((a, m) => a + m.weight, 0);
    const votes = new Map<string, number>();
    let unassigned = 0;   // members found in the new version, but not given to any identity there
    for (const m of ms) {
      const n = memberMap.get(m.id);
      if (!n) continue;
      const o = owner(n);
      if (o) votes.set(o, (votes.get(o) ?? 0) + m.weight); else unassigned += m.weight;
    }
    const matched = [...votes.values()].reduce((a, v) => a + v, 0);
    const ranked = [...votes].sort((x, y) => y[1] - x[1]);
    if (total && matched / total < MEMBER_COVER && unassigned / total >= MEMBER_COVER) {
      reasons.set(ident, `${label(ident)}: their ${what === 'speech' ? 'speech is' : 'faces are'} unassigned${what === 'speech' ? '' : ' (Unknown)'} in the new version`);
    } else if (!total || matched / total < MEMBER_COVER) {
      reasons.set(ident, `${label(ident)}: only ${Math.round((matched / (total || 1)) * 100)}% of their ${what} was found in the new version`);
    } else if (ranked[0][1] / matched < MEMBER_SHARE) {
      reasons.set(ident, `${label(ident)} is split between ${ranked.slice(0, 2).map(([p]) => label(p)).join(' and ')} in the new version`);
    } else {
      found.set(ident, { to: ranked[0][0], votes: ranked[0][1] });
    }
  }
  // two old identities that the new version puts together: keep the one with more evidence, list the other
  const map = new Map<string, string>();
  for (const [ident, { to, votes }] of found) {
    const rival = [...found].find(([o, f]) => o !== ident && f.to === to && (f.votes > votes || (f.votes === votes && o < ident)));
    if (rival) reasons.set(ident, `${label(ident)} and ${label(rival[0])} are one identity (${label(to)}) in the new version`);
    else map.set(ident, to);
  }
  return { map, reasons };
}

/** How every id of `from` maps into `to`, or why it does not. */
export function anchor(from: Bundle, to: Bundle) {
  const map = new Map<string, string>(), reasons = new Map<string, string>();
  const segs = (xs: (Span & { id: string })[], key?: (x: any) => string) => xs.map((x) => ({ id: x.id, start: x.start, end: x.end, key: key?.(x) }));
  const add = (m: Map<string, string>) => m.forEach((v, k) => map.set(k, v));

  const gap = 0.5 / (to.layers.faces?.sample_fps ?? 8);
  const faces = greedy(from.faces, to.faces, (a, b) => faceScore(a, b, gap), FACE_IOU);
  add(faces);
  const utts = matchSpans(segs(from.utterances), segs(to.utterances));
  add(utts);
  add(matchSpans(segs(from.shots), segs(to.shots)));
  add(matchSpans(segs(from.sounds, (s) => s.label), segs(to.sounds, (s) => s.label)));
  add(matchSpans(segs(from.texts, (t) => t.text), segs(to.texts, (t) => t.text)));
  add(matchSpans(segs(from.gestures, (g) => g.kind), segs(to.gestures, (g) => g.kind)));
  add(matchSpans(segs(from.facing), segs(to.facing)));
  add(matchSpans(segs(from.gazeEvents, (g) => g.kind), segs(to.gazeEvents, (g) => g.kind)));
  const objs = matchSpans(segs(from.objects, (o) => o.label), segs(to.objects, (o) => o.label));
  add(objs);

  // tracks weigh by their samples (a face seen once is a track of no duration), utterances by their seconds
  const group = <T extends { id: string }>(xs: T[], key: (x: T) => string | null, weight: (x: T) => number) => {
    const m = new Map<string, { id: string; weight: number }[]>();
    for (const x of xs) { const k = key(x); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k)!.push({ id: x.id, weight: weight(x) }); }
    return m;
  };
  const people = matchIdentities(group(from.faces, (t) => t.person, (t) => t.samples.length), faces, (f) => to.face.get(f)?.person ?? null, 'screen time');
  const voices = matchIdentities(group(from.utterances, (u) => u.voice, (u) => u.end - u.start), utts, (u) => to.utt.get(u)?.voice ?? null, 'speech');
  const idents = matchIdentities(group(from.objects, (o) => o.identity, (o) => o.samples.length), objs, (o) => to.object.get(o)?.identity ?? null, 'screen time');
  for (const r of [people, voices, idents]) { add(r.map); r.reasons.forEach((v, k) => reasons.set(k, v)); }
  return { map, reasons };
}

/** When in the earlier version an id applies (a person: from their first to their last track). */
function spanIn(b: Bundle, id: string): Span | null {
  switch (kindOf(id)) {
    case 'face': return b.face.get(id) ?? null;
    case 'utt': return b.utt.get(id) ?? null;
    case 'shot': return b.shot.get(id) ?? null;
    case 'sound': return b.sound.get(id) ?? null;
    case 'text': return b.text.get(id) ?? null;
    case 'gesture': return b.gesture.get(id) ?? null;
    case 'facing': return b.facingEvent.get(id) ?? null;
    case 'gaze': return b.gazeEvent.get(id) ?? null;
    case 'obj': return b.object.get(id) ?? null;
    case 'person': return extent(b.faces.filter((t) => t.person === id));
    case 'voice': return extent(b.utterances.filter((u) => u.voice === id));
    case 'objid': return extent(b.objects.filter((o) => o.identity === id));
    default: return null;
  }
}

/** The bundle ids an op refers to, in order (the first one places it in time for review). */
export function refsOf(op: Op): string[] {
  switch (op.op) {
    case 'person.rename': case 'person.not_person': return [op.person];
    case 'person.merge': case 'object.merge': return [op.from, op.into];
    case 'person.distinct': return [op.a, op.b];
    case 'voice.rename': return [op.voice];
    case 'object.rename': return [op.identity];
    case 'object.assign': return [op.track, op.identity];
    case 'track.assign': return [op.track, op.person];
    case 'utterance.speaker': {
      const sp = op.speaker;
      return [op.utt, ...(sp?.kind === 'face' ? [sp.face] : sp?.kind === 'person' ? [sp.person] : sp?.kind === 'offscreen' && sp.voice ? [sp.voice] : [])];
    }
    case 'utterance.text': return [op.utt];
    case 'shot.caption': return [op.shot];
    case 'entity.include': return [op.id];
    case 'annotation.add': return op.note.person ? [op.note.person] : [];
    case 'annotation.edit': return op.fields.person ? [op.fields.person] : [];
    default: return [];   // person.create, category.include, annotation.type, annotation.delete: nothing of the bundle's
  }
}

/** Re-anchor `ops` (the log of bundle `fromId`) onto `to`. */
export function carryOver(ops: Op[], from: Bundle, to: Bundle, fromId: string): CarryResult {
  const { map, reasons } = anchor(from, to);
  const own = new Set(ops.flatMap((o) => (o.op === 'person.create' ? [o.person] : [])));
  const m = (id: string): string => {
    if (id === UNKNOWN || id === NOT_PERSON || own.has(id) || id.startsWith('objid:user:') || id.startsWith('note:')) return id;
    const to = map.get(id);
    if (to) return to;
    throw new Mismatch(reasons.get(id) ?? (from.has(id) ? `${label(id)} has no counterpart in the new version` : `${id} is not in the earlier version`));
  };
  const out: Op[] = [], unmatched: Unmatched[] = [];
  ops.forEach((op, index) => {
    try {
      const moved = translate(op, m);
      if (op.op === 'person.distinct' && moved.op === 'person.distinct' && moved.a === moved.b) {
        throw new Mismatch(`${label(op.a)} and ${label(op.b)} are one person in the new version`);
      }
      out.push({ ...moved, carried_from: { bundle: fromId, index } });
    } catch (e) {
      if (!(e instanceof Mismatch)) throw e;
      const first = refsOf(op)[0];
      unmatched.push({ index, op, reason: e.message, span: first ? spanIn(from, first) : null });
    }
  });
  return { ops: out, unmatched };
}

/** The op with every bundle id it refers to mapped by `m` (which throws when one cannot be). */
function translate(op: Op, m: (id: string) => string): Op {
  switch (op.op) {
    case 'person.rename': case 'person.not_person': return { ...op, person: m(op.person) };
    case 'person.merge': case 'object.merge': return { ...op, from: m(op.from), into: m(op.into) };
    case 'person.distinct': return { ...op, a: m(op.a), b: m(op.b) };
    case 'voice.rename': return { ...op, voice: m(op.voice) };
    case 'object.rename': return { ...op, identity: m(op.identity) };
    case 'object.assign': return { ...op, track: m(op.track), identity: m(op.identity) };
    case 'track.assign': return { ...op, track: m(op.track), person: m(op.person) };
    case 'utterance.speaker': {
      const sp = op.speaker;
      const speaker = sp?.kind === 'face' ? { ...sp, face: m(sp.face) } : sp?.kind === 'person' ? { ...sp, person: m(sp.person) }
        : sp?.kind === 'offscreen' && sp.voice ? { ...sp, voice: m(sp.voice) } : sp;
      return { ...op, utt: m(op.utt), speaker };
    }
    case 'utterance.text': return { ...op, utt: m(op.utt) };
    case 'shot.caption': return { ...op, shot: m(op.shot) };
    case 'entity.include': return { ...op, id: m(op.id) };
    case 'annotation.add': return op.note.person ? { ...op, note: { ...op.note, person: m(op.note.person) } } : op;
    case 'annotation.edit': return op.fields.person ? { ...op, fields: { ...op.fields, person: m(op.fields.person) } } : op;
    default: return op;
  }
}

/** One line for the review list: what the op did, in the earlier version's terms. */
export function describe(op: Op): string {
  switch (op.op) {
    case 'person.create': return `New person “${op.name}”`;
    case 'person.rename': return `${label(op.person)} named “${op.name}”`;
    case 'person.merge': return `${label(op.from)} merged into ${label(op.into)}`;
    case 'person.not_person': return `${label(op.person)} marked not a person`;
    case 'person.distinct': return `${label(op.a)} and ${label(op.b)} marked as different people`;
    case 'voice.rename': return `Voice ${label(op.voice)} named “${op.name}”`;
    case 'object.rename': return `Object ${label(op.identity)} named “${op.name}”`;
    case 'object.merge': return `Object ${label(op.from)} merged into ${label(op.into)}`;
    case 'object.assign': return `Object track ${label(op.track)} assigned to ${label(op.identity)}`;
    case 'track.assign': return `Face track ${label(op.track)} assigned to ${label(op.person)}`;
    case 'utterance.speaker': return `Speaker of utterance ${label(op.utt)} set`;
    case 'utterance.text': return `Utterance ${label(op.utt)} retyped: “${op.text}”`;
    case 'shot.caption': return `Caption of shot ${Number(label(op.shot)) + 1} edited`;
    case 'entity.include': return `${label(op.id)} ${op.included ? 'included' : 'excluded'} (${kindOf(op.id)})`;
    case 'category.include': return `${op.kind} “${op.label}” ${op.included ? 'included' : 'excluded'}`;
    case 'annotation.type': return `Annotation type “${op.type.name}”`;
    case 'annotation.add': return 'Annotation added';
    case 'annotation.edit': return 'Annotation edited';
    case 'annotation.delete': return 'Annotation deleted';
  }
}
