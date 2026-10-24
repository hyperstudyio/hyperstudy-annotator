import { expect, test } from 'vitest';
import { blockers, canPick, choiceLabel, consentFor, keepChoices, mustTurnOnFirst, tick, unagreed, defaultFeatures, duration, foldRun, picked, placeLabel, placeName, placesFor, schedule, settingsFor, runnable, totalEstimate, type Plan, type PlanNode, type PipelineMessage, type Setting, type Ticked } from './pipeline';

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

test('a plan can run when every node has a place and its secrets; downloads are part of running', () => {
  const node: PlanNode = { id: 'a', uses: 'x@1', where: 'native (mps)', why_not: '', cached: false, downloads: [], missing_secrets: [], cost_usd: 0, cost_note: '', uploads: [] };
  const plan = (n: Partial<PlanNode>): Plan => ({ ok: false, estimated_usd: 0, nodes: [{ ...node, ...n }] });
  expect(runnable(plan({}))).toBe(true);
  expect(runnable(plan({ where: null, why_not: 'needs cuda' }))).toBe(false);
  expect(runnable(plan({ missing_secrets: ['ANTHROPIC_API_KEY'] }))).toBe(false);
  expect(runnable(plan({ downloads: [{ id: 'w', source: 'hf://x', size_gb: 1, gated: false, licence_mode: 'academic-only' }] }))).toBe(true);
  // a cached node that has nowhere to run here still blocks (the CLI checks the whole graph), and says why
  expect(blockers(plan({ cached: true, where: null, why_not: 'needs cuda' }))).toEqual(['a cannot run here: needs cuda']);
});

test('turning on a feature that sends data off is the consent to send it, and a plan that does not say what leaves is not run', () => {
  const node: PlanNode = { id: 'captions', uses: 'x@1', where: 'native (cpu)', why_not: '', cached: false, downloads: [], missing_secrets: [], cost_usd: 0.1, cost_note: '', uploads: ['frames'], needs: [], settings: [] };
  const plan = (n: Partial<PlanNode>): Plan => ({ ok: true, estimated_usd: 0.1, nodes: [{ ...node, ...n }] });
  const t = (kinds: string[], service: string | null = null): Ticked => ({ captions: { kinds, service } });
  expect(consentFor(plan({}), t(['frames']))).toEqual({ uploads: { captions: ['frames'] } });   // exactly what it sends
  expect(consentFor(plan({ uploads: [] }), t(['frames']))).toEqual({ uploads: {} });   // nothing to send: none given
  expect(consentFor(plan({}), {})).toEqual({ uploads: {} });   // not ticked by the user: nothing agreed
  // agreeing to frames is not agreeing to the transcript too, nor to sending them to another service
  expect(consentFor(plan({ uploads: ['frames', 'transcript'] }), t(['frames']))).toEqual({ uploads: {} });
  expect(consentFor(plan({ service: 'Other API' }), t(['frames'], 'Anthropic API'))).toEqual({ uploads: {} });
  expect(unagreed(plan({ uploads: ['frames', 'transcript'] }), t(['frames']))).toEqual(['captions']);
  expect(tick(plan({ service: 'Anthropic API' }).nodes[0])).toEqual({ kinds: ['frames'], service: 'Anthropic API' });
  const beforeSettings = plan({});
  delete beforeSettings.nodes[0].settings;   // a CLI from before perception #14: no --allow-uploads
  expect(blockers(beforeSettings)).toEqual(['captions sends data off this machine and this pipeline cannot be told it may (update hyperstudy-perception)']);
  // a new plan: a step that sends no more than when it was ticked stays on; one that sends more (or a default that now
  // sends anything) goes off, its tick with it
  expect(keepChoices(plan({}), new Set(['captions']), t(['frames']))).toEqual({ wanted: new Set(['captions']), ticked: t(['frames']) });
  expect(keepChoices(plan({ uploads: ['frames', 'transcript'] }), new Set(['captions']), t(['frames']))).toEqual({ wanted: new Set(), ticked: {} });
  expect(keepChoices(plan({}), new Set(['captions']), {})).toEqual({ wanted: new Set(), ticked: {} });
  expect(keepChoices(plan({ uploads: [] }), new Set(['captions']), {}).wanted).toEqual(new Set(['captions']));   // sends nothing: stays
  const whole = plan({});
  delete whole.nodes[0].needs;   // cannot be chosen from: it runs whole, and blockers keeps it from sending
  expect([...keepChoices(whole, new Set(), {}).wanted]).toEqual(['captions']);
  expect(runnable(plan({}))).toBe(true);
  const older = plan({});
  delete older.nodes[0].uploads;   // a CLI from before plans said what leaves the machine
  expect(blockers(older)).toEqual(['the pipeline does not say what captions sends off this machine (update hyperstudy-perception)']);
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

test('turning a feature on runs what it needs too, and says which features need it', () => {
  const node = (id: string, needs: string[], extra: Partial<PlanNode> = {}): PlanNode => ({ id, uses: 'x@1', where: 'native (cpu)', why_not: '', cached: false, downloads: [],
    missing_secrets: [], cost_usd: 0, cost_note: '', uploads: [], needs, ...extra });
  const plan: Plan = { ok: true, estimated_usd: 0, nodes: [node('decode', []), node('asr', ['decode']), node('faces', ['decode']),
    node('captions', ['decode', 'asr', 'faces'], { uploads: ['frames'], cost_usd: 0.16 })] };
  expect(picked(plan, new Set(['faces']))).toEqual({ chosen: ['decode', 'faces'], neededBy: { decode: ['faces'] }, only: ['decode', 'faces'] });
  expect(picked(plan, new Set(['captions']))).toEqual({ chosen: ['decode', 'asr', 'faces', 'captions'],
    neededBy: { decode: ['asr', 'faces', 'captions'], asr: ['captions'], faces: ['captions'] }, only: null });
  // a feature turned on by the user is still held on while another needs it (turned off, it would come straight back)
  expect(picked(plan, new Set(['faces', 'captions'])).neededBy.faces).toEqual(['captions']);
  expect(picked(plan, new Set(['decode', 'faces'])).neededBy).toEqual({ decode: ['faces'] });
  expect(picked(plan, new Set()).chosen).toEqual([]);
  expect([...defaultFeatures(plan)]).toEqual(['decode', 'asr', 'faces']);   // captions sends data off and costs money
  const old = { ...plan, nodes: plan.nodes.map(({ needs: _, ...n }) => n) };
  expect([...defaultFeatures(old)]).toEqual(['decode', 'asr', 'faces', 'captions']);   // no needs: the whole graph
  // ...which cannot run while a step in it sends data off: nobody chose that step
  expect(blockers(old)).toEqual(['captions sends frames off this machine and this pipeline cannot leave it out (update hyperstudy-perception)']);
  // a free feature that needs one that sends data off is not on by default either: it would bring the other along
  const summary = node('summary', ['captions']);
  expect([...defaultFeatures({ ...plan, nodes: [...plan.nodes, summary] })]).toEqual(['decode', 'asr', 'faces']);
  // ...nor can it be turned on until captions is: sending is chosen by turning on the step that sends
  const withSummary = { ...plan, nodes: [...plan.nodes, summary] };
  expect(mustTurnOnFirst(withSummary, new Set(['decode']), 'summary')).toEqual(['captions']);
  expect(mustTurnOnFirst(withSummary, new Set(['decode', 'captions']), 'summary')).toEqual([]);
  expect(mustTurnOnFirst(withSummary, new Set(), 'captions')).toEqual([]);   // the step that sends is turned on itself
});

test('a setting\'s choices show their price when the cost depends on them, and settings go only for steps that run', () => {
  const s: Setting = { key: 'model', description: '', value: 'claude-haiku-5-5', choices: ['claude-haiku-5-5', 'claude-opus-5-5'],
    prices: { 'claude-haiku-5-5': 0.003, 'claude-opus-5-5': 0.12 }, per: 'shot' };
  expect(choiceLabel(s, 'claude-haiku-5-5')).toBe('claude-haiku-5-5, $0.003 per shot');
  expect(choiceLabel(s, 'claude-opus-5-5')).toBe('claude-opus-5-5, $0.12 per shot');
  expect(choiceLabel({ ...s, prices: null, per: null }, 'low')).toBe('low');
  expect(settingsFor({ captions: { model: 'claude-opus-5-5' }, faces: {} }, ['decode', 'faces'])).toEqual({ faces: {} });
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
