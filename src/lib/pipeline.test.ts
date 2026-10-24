import { expect, test } from 'vitest';
import { foldRun, runnable, type Plan, type PlanNode, type PipelineMessage } from './pipeline';

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

test('a plan can run when every node has a place and its secrets, downloads allowed or not needed', () => {
  const node: PlanNode = { id: 'a', uses: 'x@1', where: 'native (mps)', why_not: '', cached: false, downloads: [], missing_secrets: [], cost_usd: 0, cost_note: '' };
  const plan = (n: Partial<PlanNode>): Plan => ({ ok: false, estimated_usd: 0, nodes: [{ ...node, ...n }] });
  expect(runnable(plan({}), false)).toBe(true);
  expect(runnable(plan({ where: null, why_not: 'needs cuda' }), true)).toBe(false);
  expect(runnable(plan({ missing_secrets: ['ANTHROPIC_API_KEY'] }), true)).toBe(false);
  const needs = plan({ downloads: [{ id: 'w', source: 'hf://x', size_gb: 1, gated: false, licence_mode: 'academic-only' }] });
  expect(runnable(needs, false)).toBe(false);
  expect(runnable(needs, true)).toBe(true);
});
