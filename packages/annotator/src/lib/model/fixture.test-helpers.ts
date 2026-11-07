// A small synthetic bundle for tests: two shots, three people, a handful of tracks and utterances.
import { Bundle, type Layers } from './bundle';
import type { FaceTrack, Manifest, Utterance } from '../types';

export const SHA = 'f'.repeat(64);

export class MemoryStorage implements Storage {
  #m = new Map<string, string>();
  get length() { return this.#m.size; }
  clear() { this.#m.clear(); }
  getItem(k: string) { return this.#m.get(k) ?? null; }
  key(i: number) { return [...this.#m.keys()][i] ?? null; }
  removeItem(k: string) { this.#m.delete(k); }
  setItem(k: string, v: string) { this.#m.set(k, v); }
}

const producer = { stage: 't', stage_version: '0', models: [], config: {}, device: null, run_at: null, timings: {} };
const base = (layer: string) => ({ layer, schema_version: '0.1.0', producer });

export function face(id: number, person: string | null, shot: number, start: number, end: number, x = 0): FaceTrack {
  const samples = [];
  for (let t = start; t <= end + 1e-9; t += 0.125) samples.push({ t: Math.round(t * 1000) / 1000, box: [x, 0, 100, 100] as [number, number, number, number] });
  return { id: `face:${id}`, person, shot: `shot:${shot}`, start, end, samples };
}
export const utt = (id: number, start: number, end: number, shot: number, voice: string | null = 'voice:SPEAKER_00'): Utterance =>
  ({ id: `utt:${id}`, start, end, text: `utterance ${id}`, shot: `shot:${shot}`, voice });

export function makeBundle(over: Partial<Layers> = {}, key: string | null = null): Bundle {
  const manifest: Manifest = {
    format: 'hyperstudy-perception-bundle', schema_version: '0.1.0', created_at: '', pipeline: { name: 't', version: '0' }, layers: {},
    video: { sha256: SHA, duration: 20, fps: 25, width: 1920, height: 1080, filename: 'clip.mp4' },
  };
  const tracks = [
    face(0, 'person:Person A', 0, 0, 4), face(1, 'person:Person B', 0, 0, 4, 500), face(2, 'person:Person A', 1, 10, 14),
    face(3, null, 1, 10, 12, 900), face(4, 'person:Person C', 1, 15, 18),
  ];
  const layers: Layers = {
    shots: { ...base('shots'), shots: [
      { id: 'shot:0', index: 0, start: 0, end: 10, caption: { description: 'two people' } },
      { id: 'shot:1', index: 1, start: 10, end: 20, caption: null },
    ] },
    transcript: { ...base('transcript'), voices: [{ id: 'voice:SPEAKER_00' }, { id: 'voice:SPEAKER_01' }], utterances: [
      utt(0, 0.5, 2, 0), utt(1, 2.5, 3.5, 0), utt(2, 10.5, 11.5, 1, 'voice:SPEAKER_01'), utt(3, 16, 17, 1),
    ] },
    speakers: { ...base('speakers'), utterances: [
      { utt: 'utt:0', predicted: { kind: 'face', face: 'face:0' }, candidates: [{ face: 'face:0', score: 3 }, { face: 'face:1', score: 1 }], margin: 2, second_opinion_agrees: true },
      { utt: 'utt:1', predicted: { kind: 'face', face: 'face:1' }, candidates: [{ face: 'face:1', score: 0.5 }, { face: 'face:0', score: 0.2 }], margin: 0.3, second_opinion_agrees: false },
      { utt: 'utt:2', predicted: { kind: 'offscreen', voice: 'voice:SPEAKER_01' }, candidates: [], margin: null, second_opinion_agrees: null },
      { utt: 'utt:3', predicted: { kind: 'offscreen', voice: 'voice:SPEAKER_00' }, candidates: [{ face: 'face:4', score: -1 }], margin: 1, second_opinion_agrees: null },
    ] },
    faces: { ...base('faces'), sample_fps: 8, detail: null, tracks,
      people: ['A', 'B', 'C'].map((l) => ({ id: `person:Person ${l}`, first_seen: 0, seconds_on_screen: 1, crop: null, shots: [] })),
      person_pairs: [
        { a: 'person:Person A', b: 'person:Person C', distance: 0.5, co_visible: false },
        { a: 'person:Person C', b: 'person:Person A', distance: 0.5, co_visible: false },
        { a: 'person:Person A', b: 'person:Person B', distance: 0.4, co_visible: true },
        { a: 'person:Person B', b: 'person:Person C', distance: 0.9, co_visible: false },
      ] },
    bodies: null, hands: null, gestures: null, facing: null, gaze: null, objects: null,
    sounds: { ...base('sounds'), events: [
      { id: 'sound:0', label: 'music', start: 0, end: 5, sources: ['a'], agreement: true, score: null },
      { id: 'sound:1', label: 'laughter', start: 6, end: 7, sources: ['pe-a-frame'], agreement: false, score: 0.4 },
    ] },
    text: null, prosody: null, waveform: null,
    ...over,
  };
  return new Bundle(manifest, layers, key);
}
