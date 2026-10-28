import { expect, test } from 'vitest';
import { accessOf, allGranted, gatedModels, grantedBy, perModel, repoOf, shortName } from './hfAccess';
import type { CheckResult, ModelAccess, ModelInfo } from './pipeline';

const info = (node: string, id: string, source: string | null, gated = true): ModelInfo => ({ node, id, source, size_gb: 1, gated, licence_mode: 'commercial-ok' });
const access = (repo: string, a: ModelAccess['access']): ModelAccess => ({ id: repo, repo, revision: 'r', nodes: [], gating: null, access: a, reason: null });

test('each gated model is listed once, with every step that uses it; others are left out', () => {
  expect(gatedModels([
    info('vision.objects@1.0.0', 'facebook/sam3', 'hf://facebook/sam3@3c87'),
    info('vision.reuse@1.0.0', 'facebook/sam3', 'hf://facebook/sam3@3c87/sam3.pt'),
    info('audio.asr@1.0.0', 'mlx-community/parakeet', 'hf://mlx-community/parakeet', false),
    info('audio.diarize@1.1.0', 'pyannote/speaker-diarization-community-1', null),
  ])).toEqual([
    { repo: 'facebook/sam3', id: 'facebook/sam3', nodes: ['vision.objects@1.0.0', 'vision.reuse@1.0.0'] },
    { repo: 'pyannote/speaker-diarization-community-1', id: 'pyannote/speaker-diarization-community-1', nodes: ['audio.diarize@1.1.0'] },
  ]);
  expect(repoOf({ id: 'x', source: 'hf://owner/name@rev/file.bin' })).toBe('owner/name');
});

test('models are called as people say them, and how access is granted is said by who grants it', () => {
  expect(shortName('facebook/dinov3-vitl16-pretrain-lvd1689m')).toBe('DINOv3');
  expect(shortName('someone/other-model')).toBe('other-model');
  expect(grantedBy('facebook/sam3', 'manual')).toBe('Meta reviews requests');
  expect(grantedBy('lab/thing', 'manual')).toBe('lab reviews requests');
  expect(grantedBy('pyannote/x', 'auto')).toBe('Granted on accepting the terms');
  expect(grantedBy('pyannote/x', null)).toBeNull();
});

test('set up means a token Hugging Face accepts and every model granted; an older pipeline never is', () => {
  const repos = ['a/one', 'a/two'];
  const check = (ok: boolean, ...a: ModelAccess['access'][]): CheckResult => ({ ok, detail: '', account: 'ana', models: a.map((x, i) => access(repos[i], x)) });
  expect(allGranted(check(true, 'granted', 'granted'), repos)).toBe(true);
  expect(allGranted(check(true, 'granted', 'not-granted'), repos)).toBe(false);
  expect(allGranted(check(true, 'granted', 'unknown'), repos)).toBe(false);
  expect(allGranted(check(true, 'granted'), repos)).toBe(false);                 // a model the answer does not name
  expect(allGranted(check(false, 'granted', 'granted'), repos)).toBe(false);
  const older = { ok: true, detail: 'Hugging Face accepted the key' };
  expect(perModel(older)).toBe(false);
  expect(allGranted(older, repos)).toBe(false);
  expect(accessOf(older, 'a/one')).toBeNull();
  expect(accessOf(check(true, 'not-granted'), 'a/one')?.access).toBe('not-granted');
});
