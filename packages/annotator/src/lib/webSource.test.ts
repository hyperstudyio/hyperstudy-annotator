import { afterEach, expect, test, vi } from 'vitest';
import { bundlePath, httpSource } from './webSource';
import { MemoryStorage } from './model/fixture.test-helpers';

afterEach(() => { vi.unstubAllGlobals(); });

test('a path a bundle names is used only as plain segments inside the bundle, as the desktop app\'s safe_path allows', () => {
  for (const ok of ['layers/faces.json', 'assets/crops/person_3.jpg', 'a-b_c.d/e']) expect(bundlePath(ok)).toBe(ok);
  for (const bad of ['', '/etc/passwd', '../x', 'layers/../../api/x', './x', 'a//b', 'a/', 'a\\..\\b', '%2e%2e/x', 'a%2Fb',
    'a%5cb', 'x?y', 'x#y', 'https://evil.example/x',
    // what the URL parser removes (tab, newline, CR anywhere) or trims (whitespace at the ends) would turn into `..`
    '.\t./x', '.\n./x', 'a/.\r.', 'a/.. ', ' ../x', '.. /x', 'a\u0000b', 'a\u007fb']) {
    expect(() => bundlePath(bad), bad).toThrow(/not a path inside the bundle/);
  }
});

test('a bundle whose manifest names a layer outside it is refused when opened, before anything is fetched from there', async () => {
  const manifest = {
    video: { sha256: 'e'.repeat(64), filename: 'x.mp4' },
    layers: { faces: { file: '../../api/studies/other/export.json', sha256: '0', bytes: 1, licence_mode: 'commercial-ok', stage: 't' } },
  };
  const fetched: string[] = [];
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('fetch', async (url: string) => { fetched.push(url); return new Response(JSON.stringify(manifest)); });
  await expect(httpSource('/bundles/clip1', null)).rejects.toThrow(/not a path inside the bundle/);
  expect(fetched).toEqual(['/bundles/clip1/manifest.json']);
});

test('a side file or asset outside the bundle is refused, and one inside is read from the bundle', async () => {
  const manifest = { video: { sha256: 'e'.repeat(64), filename: 'x.mp4' }, layers: {} };
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(manifest)));
  const source = await httpSource('/bundles/clip1', null);
  await expect(source.file('../other/layers/faces.json')).rejects.toThrow(/not a path inside the bundle/);
  expect(() => source.assetUrl('../../other-bundle/assets/crops/p.jpg')).toThrow(/not a path inside the bundle/);
  expect(source.assetUrl('assets/crops/p.jpg')).toBe('/bundles/clip1/assets/crops/p.jpg');
});
