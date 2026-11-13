import { expect, test, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === 'open_bundle') {
      return { summary: { title: 'clip', manifest_sha256: 'm', video_path: null, video_sha256: 'v' },
        manifest: { layers: {} }, bundle_dir: '/library/bundles/abc' };
    }
    throw new Error(`unexpected ${cmd}`);
  }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

import { tauriSource } from './tauriSource';

test('an asset is read from inside the bundle only, as in a browser: a path out of it is refused', async () => {
  const source = await tauriSource('abc');
  expect(source.assetUrl('assets/crops/person_3.jpg')).toBe(`asset://localhost/${encodeURIComponent('/library/bundles/abc/assets/crops/person_3.jpg')}`);
  for (const bad of ['../other/assets/crops/p.jpg', 'assets/../../other/x.jpg', '/etc/passwd', 'assets\\..\\..\\x']) {
    expect(() => source.assetUrl(bad), bad).toThrow(/not a path inside the bundle/);
  }
});
