import { expect, test } from 'vitest';
import { blockers, canPick, duration, foldRun, picked, placeLabel, placeName, placesFor, schedule, runnable, totalEstimate, type Plan, type PlanNode, type PipelineMessage } from './pipeline';

const ev = (node: string | null, kind: string, message = ''): PipelineMessage => ({ v: 1, type: 'event', run: 'r1', node, kind, message, at: '' });

test('each node shows its latest state from the events, and the run its outcome', () => {
  const v = foldRun(['decode', 'faces', 'captions'], [
    { v: 1, type: 'run.created', run: 'r1', store: '/s' },
    ev('decode', 'task.cached', 'abc'),
    ev('faces', 'task.started', 'attempt 1 on native (mps)'),
    ev('faces', 'task.retry', 'attempt 1 failed (timeout); retry in 2 s'),
    ev('faces', 'task.started', 'attempt 2 on native (mps)'),
    ev('faces', 'task.succeeded', '96.1 s'),
    ev('captions', 'task.failed', 'budget: estimated $0.16 would exceed the run cap of $0.10'),
    ev(null, 'run.failed'),
    { v: 1, type: 'run.finished', run: 'r1', status: 'failed' },
  ]);
  expect(v.run).toBe('r1');
  expect(v.nodes).toEqual({
    decode: { state: 'cached', message: '' },
    faces: { state: 'succeeded', message: '96.1 s' },
    captions: { state: 'failed', message: 'budget: estimated $0.16 would exceed the run cap of $0.10' },
  });
  expect(v.status).toBe('failed');
});

test('the imported bundle and any error are kept', () => {
  const bundle = { id: 'b1' } as never;
  expect(foldRun(['a'], [{ v: 1, type: 'imported', run: 'r1', bundle }]).imported).toBe(bundle);
  expect(foldRun(['a'], [{ v: 1, type: 'error', problems: ['uv is missing'] }]).problems).toEqual(['uv is missing']);
});

const NONE = { downloads: false, uploads: false }, ALL = { downloads: true, uploads: true };

test('a plan can run when every node has a place and its secrets, downloads allowed or not needed', () => {
  const node: PlanNode = { id: 'a', uses: 'x@1', where: 'native (mps)', why_not: '', cached: false, downloads: [], missing_secrets: [], cost_usd: 0, cost_note: '', uploads: [] };
  const plan = (n: Partial<PlanNode>): Plan => ({ ok: false, estimated_usd: 0, nodes: [{ ...node, ...n }] });
  expect(runnable(plan({}), NONE)).toBe(true);
  expect(runnable(plan({ where: null, why_not: 'needs cuda' }), ALL)).toBe(false);
  expect(runnable(plan({ missing_secrets: ['ANTHROPIC_API_KEY'] }), ALL)).toBe(false);
  const needs = plan({ downloads: [{ id: 'w', source: 'hf://x', size_gb: 1, gated: false, licence_mode: 'academic-only' }] });
  expect(runnable(needs, NONE)).toBe(false);
  expect(runnable(needs, { downloads: true, uploads: false })).toBe(true);
  // a cached node that has nowhere to run here still blocks (the CLI checks the whole graph), and says why
  expect(blockers(plan({ cached: true, where: null, why_not: 'needs cuda' }), ALL)).toEqual(['a cannot run here: needs cuda']);
});

test('data leaving this machine needs the same consent as a download, and a plan that does not say is not run', () => {
  const node: PlanNode = { id: 'captions', uses: 'x@1', where: 'native (cpu)', why_not: '', cached: false, downloads: [], missing_secrets: [], cost_usd: 0.1, cost_note: '', uploads: ['frames'] };
  const plan = (n: Partial<PlanNode>): Plan => ({ ok: true, estimated_usd: 0.1, nodes: [{ ...node, ...n }] });
  expect(blockers(plan({}), NONE)).toEqual(['captions sends frames off this machine (tick the box below the plan)']);
  expect(runnable(plan({}), { downloads: false, uploads: true })).toBe(true);
  const older = plan({});
  delete older.nodes[0].uploads;   // a CLI from before plans said what leaves the machine
  expect(blockers(older, ALL)).toEqual(['the pipeline does not say what captions sends off this machine (update hyperstudy-perception)']);
});

test('consent to upload covers cached nodes too (a cache can be gone by the time the run starts)', () => {
  const node: PlanNode = { id: 'captions', uses: 'x@1', where: 'native (cpu)', why_not: '', cached: true, downloads: [], missing_secrets: [], cost_usd: 0, cost_note: '', uploads: ['frames'] };
  expect(blockers({ ok: true, estimated_usd: 0, nodes: [node] }, NONE)).toEqual(['captions sends frames off this machine (tick the box below the plan)']);
});

test('times read as people say them, and a plan totals what will run (not what is cached)', () => {
  expect(duration(1.8)).toBe('2 s');
  expect(duration(96)).toBe('1 min 36 s');
  expect(duration(3725)).toBe('1 h 2 min');
  const node = (id: string, estimate_s: number | null, cached = false): PlanNode => ({ id, uses: 'x@1', where: 'native (cpu)', why_not: '', cached,
    downloads: [], missing_secrets: [], cost_usd: 0, cost_note: '', uploads: [], estimate_s, estimate_basis: '' });
  expect(totalEstimate({ ok: true, estimated_usd: 0, nodes: [node('decode', 30, true), node('asr', 2), node('faces', 96)] })).toEqual({ seconds: 98, fastest: 98, unknown: [] });
  expect(totalEstimate({ ok: true, estimated_usd: 0, nodes: [node('asr', 2), node('faces', null)] })).toEqual({ seconds: 2, fastest: 2, unknown: ['faces'] });
});

test('a CLI that gives no estimates shows none, rather than nothing estimated', () => {
  const node: PlanNode = { id: 'asr', uses: 'x@1', where: 'native (cpu)', why_not: '', cached: false, downloads: [], missing_secrets: [], cost_usd: 0, cost_note: '', uploads: [] };
  expect(totalEstimate({ ok: true, estimated_usd: 0, nodes: [node] })).toBeNull();
});

test('unticking a step drops every step that needs it, and the rest is what runs', () => {
  const node = (id: string, needs: string[]): PlanNode => ({ id, uses: 'x@1', where: 'native (cpu)', why_not: '', cached: false, downloads: [],
    missing_secrets: [], cost_usd: 0, cost_note: '', uploads: [], needs });
  const plan: Plan = { ok: true, estimated_usd: 0, nodes: [node('decode', []), node('asr', ['decode']), node('faces', ['decode']), node('captions', ['decode', 'asr', 'faces'])] };
  expect(picked(plan, new Set())).toEqual({ chosen: ['decode', 'asr', 'faces', 'captions'], dropped: [], only: null });
  expect(picked(plan, new Set(['faces']))).toEqual({ chosen: ['decode', 'asr'], dropped: ['faces', 'captions'], only: ['decode', 'asr'] });
  expect(picked(plan, new Set(['decode'])).chosen).toEqual([]);   // everything needs decode
});

test('places are sent only for the steps that run (the CLI refuses a place for a node --only left out)', () => {
  expect(placesFor({ faces: 'native:cpu', asr: 'native:cpu' }, ['decode', 'asr'])).toEqual({ asr: 'native:cpu' });
});

test('steps can be chosen only when the plan says what each needs (a CLI from before it did would run a step without its inputs)', () => {
  const node = (id: string, needs?: string[]): PlanNode => ({ id, uses: 'x@1', where: 'native (cpu)', why_not: '', cached: false, downloads: [],
    missing_secrets: [], cost_usd: 0, cost_note: '', uploads: [], ...(needs ? { needs } : {}) });
  expect(canPick({ ok: true, estimated_usd: 0, nodes: [node('decode', []), node('faces', ['decode'])] })).toBe(true);
  expect(canPick({ ok: true, estimated_usd: 0, nodes: [node('decode'), node('faces')] })).toBe(false);
});

test('each place in the menu says how long the step would take there, when the plan says', () => {
  const node: PlanNode = { id: 'faces', uses: 'x@1', where: 'native (mps)', why_not: '', cached: false, downloads: [], missing_secrets: [],
    cost_usd: 0, cost_note: '', uploads: [], options: ['native:mps', 'native:cpu'],
    estimates: { 'native:mps': { estimate_s: 96, estimate_basis: '' }, 'native:cpu': { estimate_s: null, estimate_basis: '' } } };
  expect(placeLabel(node, 'native:mps')).toBe('Apple GPU, about 1 min 36 s');
  expect(placeLabel(node, 'native:cpu')).toBe('CPU, no estimate yet');
  expect(placeLabel({ ...node, estimates: undefined }, 'native:cpu')).toBe('CPU');   // an older CLI
});

test('places read as people say them', () => {
  expect(placeName('native:mps')).toBe('Apple GPU');
  expect(placeName('native:cpu')).toBe('CPU');
  expect(placeName('ssh:cuda')).toBe('NVIDIA GPU on ssh');
  expect(placeName('native:tpu')).toBe('tpu');
});

test('steps start after what they need, side by side otherwise, and the time is a range between the two ways of running', () => {
  const node = (id: string, needs: string[], estimate_s: number | null, cached = false): PlanNode => ({ id, uses: 'x@1', where: 'native (cpu)', why_not: '',
    cached, downloads: [], missing_secrets: [], cost_usd: 0, cost_note: '', uploads: [], needs, estimate_s, estimate_basis: '' });
  const plan: Plan = { ok: true, estimated_usd: 0, nodes: [node('decode', [], 30, true), node('asr', ['decode'], 2), node('faces', ['decode'], 96),
    node('captions', ['decode', 'asr', 'faces'], 176)] };
  expect(schedule(plan)).toEqual({ asr: { start: 0, seconds: 2 }, faces: { start: 0, seconds: 96 }, captions: { start: 96, seconds: 176 } });
  expect(totalEstimate(plan)).toEqual({ seconds: 274, fastest: 272, unknown: [] });
  const unknown = { ...plan, nodes: plan.nodes.map((n) => n.id === 'faces' ? { ...n, estimate_s: null } : n) };
  expect(schedule(unknown).captions).toEqual({ start: 2, seconds: 176 });   // a step with no estimate holds nothing up
  expect(totalEstimate(unknown)).toEqual({ seconds: 178, fastest: 178, unknown: ['faces'] });
});

test('a plan that does not say what each step needs is drawn one step after another, not all at once', () => {
  const node = (id: string, estimate_s: number, cached = false): PlanNode => ({ id, uses: 'x@1', where: 'native (cpu)', why_not: '', cached,
    downloads: [], missing_secrets: [], cost_usd: 0, cost_note: '', uploads: [], estimate_s, estimate_basis: '' });
  const plan: Plan = { ok: true, estimated_usd: 0, nodes: [node('decode', 30, true), node('asr', 2), node('faces', 96)] };
  expect(schedule(plan)).toEqual({ asr: { start: 0, seconds: 2 }, faces: { start: 2, seconds: 96 } });
  expect(totalEstimate(plan)).toEqual({ seconds: 98, fastest: 98, unknown: [] });   // no range the app cannot vouch for
});
