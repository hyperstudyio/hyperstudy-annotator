// A scripted library for the browser (?library-demo): a few bundles, one whose video has not been found yet. Importing
// adds one; locating a video finds it. ?library-demo=empty starts with none.
import type { LibraryApi } from './library';
import type { BundleSummary } from './types';

const bundle = (id: string, title: string, layers: BundleSummary['layers'], video_path: string | null, corrections = 0): BundleSummary => ({
  id, title, video_sha256: 'f'.repeat(64), schema_version: '0.1.0', created_at: '2026-10-20T14:02:00Z', imported_at: '2026-10-21T09:15:00Z',
  layers, video_path, corrections, manifest_sha256: 'e'.repeat(64),
});

export function fakeLibrary(empty: boolean, delayMs = 300): LibraryApi {
  const wait = () => new Promise((r) => setTimeout(r, delayMs));
  let bundles: BundleSummary[] = empty ? [] : [
    bundle('b1', 'ooo-genz-clip1', { shots: 'commercial-ok', transcript: 'commercial-ok', faces: 'academic-only', captions: 'api-terms' }, '/Users/me/Videos/ooo-genz-clip1.mp4', 88),
    bundle('b2', 'ooo-genz-clip2', { shots: 'commercial-ok', transcript: 'commercial-ok' }, null),
    bundle('b3', 'nes-biking', { shots: 'commercial-ok', transcript: 'commercial-ok', faces: 'needs-review' }, '/Users/me/Videos/nes-biking.mov', 0),
  ];
  return {
    list: async () => bundles,
    async importBundle() {
      await wait();
      const b = bundle(`b${bundles.length + 1}`, 'imported-clip', { shots: 'commercial-ok' }, null);
      bundles = [b, ...bundles];
      return b;
    },
    async locateVideo(b) {
      await wait();
      const found = { ...b, video_path: `/Users/me/Videos/${b.title}.mp4` };
      bundles = bundles.map((x) => (x.id === b.id ? found : x));
      return found;
    },
  };
}
