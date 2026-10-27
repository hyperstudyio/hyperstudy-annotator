import { expect, test } from 'vitest';
import { defaultsFor, loadDefaults, saveDefault, withDefaults } from './stepDefaults';
import type { Plan } from './pipeline';

const captions = (value: string) => ({ id: 'captions', uses: 'vlm.shot-captions@1.0.0',
  settings: [{ key: 'model', description: '', value, choices: ['claude-haiku-5-5', 'claude-opus-5-5'], prices: null, per: null }] });
const plan = (value: string) => ({ nodes: [captions(value), { id: 'asr', uses: 'audio.asr@1.0.0', settings: [] }] }) as unknown as Plan;
const opus = { 'vlm.shot-captions@1.0.0': { model: 'claude-opus-5-5' } };

test("a default the run has not chosen otherwise is the step's, by its id, whatever the plan has now", () => {
  expect(defaultsFor(plan('claude-haiku-5-5'), {}, opus)).toEqual({ captions: { model: 'claude-opus-5-5' } });
  expect(defaultsFor(plan('claude-opus-5-5'), {}, opus)).toEqual({ captions: { model: 'claude-opus-5-5' } });   // the same: planning stops
  expect(defaultsFor(plan('claude-haiku-5-5'), { captions: { model: 'claude-haiku-5-5' } }, opus)).toEqual({});   // this run's own choice
});

test("the run's own choices are over the defaults", () => {
  expect(withDefaults({ captions: { model: 'claude-opus-5-5', effort: 'high' } }, { captions: { effort: 'low' }, asr: { x: '1' } }))
    .toEqual({ captions: { model: 'claude-opus-5-5', effort: 'low' }, asr: { x: '1' } });
});

test('a default that is no longer one of the choices is left out', () => {
  expect(defaultsFor(plan('claude-haiku-5-5'), {}, { 'vlm.shot-captions@1.0.0': { model: 'claude-sonnet-4' } })).toEqual({});
});

test('defaults are kept per user, and none kept is the pipeline’s own', () => {
  const m = new Map<string, string>();
  const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as unknown as Storage;
  expect(loadDefaults(storage)).toEqual({});
  expect(saveDefault('vlm.shot-captions@1.0.0', 'model', 'claude-opus-5-5', storage).saved).toBe(true);
  saveDefault('vlm.shot-captions@1.0.0', 'effort', 'high', storage);
  expect(loadDefaults(storage)).toEqual({ 'vlm.shot-captions@1.0.0': { model: 'claude-opus-5-5', effort: 'high' } });
});

test('a default that cannot be kept is said so, and the one kept before stays', () => {
  const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } } as unknown as Storage;
  const r = saveDefault('vlm.shot-captions@1.0.0', 'model', 'claude-opus-5-5', full);
  expect(r.saved).toBe(false);
  expect(r.problem).toMatch(/QuotaExceededError/);
  expect(r.defaults).toEqual({});
});
