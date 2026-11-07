import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { OPENABLE } from '@hyperstudyio/annotator';

test('the hosts the page opens are exactly the ones the desktop app allows it to open', () => {
  const caps = JSON.parse(readFileSync(new URL('../../src-tauri/capabilities/default.json', import.meta.url), 'utf8'));
  const opener = caps.permissions.find((p: { identifier?: string }) => p.identifier === 'opener:allow-open-url');
  const allowed = opener.allow.map((a: { url: string }) => new URL(a.url.replace(/\*$/, '')).hostname);
  expect(allowed.sort()).toEqual([...OPENABLE].sort());
  expect(opener.allow.every((a: { url: string }) => /^https:\/\/[^/*]+\/\*$/.test(a.url))).toBe(true);   // whole hosts, https only
});
