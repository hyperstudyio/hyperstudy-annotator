import { expect, test } from 'vitest';
import { openable } from './links';

test('a page opens only on those hosts, over https', () => {
  expect(openable('https://huggingface.co/settings/tokens')).toBe(true);
  expect(openable('https://evil.example/huggingface.co')).toBe(false);
  expect(openable('http://huggingface.co/x')).toBe(false);
  expect(openable('not a url')).toBe(false);
});
