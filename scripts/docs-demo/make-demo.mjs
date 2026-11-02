// Makes the docs' demo: a drawn video (scene.js) and the bundle the pipeline would make of it, with every box taken
// from the drawing, so screenshots of the annotator can be published. Needs Chrome and ffmpeg.
//   node scripts/docs-demo/make-demo.mjs [out]      (out: scripts/docs-demo/out; it gets cafe.mp4 and bundle/)
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? join(here, 'out');
const bundle = join(out, 'bundle');
rmSync(bundle, { recursive: true, force: true });   // the folder stays: it may be being served
for (const d of ['layers', 'assets/crops']) mkdirSync(join(bundle, d), { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.setContent('<canvas id=c width=1280 height=720></canvas>');
await page.addScriptTag({ content: readFileSync(join(here, 'scene.js'), 'utf8').replace(/^export /gm, '') });
const { W, H, DURATION, FPS, SHOTS, LINES, LAUGH } = await page.evaluate(() => ({ W, H, DURATION, FPS, SHOTS, LINES, LAUGH }));
const layout = (t) => page.evaluate((t) => layout(t), t);
const r3 = (x) => Math.round(x * 1000) / 1000;

// ---- the video ----
const frames = mkdtempSync(join(tmpdir(), 'demo-frames-'));
for (let i = 0; i < DURATION * FPS; i++) {
  const url = await page.evaluate((t) => { draw(document.getElementById('c').getContext('2d'), t); return document.getElementById('c').toDataURL('image/jpeg', 0.95); }, i / FPS);
  writeFileSync(join(frames, `f${String(i).padStart(4, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
}
const video = join(out, 'cafe.mp4');
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', join(frames, 'f%04d.jpg'), '-c:v', 'libx264',
  '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', video]);
rmSync(frames, { recursive: true });

/** A square crop around a box at t, as the pipeline's crops are. */
async function crop(t, box, file) {
  const url = await page.evaluate(([t, [x, y, w, h]]) => {
    const c = document.getElementById('c'); draw(c.getContext('2d'), t);
    const s = Math.max(w, h) * 1.25, o = Object.assign(document.createElement('canvas'), { width: 160, height: 160 });
    o.getContext('2d').drawImage(c, x + w / 2 - s / 2, y + h / 2 - s / 2, s, s, 0, 0, 160, 160);
    return o.toDataURL('image/jpeg', 0.9);
  }, [t, box]);
  writeFileSync(join(bundle, file), Buffer.from(url.split(',')[1], 'base64'));
  return file;
}

// ---- the layers ----
const model = (id, source, licence, licence_mode) => ({ id, source, revision: null, licence, licence_mode });
const producer = (stage, models) => ({ stage, stage_version: '1.1.0', models, config: {}, device: 'mps', run_at: '2026-11-02T12:00:00+00:00', timings: {} });
const base = (layer, stage, models) => ({ layer, schema_version: '0.1.0', producer: producer(stage, models) });
const shotOf = (t) => `shot:${SHOTS.findIndex((s) => t >= s.start && t < s.end)}`;

const CAPTIONS = [
  { description: 'Two people sit across a café table. The one with her hair in a bun, a laptop open in front of her, asks a question; the one in glasses listens.', setting: 'A bright café with a window, pendant lamps and a plant', mood: 'Relaxed' },
  { description: 'Close-up of the person with her hair in a bun, offering to read the draft.', setting: 'The café, out of focus', mood: 'Friendly' },
  { description: 'Close-up of the person in glasses and a yellow sweater, smiling as they answer.', setting: 'The café, out of focus', mood: 'Grateful' },
  { description: 'Back to both at the table. The person in glasses laughs, then offers to buy the next coffee.', setting: 'A bright café with a window, pendant lamps and a plant', mood: 'Warm, amused' },
];
const CAPTION_MODEL = 'claude-haiku-5-5';
const layers = {};
layers.shots = { ...base('shots', 'core.decode', [model('PySceneDetect', 'https://www.scenedetect.com', 'BSD-3-Clause', 'commercial-ok'), model(CAPTION_MODEL, 'https://www.anthropic.com', 'Anthropic API terms', 'api-terms')]),
  shots: SHOTS.map((s, i) => ({ id: `shot:${i}`, index: i, start: s.start, end: s.end, caption: { ...CAPTIONS[i], model: CAPTION_MODEL } })) };

layers.transcript = { ...base('transcript', 'audio.asr', [model('nvidia/parakeet-tdt-0.6b-v3', 'https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3', 'CC-BY-4.0', 'commercial-ok')]),
  voices: [{ id: 'voice:0' }, { id: 'voice:1' }],
  utterances: LINES.map((l, i) => ({ id: `utt:${i}`, start: l.start, end: l.end, text: l.text, shot: shotOf(l.start), voice: `voice:${l.who - 1}` })) };

// face tracks: one per person per shot, sampled at 8 Hz from the drawing
const SAMPLE_FPS = 8;
const tracks = [];
for (const [i, s] of SHOTS.entries()) {
  const L = await layout(s.start);
  for (const h of L.heads) {
    const samples = [];
    for (let t = s.start; t < s.end - 1e-9; t += 1 / SAMPLE_FPS) {
      const head = (await layout(t)).heads.find((x) => x.who === h.who);
      samples.push({ t: r3(t), box: head.face });
    }
    tracks.push({ id: `face:${tracks.length}`, who: h.who, shot: `shot:${i}`, start: s.start, end: r3(s.end - 1 / SAMPLE_FPS), samples });
  }
}
// clustering keeps the second person's close-up apart (a lone close-up is a common miss): Person 3, whom Review offers to merge
const personOf = (tr) => (tr.who === 1 ? 'person:Person 1' : tr.shot === 'shot:2' ? 'person:Person 3' : 'person:Person 2');
for (const tr of tracks) tr.crop = await crop(tr.start + 1, tr.samples[SAMPLE_FPS].box, `assets/crops/${tr.id.replace(':', '_')}.jpg`);
const people = [];
for (const p of ['person:Person 1', 'person:Person 2', 'person:Person 3']) {
  const mine = tracks.filter((tr) => personOf(tr) === p);
  people.push({ id: p, first_seen: mine[0].start, seconds_on_screen: r3(mine.reduce((a, tr) => a + tr.end - tr.start, 0)), crop: mine[p === 'person:Person 1' ? 1 : 0].crop, shots: mine.map((tr) => tr.shot) });
}
layers.faces = { ...base('faces', 'vision.face-track', [model('py-feat RetinaFace', 'https://py-feat.org', 'MIT (weights: non-commercial)', 'academic-only'), model('ArcFace (InsightFace buffalo_l)', 'https://github.com/deepinsight/insightface', 'Non-commercial research', 'academic-only')]),
  sample_fps: SAMPLE_FPS, detail: null, people,
  tracks: tracks.map(({ who, ...tr }) => ({ ...tr, person: personOf({ who, ...tr }) })),
  person_pairs: [{ a: 'person:Person 2', b: 'person:Person 3', distance: 0.41, co_visible: false }, { a: 'person:Person 1', b: 'person:Person 2', distance: 1.32, co_visible: true }] };
const faceOf = (who, shot) => tracks.find((tr) => tr.who === who && tr.shot === shot).id;

// who speaks: sure where one face is on screen, less so in the wide shot at the end (and wrong once, for Review)
const SPEAKERS = [[2.6, 0.4], [2.1, 0.5], [3.4], [3.2], [0.9, 1.2], [1.4, 0.8]];
layers.speakers = { ...base('speakers', 'vision.active-speaker', [model('LR-ASD', 'https://github.com/Junhua-Liao/LR-ASD', 'MIT', 'commercial-ok')]),
  utterances: LINES.map((l, i) => {
    const shot = shotOf(l.start), on = tracks.filter((tr) => tr.shot === shot);
    const right = faceOf(l.who, shot), other = on.find((tr) => tr.id !== right)?.id;
    const [a, b] = SPEAKERS[i];
    const candidates = [{ face: right, score: a }, ...(other ? [{ face: other, score: b }] : [])].sort((x, y) => y.score - x.score);
    return { utt: `utt:${i}`, predicted: { kind: 'face', face: candidates[0].face }, candidates, margin: other ? r3(Math.abs(a - b)) : 3, second_opinion_agrees: null };
  }) };

// objects: the cups and the laptop, in the wide shots
const objTracks = [], identities = {};
const NAMES = { 'cup-1': 'white mug', 'cup-2': 'blue mug', laptop: 'laptop' };
for (const [i, s] of SHOTS.entries()) {
  if (s.view !== 'wide') continue;
  for (const o of (await layout(s.start)).objects) {
    const id = `obj:${objTracks.length}`, [x, y, w, h] = o.box, samples = [];
    for (let t = s.start; t < s.end - 1e-9; t += 0.25) samples.push({ t: r3(t), box: o.box, poly: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], score: 0.91 });
    objTracks.push({ id, label: NAMES[o.id], identity: `object:${NAMES[o.id]}`, shot: `shot:${i}`, start: s.start, end: r3(s.end - 0.25), wearer: null, samples });
    (identities[o.id] ??= { id: `object:${NAMES[o.id]}`, label: NAMES[o.id], family: o.label, worn_by: [], tracks: [], crop: await crop(1, o.box, `assets/crops/object_${o.id}.jpg`) }).tracks.push(id);
  }
}
layers.objects = { ...base('objects', 'vision.objects', [model('SAM 3', 'https://huggingface.co/facebook/sam3', 'SAM License', 'needs-review'), model(CAPTION_MODEL, 'https://www.anthropic.com', 'Anthropic API terms', 'api-terms')]),
  fps: 4, tracks: objTracks, identities: Object.values(identities) };

layers.sounds = { ...base('sounds', 'audio.sounds', [model('PE-A-Frame', 'https://github.com/facebookresearch/perception_models', 'FAIR Noncommercial Research', 'academic-only'), model('BEATs', 'https://github.com/microsoft/unilm/tree/master/beats', 'MIT', 'commercial-ok')]),
  events: [
    { id: 'sound:0', label: 'music', start: 0, end: DURATION, sources: ['pe-a-frame', 'beats'], agreement: true, score: 0.82 },
    { id: 'sound:1', label: 'dishes', start: 5.55, end: 5.9, sources: ['pe-a-frame'], agreement: false, score: 0.36 },
    { id: 'sound:2', label: 'laughter', start: LAUGH.start, end: LAUGH.end, sources: ['pe-a-frame', 'beats'], agreement: true, score: 0.9 },
  ] };

layers.facing = { ...base('facing', 'vision.facing', [model('RTMPose (head yaw)', 'https://github.com/open-mmlab/mmpose', 'Apache-2.0', 'commercial-ok')]),
  events: SHOTS.flatMap((s, i) => s.view === 'wide' ? [{ id: `facing:${i}`, from: faceOf(1, `shot:${i}`), to: faceOf(2, `shot:${i}`), mutual: true, start: s.start, end: s.end, score: 0.88 }] : []) };

// the waveform (peaks 0-100): louder where someone speaks or laughs, over quiet music
const HZ = 50, rand = ((s) => () => ((s = (s * 16807) % 2147483647) / 2147483647))(7);
const loud = (t) => LINES.some((l) => t >= l.start && t <= l.end) ? 0.55 + 0.35 * Math.abs(Math.sin(t * 9)) : t >= LAUGH.start && t <= LAUGH.end ? 0.75 : 0.12;
layers.waveform = { ...base('waveform', 'audio.waveform', []), hz: HZ,
  peaks: Array.from({ length: DURATION * HZ }, (_, k) => Math.round(100 * Math.min(1, loud(k / HZ) * (0.7 + 0.3 * rand())))) };   // 0-100

// ---- the manifest ----
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const entry = (file) => { const b = readFileSync(join(bundle, file)); return { file, sha256: sha(b), bytes: b.length }; };
const LICENCE = { shots: 'api-terms', transcript: 'commercial-ok', speakers: 'commercial-ok', faces: 'academic-only', objects: 'needs-review',
  sounds: 'academic-only', facing: 'commercial-ok', waveform: 'commercial-ok' };
const manifestLayers = {};
for (const [name, layer] of Object.entries(layers)) {
  writeFileSync(join(bundle, `layers/${name}.json`), JSON.stringify(layer));
  manifestLayers[name] = { ...entry(`layers/${name}.json`), licence_mode: LICENCE[name], stage: layer.producer.stage };
}
const assets = [...tracks.map((tr) => tr.crop), ...Object.values(identities).map((o) => o.crop)].map(entry);
writeFileSync(join(bundle, 'manifest.json'), JSON.stringify({
  format: 'hyperstudy-perception-bundle', schema_version: '0.1.0', created_at: '2026-11-02T12:00:00+00:00',
  pipeline: { name: 'hyperstudy-perception', version: '0.1.6' },
  video: { sha256: sha(readFileSync(video)), duration: DURATION, fps: FPS, width: W, height: H, filename: 'cafe.mp4' },
  layers: manifestLayers, assets,
}, null, 2));
await browser.close();
console.log(`wrote ${video} and ${bundle}`);
