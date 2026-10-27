import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { OPENABLE, openable } from './links';

test('the hosts the page opens are exactly the ones the desktop app allows it to open', () => {
  const caps = JSON.parse(readFileSync(new URL('../../src-tauri/capabilities/default.json', import.meta.url), 'utf8'));
  const opener = caps.permissions.find((p: { identifier?: string }) => p.identifier === 'opener:allow-open-url');
  const allowed = opener.allow.map((a: { url: string }) => new URL(a.url.replace(/\*$/, '')).hostname);
  expect(allowed.sort()).toEqual([...OPENABLE].sort());
  expect(opener.allow.every((a: { url: string }) => /^https:\/\/[^/*]+\/\*$/.test(a.url))).toBe(true);   // whole hosts, https only
});

test('a page opens only on those hosts, over https', () => {
  expect(openable('https://huggingface.co/settings/tokens')).toBe(true);
  expect(openable('https://evil.example/huggingface.co')).toBe(false);
  expect(openable('http://huggingface.co/x')).toBe(false);
  expect(openable('not a url')).toBe(false);
});
