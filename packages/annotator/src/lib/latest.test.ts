import { expect, test } from 'vitest';
import { latestOnly } from './latest';

test('only the newest call settles: an older one finishing later is dropped, results and errors alike', async () => {
  const later = <T>() => { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const p = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
  const run = latestOnly();
  const seen: string[] = [];
  const first = later<string>(), second = later<string>(), third = later<string>();
  run(first.p, (v) => seen.push(v), (e) => seen.push(`error ${e}`));
  run(second.p, (v) => seen.push(v), (e) => seen.push(`error ${e}`));
  second.resolve('second');
  first.resolve('first (stale)');
  await Promise.resolve(); await Promise.resolve();
  run(third.p, (v) => seen.push(v), (e) => seen.push(`error ${e}`));
  second.reject?.('ignored');
  third.reject('third failed');
  await new Promise((r) => setTimeout(r, 0));
  expect(seen).toEqual(['second', 'error third failed']);
});
