// A small synthetic bundle the browser tests serve to the page themselves (page.route): two shots, three people's face
// tracks and two sounds, no video. Nothing in it comes from a study, so the tests that use it run everywhere, CI
// included (the bake-off data at /devdata is only on a lab machine).
import type { Page } from '@playwright/test';

const producer = { stage: 't', stage_version: '0', models: [], config: {}, device: null, run_at: null, timings: {} };
const base = (layer: string) => ({ layer, schema_version: '0.1.0', producer });
const face = (id: number, person: string | null, shot: number, start: number, end: number, x = 0) => {
  const samples = [];
  for (let t = start; t <= end + 1e-9; t += 0.125) samples.push({ t: Math.round(t * 1000) / 1000, box: [x, 0, 100, 100] });
  return { id: `face:${id}`, person, shot: `shot:${shot}`, start, end, samples };
};
const LAYERS: Record<string, unknown> = {
  shots: { ...base('shots'), shots: [
    { id: 'shot:0', index: 0, start: 0, end: 10, caption: { description: 'two people' } },
    { id: 'shot:1', index: 1, start: 10, end: 20, caption: null },
  ] },
  faces: { ...base('faces'), sample_fps: 8, detail: null,
    tracks: [face(0, 'person:Person A', 0, 0, 4), face(1, 'person:Person B', 0, 0, 4, 500), face(2, 'person:Person C', 1, 10, 14)],
    people: ['A', 'B', 'C'].map((l) => ({ id: `person:Person ${l}`, first_seen: 0, seconds_on_screen: 1, crop: null, shots: [] })),
    person_pairs: [] },
  sounds: { ...base('sounds'), events: [
    { id: 'sound:0', label: 'music', start: 0, end: 5, sources: ['a'], agreement: true, score: null },
    { id: 'sound:1', label: 'laughter', start: 6, end: 7, sources: ['pe-a-frame'], agreement: false, score: 0.4 },
  ] },
};
const MANIFEST = {
  format: 'hyperstudy-perception-bundle', schema_version: '0.1.0', created_at: '2026-10-28T00:00:00+00:00',
  pipeline: { name: 'hyperstudy-perception', version: 'test' },
  video: { sha256: 'e'.repeat(64), duration: 20, fps: 25, width: 1920, height: 1080, filename: 'synthetic.mp4' },
  layers: Object.fromEntries(Object.keys(LAYERS).map((n) => [n, { file: `layers/${n}.json`, sha256: '0'.repeat(64), bytes: 1, licence_mode: 'commercial-ok', stage: 't' }])),
};

/** The viewer on the synthetic bundle, its timeline drawn. */
export async function openSynthetic(page: Page) {
  await page.route('**/synthetic/bundle/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/synthetic\/bundle\//, '');
    const body = path === 'manifest.json' ? MANIFEST : LAYERS[path.replace(/^layers\/|\.json$/g, '')];
    return body ? route.fulfill({ json: body }) : route.fulfill({ status: 404 });
  });
  await page.goto('/?bundle=/synthetic/bundle');
  await page.locator('.tl-content').waitFor();
}
