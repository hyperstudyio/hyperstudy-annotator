// The timeline's groups and rows, built from the session: plain data the Timeline component lays out. What each row
// shows, its colours, flags and what a click or a drag on it means are decided here, so they can be tested.
import type { GroupKey, ViewState } from '../model/view.svelte';
import { GROUP_KEYS, ordered } from '../model/view.svelte';
import { NEUTRAL, plural, type Selection, type Session } from '../model/session.svelte';
import { NOT_PERSON } from '../model/corrections';
import { AFFECT_COLOURS, lerpHex, rangeOf, type AffectDim, type AffectPoint } from '../draw/plots';
import { fmt } from '../geometry';
import type { ProsodyCaption, Span, Utterance } from '../types';

export const ROW_H = 22;
export type BarFlag = 'excluded' | 'unconfirmed' | 'flagged' | 'selected' | 'vis' | 'speech' | 'shot' | 'odd' | 'neutral' | 'caption';

export interface Bar extends Span {
  key: string;
  row?: number;            // stacked sub-row (overlapping bars)
  top?: number;            // explicit top, px
  text?: string;
  colour?: string;
  title?: string;
  flags: BarFlag[];
  /** What a click selects; the click also plays it as a clip unless `noPlay`. */
  sel?: Selection;
  /** Speech: drag onto another row to change the speaker. */
  drag?: { utt: string; ghost: string };
}

export type Label =
  | { kind: 'text'; text: string; title?: string }
  | { kind: 'person'; person: string }
  | { kind: 'voice'; voice: string | null }
  | { kind: 'object'; identity: string }
  | { kind: 'type'; type: string; text: string }
  | { kind: 'affect'; model: string; title: string };

export type Plot = { kind: 'waveform' } | { kind: 'pitch' } | { kind: 'affect'; points: AffectPoint[]; ranges: Record<AffectDim, [number, number]> };
export type Drop = { person: string } | { voice: string | null } | { other: true };

export interface Row {
  id: string;
  label: Label;
  bars: Bar[];
  height?: number;         // default: one ROW_H per sub-row
  plot?: Plot;
  drop?: Drop;             // speech dropped here gets this speaker
  create?: string;         // an annotation type: drag across the row to add a span
  hint?: string;
  hideable?: boolean;      // default true
}

export interface Group { key: GroupKey; label: string; count: string; rows: Row[]; summary: Bar[] }

export const ENDING_MIN_ST = 2;   // only clear final movements are drawn: most move under 2 st and read as noise (user review)
export const ENDING = { rise: '↗', fall: '↘', level: '→' } as const;
const GENERIC_TAGS = new Set(['clear', 'conversational']);   // on most utterances; they crowd out the informative tags
const GESTURES: Record<string, string> = { hand_over_mouth: 'Hand over mouth', self_touch_face: 'Touching face', pointing: 'Pointing', raised_hand: 'Raised hand' };
const GAZE_KINDS: Record<string, string> = { looks_at: 'Looks at', mutual_gaze: 'Mutual gaze', joint_attention: 'Joint attention' };
const MODEL_NAMES: [RegExp, string][] = [[/^audeering\//, 'audEERING'], [/Odyssey/i, 'Odyssey'], [/emotion2vec/, 'emotion2vec+'], [/Vox-?Profile/i, 'Vox-Profile']];
export const shortModel = (m: string) => MODEL_NAMES.find(([re]) => re.test(m))?.[1] ?? m.split('/').pop() ?? m;
/** A caption's tags: the model's own, or (for a captioner that only describes) the tagger's reading of its text. */
export const captionTags = (c: ProsodyCaption) => c.tags ?? c.tags_from_text ?? [];
export const captionModelName = (key: string) => (key === 'gpt' ? 'GPT audio' : key === 'qwen' ? 'Qwen captioner' : key);

/** Sub-row per item so overlapping items do not cover each other (items sorted by start). */
export function stack(items: Span[]): number[] {
  const ends: number[] = [];
  return items.map((it) => {
    let r = ends.findIndex((e) => e <= it.start + 1e-6);
    if (r < 0) { r = ends.length; ends.push(0); }
    ends[r] = it.end;
    return r;
  });
}

const flags = (...xs: (BarFlag | false | null | undefined)[]) => xs.filter(Boolean) as BarFlag[];

/** The dimensional emotion models the timeline draws: the stage's default only (the inspector lists them all). */
export function shownDims(s: Session) {
  const P = s.bundle.layers.prosody;
  if (!P) return [];
  return Object.entries(P.emotion_models).filter(([key, m]) => m.kind === 'dimensional' && (!P.default_dimensional || key === P.default_dimensional));
}

export function affectOf(s: Session, u: Utterance, key: string): { arousal: number; valence: number; dominance: number } | null {
  const v = s.bundle.prosodyOf.get(u.id)?.emotion[key] as { arousal?: number } | undefined;
  return v && typeof v.arousal === 'number' ? (v as { arousal: number; valence: number; dominance: number }) : null;
}

/** prosody.json names a speaker by face cluster ("Person C") or diarized voice ("off-screen SPEAKER_00"). */
export function prosodySpeakerColour(s: Session, name: string | null | undefined) {
  return !name || name.startsWith('off-screen') ? NEUTRAL : s.colourOf(s.root(`person:${name}`));
}

export function buildGroups(s: Session): Group[] {
  const b = s.bundle, S = s.S, groups: Group[] = [];
  const uttFlags = (u: Utterance) => flags(!s.includedId(u.id) && 'excluded', s.uncertain(u) && !s.reviewed(u) && 'flagged', s.isSel('utt', u.id) && 'selected');

  // audio and speech
  const audio: Row[] = [];
  if (b.layers.waveform) audio.push({ id: 'waveform', label: { kind: 'text', text: 'Waveform' }, height: 36, bars: [], plot: { kind: 'waveform' } });
  if (b.layers.transcript) audio.push({ id: 'transcript', label: { kind: 'text', text: 'Transcript' }, bars: b.utterances.map((u) => {
    const sp = s.speakerOf(u), col = s.speakerColour(sp), text = s.uttText(u);
    return { key: u.id, start: u.start, end: u.end, text, colour: col ?? undefined, flags: [...uttFlags(u), ...flags(!col && 'neutral')],
      title: `${fmt(u.start)} ${s.speakerName(sp)}: ${text}\nClick to select · drag onto a person's row to change the speaker`,
      sel: { kind: 'utt', id: u.id }, drag: { utt: u.id, ghost: text } };
  }) });
  if (audio.length) groups.push({ key: 'audio', label: 'Audio & speech', count: '', rows: audio,
    summary: b.utterances.map((u) => ({ key: u.id, start: u.start, end: u.end, colour: s.speakerColour(s.speakerOf(u)) ?? NEUTRAL, flags: [] })) });

  // prosody
  const P = b.layers.prosody;
  if (P) {
    const pu = (u: Utterance) => b.prosodyOf.get(u.id);
    const rows: Row[] = [{ id: 'prosody:pitch', label: { kind: 'text', text: 'Pitch', title: 'Pitch, ±12 semitones around each speaker\'s median' }, height: 48, bars: [], plot: { kind: 'pitch' } }];
    rows.push({ id: 'prosody:ending', label: { kind: 'text', text: `Ending (≥${ENDING_MIN_ST} st)` }, bars: b.utterances.flatMap((u) => {
      const p = pu(u), m = p?.measures;
      if (!m?.final_movement || Math.abs(m.final_delta_st ?? 0) < ENDING_MIN_ST) return [];
      const d = m.final_delta_st!;
      return [{ key: u.id, start: u.start, end: u.end, text: `${ENDING[m.final_movement]} ${d > 0 ? '+' : ''}${d.toFixed(1)}`,
        colour: prosodySpeakerColour(s, p!.speaker), flags: flags(s.isSel('utt', u.id) && 'selected'),
        title: `Final pitch ${m.final_movement} (${d.toFixed(1)} st) · ${s.uttText(u)}`, sel: { kind: 'utt', id: u.id } } satisfies Bar];
    }) });
    const dims = shownDims(s);
    for (const [key, meta] of dims) {
      const points = b.utterances.flatMap((u) => { const a = affectOf(s, u, key); return a ? [{ id: u.id, start: u.start, end: u.end, arousal: a.arousal, valence: a.valence }] : []; });
      const ranges = { arousal: rangeOf(points.map((p) => p.arousal)), valence: rangeOf(points.map((p) => p.valence)) };
      rows.push({ id: `prosody:${key}`, height: 56, bars: [], plot: { kind: 'affect', points, ranges },
        label: { kind: 'affect', model: shortModel(meta.model),
          title: `${meta.model} · ${meta.licence_mode}\norange: arousal, clip range ${ranges.arousal.map((v) => v.toFixed(2)).join('–')}\nblue: valence, clip range ${ranges.valence.map((v) => v.toFixed(2)).join('–')}\nEach line spans its own clip range.` } });
    }
    for (const [key, meta] of Object.entries(P.caption_models)) {
      rows.push({ id: `prosody:caption:${key}`, label: { kind: 'text', text: `Delivery · ${captionModelName(key)}`, title: `${meta.model} · tags are suggestions, not checked` },
        bars: b.utterances.flatMap((u) => {
          const c = pu(u)?.captions[key];
          if (!c) return [];
          return [{ key: u.id, start: u.start, end: u.end, text: captionTags(c).filter((t) => !GENERIC_TAGS.has(t)).slice(0, 3).join(', '), colour: '#5d6b7a',
            flags: flags(s.isSel('utt', u.id) && 'selected', 'unconfirmed'), title: `${captionTags(c).join(', ')}\n\n${c.description ?? ''}`, sel: { kind: 'utt', id: u.id } } satisfies Bar];
        }) });
    }
    const first = dims[0]?.[0];
    groups.push({ key: 'prosody', label: 'Prosody', count: plural(dims.length + Object.keys(P.caption_models).length, 'model'), rows,
      summary: first ? b.utterances.flatMap((u) => { const a = affectOf(s, u, first); return a ? [{ key: u.id, start: u.start, end: u.end, flags: [],
        colour: lerpHex('#2f3b55', AFFECT_COLOURS.arousal, Math.max(0, Math.min(1, a.arousal))) }] : []; }) : [] });
  }

  // people: on screen (thin bars) and speech (thicker bars; the words are in the transcript row)
  if (b.layers.faces || b.layers.transcript) {
    const speechBy = new Map<string, Utterance[]>();
    for (const u of b.utterances) {
      const sp = s.speakerOf(u), p = s.speakerPerson(sp);
      const key = p ?? (sp.kind === 'offscreen' ? sp.voice ?? 'voice:' : 'other');   // voice ids are 'voice:<label>'
      if (!speechBy.has(key)) speechBy.set(key, []);
      speechBy.get(key)!.push(u);
    }
    const edge = 0.5 / (b.layers.faces?.sample_fps ?? 8);
    const speechBar = (u: Utterance, colour: string): Bar => {
      const sp = s.speakerOf(u), text = s.uttText(u);
      return { key: u.id, start: u.start, end: u.end, top: 13, colour, flags: ['speech', ...uttFlags(u)], sel: { kind: 'utt', id: u.id },
        title: `${fmt(u.start)} ${s.speakerName(sp)}${s.reviewed(u) ? ' (set by you)' : ' (predicted)'}: ${text}\nDrag to another row to change the speaker`,
        drag: { utt: u.id, ghost: text } };
    };
    const rows: Row[] = [];
    for (const p of s.people) {
      const tracks = s.tracksOf.get(p) ?? [], speech = speechBy.get(p) ?? [];
      if (!tracks.length && !speech.length) continue;
      const col = s.colourOf(p);
      rows.push({ id: p, label: { kind: 'person', person: p }, height: 30, drop: p === NOT_PERSON ? undefined : { person: p }, bars: [
        ...tracks.map((t): Bar => ({ key: t.id, start: t.start, end: t.end + edge, top: 3, colour: col, sel: { kind: 'face', id: t.id },
          flags: flags('vis', !s.includedFace(t) && 'excluded', s.isSel('face', t.id) && 'selected'),
          title: `On screen: ${t.id.replace(':', ' track ')} · shot ${(b.shotNumber(t.shot) ?? 0) + 1} · ${fmt(t.start)}–${fmt(t.end)}` })),
        ...speech.map((u) => speechBar(u, col))] });
    }
    const voices = [...speechBy.keys()].filter((k) => k.startsWith('voice:')).sort();
    for (const key of voices) {
      const v = key === 'voice:' ? null : key;
      rows.push({ id: key, label: { kind: 'voice', voice: v }, height: 30, drop: { voice: v }, bars: speechBy.get(key)!.map((u) => speechBar(u, NEUTRAL)) });
    }
    rows.push({ id: 'other', label: { kind: 'text', text: 'Unsure / other', title: 'Unsure, several speakers, or not speech' }, height: 30, drop: { other: true },
      bars: (speechBy.get('other') ?? []).map((u) => speechBar(u, NEUTRAL)) });
    const n = s.people.filter((p) => !s.special(p) && s.tracksOf.has(p)).length;
    groups.push({ key: 'people', label: 'People', count: plural(n, 'person', 'people'), rows,
      summary: b.faces.map((t) => ({ key: t.id, start: t.start, end: t.end, colour: s.colourOf(s.personOf(t)), flags: [] })) });
  }

  // objects: a row per identity
  const oRows: Row[] = s.objectIdentities.map((i) => ({ id: i, label: { kind: 'object', identity: i },
    bars: (s.objectsOf.get(i) ?? []).map((o): Bar => ({ key: o.id, start: o.start, end: o.end, colour: s.objColour(i), sel: { kind: 'object', id: o.id },
      flags: flags(!s.includedObject(o) && 'excluded', s.isSel('object', o.id) && 'selected'),
      title: `${s.objName(i)} · shot ${(b.shotNumber(o.shot) ?? 0) + 1} · ${fmt(o.start)}–${fmt(o.end)}` })) }));
  groups.push({ key: 'objects', label: 'Objects', count: b.layers.objects ? plural(oRows.length, 'object') : 'not run',
    rows: oRows.length ? oRows : [{ id: 'objects', label: { kind: 'text', text: 'Objects' }, bars: [], hideable: false, hint: b.layers.objects ? 'none found' : 'the objects stage was not run' }],
    summary: b.objects.map((o) => ({ key: o.id, start: o.start, end: o.end, colour: s.objColour(s.identityOf(o)), flags: [] })) });

  // gestures
  const personOfFace = (f: string | null | undefined) => s.personOfFace(f);
  const gRows: Row[] = Object.keys(GESTURES).filter((k) => b.gestures.some((e) => e.kind === k)).map((kind) => {
    const mine = b.gestures.filter((e) => e.kind === kind), r = stack(mine);
    return { id: `gesture:${kind}`, label: { kind: 'text', text: GESTURES[kind] }, bars: mine.map((e, k): Bar => {
      const p = personOfFace(e.face);
      return { key: e.id, start: e.start, end: e.end, row: r[k], text: p ? s.nameOf(p) : '', colour: p ? s.colourOf(p) : NEUTRAL, sel: { kind: 'gesture', id: e.id },
        flags: flags(!s.includedId(e.id) && 'excluded', s.isSel('gesture', e.id) && 'selected'), title: `${GESTURES[kind]} · ${fmt(e.start)}–${fmt(e.end)}` };
    }) };
  });
  if (gRows.length) groups.push({ key: 'gestures', label: 'Gestures', count: `${gRows.reduce((n, r) => n + r.bars.length, 0)}`, rows: gRows,
    summary: gRows.flatMap((r) => r.bars).map((x) => ({ ...x, colour: NEUTRAL, flags: [], text: '' })) });

  // social: gaze events (Gaze-LLE) and facing
  const sRows: Row[] = Object.keys(GAZE_KINDS).filter((k) => b.gazeEvents.some((e) => e.kind === k)).map((kind) => {
    const mine = b.gazeEvents.filter((e) => e.kind === kind), r = stack(mine);
    return { id: `gaze:${kind}`, label: { kind: 'text', text: GAZE_KINDS[kind] }, bars: mine.map((e, k): Bar => {
      const text = gazeLabel(s, e), from = personOfFace(e.from);
      return { key: e.id, start: e.start, end: e.end, row: r[k], text, colour: from ? s.colourOf(from) : NEUTRAL, sel: { kind: 'gaze', id: e.id },
        flags: flags(!s.includedId(e.id) && 'excluded', s.isSel('gaze', e.id) && 'selected'), title: `${GAZE_KINDS[kind]} · ${text} · ${fmt(e.start)}–${fmt(e.end)}` };
    }) };
  });
  if (b.facing.length) {
    const r = stack(b.facing);
    sRows.push({ id: 'facing', label: { kind: 'text', text: 'Facing' }, bars: b.facing.map((e, k): Bar => {
      const text = facingLabel(s, e), from = personOfFace(e.from);
      return { key: e.id, start: e.start, end: e.end, row: r[k], text, colour: from ? s.colourOf(from) : NEUTRAL, sel: { kind: 'facing', id: e.id },
        flags: flags(!s.includedId(e.id) && 'excluded', s.isSel('facing', e.id) && 'selected'), title: `${text} · ${fmt(e.start)}–${fmt(e.end)}` };
    }) });
  }
  if (sRows.length) groups.push({ key: 'social', label: 'Social', count: `${sRows.reduce((n, r) => n + r.bars.length, 0)}`, rows: sRows,
    summary: sRows.flatMap((r) => r.bars).map((x) => ({ ...x, colour: NEUTRAL, flags: [], text: '' })) });

  // sounds
  if (b.layers.sounds) {
    const r = stack(b.sounds);
    const bars = b.sounds.map((x, k): Bar => ({ key: x.id, start: x.start, end: x.end, row: r[k], text: x.label, colour: '#90caf9', sel: { kind: 'sound', id: x.id },
      flags: flags(!s.includedSound(x) && 'excluded', x.agreement === false && 'unconfirmed', s.isSel('sound', x.id) && 'selected'),
      title: `${x.label} · ${x.sources.join(', ')}${x.agreement === false ? ' · no tagger agrees' : ''}` }));
    groups.push({ key: 'sounds', label: 'Sounds', count: `${bars.length}`, rows: [{ id: 'sounds', label: { kind: 'text', text: 'Sound events' }, bars }], summary: bars });
  }

  // on-screen text
  if (b.layers.text) {
    const texts = [...b.texts].sort((x, y) => x.start - y.start), r = stack(texts);
    const bars = texts.map((x, k): Bar => ({ key: x.id, start: x.start, end: x.end, row: r[k], text: x.text, colour: '#ffe082', sel: { kind: 'text', id: x.id },
      flags: flags(!s.includedId(x.id) && 'excluded', s.isSel('text', x.id) && 'selected'), title: x.text }));
    groups.push({ key: 'text', label: 'On-screen text', count: `${bars.length}`, rows: [{ id: 'text', label: { kind: 'text', text: 'Text' }, bars }], summary: bars });
  }

  // the user's annotations
  const notes = [...S.notes.values()];
  const typeRows: Row[] = S.types.map((type) => {
    const mine = notes.filter((n) => n.type === type.id).sort((a, c) => a.start - c.start), r = stack(mine);
    return { id: `type:${type.id}`, create: type.id, hint: 'drag across this row, or press A, to annotate',
      label: { kind: 'type', type: type.id, text: type.name },
      bars: mine.map((n, k): Bar => ({ key: n.id, start: n.start, end: n.end, row: r[k], sel: { kind: 'note', id: n.id },
        text: [s.hasValue(n) ? s.noteValue(n) : '', n.person ? s.nameOf(s.root(n.person)) : ''].filter(Boolean).join(' · '), colour: n.person ? s.colourOf(s.root(n.person)) : '#ce93d8',
        flags: flags(!s.hasValue(n) && 'unconfirmed', s.isSel('note', n.id) && 'selected'), title: `${type.name}: ${s.noteValue(n)}` })) };
  });
  groups.push({ key: 'annotations', label: 'Annotations', count: `${notes.length}`,
    rows: typeRows.length ? typeRows : [{ id: 'no-types', label: { kind: 'text', text: 'No types yet' }, bars: [], hint: '+ beside Annotations adds a type: what you code, as a row of its own', hideable: false }],
    summary: notes.map((n) => ({ key: n.id, start: n.start, end: n.end, colour: '#ce93d8', flags: [] })) });

  return groups;
}

export function gazeLabel(s: Session, e: { kind: string; from: string; to: string | null; object: string | null; also: string | null }) {
  const name = (f: string | null) => { const p = s.personOfFace(f); return p ? s.nameOf(p) : null; };
  const who = name(e.from) ?? '?', also = name(e.also);
  const target = e.object ? s.lookName(e.object) : name(e.to);
  if (e.kind === 'mutual_gaze') return `${who} ⇄ ${target ?? '?'}`;
  if (e.kind === 'joint_attention') return `${who} + ${also ?? '?'} → ${target ?? '?'}`;
  return `${who} → ${target ?? '?'}`;
}

export function facingLabel(s: Session, e: { from: string; to: string; mutual: boolean }) {
  const name = (f: string) => { const p = s.personOfFace(f); return p ? s.nameOf(p) : '?'; };
  return `${name(e.from)} ${e.mutual ? '⇄' : '→'} ${name(e.to)}`;
}

/** Groups and their rows as the viewer arranged them: hidden groups and rows left out, the viewer's order applied. */
export function arrange(groups: Group[], v: ViewState) {
  const rank = (k: string) => { const i = v.groupOrder.indexOf(k); return i >= 0 ? i : 1000 + GROUP_KEYS.indexOf(k as GroupKey); };
  return groups.filter((g) => !v.hiddenGroups.includes(g.key)).sort((a, b) => rank(a.key) - rank(b.key)).map((g) => ({
    group: g,
    collapsed: v.collapsed.includes(g.key),
    hiddenHere: v.hidden.filter((id) => g.rows.some((r) => r.id === id)),
    rows: ordered(g.rows.filter((r) => !v.hidden.includes(r.id)), (r) => r.id, v.rowOrder[g.key] ?? []),
  }));
}

/** A row's height: the viewer's, else its own, else a ROW_H per sub-row. */
export function rowHeight(row: Row, heights: Record<string, number>) {
  const resizable = row.hideable !== false;
  return (resizable && heights[row.id]) || row.height || Math.max(1, ...row.bars.map((x) => (x.row ?? 0) + 1)) * ROW_H + 2;
}

/** The speaker a drop on a row means, or null when that row cannot take this utterance's speech. */
export function speakerForDrop(s: Session, u: Utterance, drop: Drop) {
  if ('person' in drop) return s.speakerForPerson(u, drop.person);
  if ('voice' in drop) return { kind: 'offscreen', voice: drop.voice } as const;
  return { kind: 'unsure' } as const;
}

