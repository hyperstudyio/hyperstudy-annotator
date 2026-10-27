// A scripted library for the browser (?library-demo): the bake-off bundles vite serves at /devdata (see the README),
// one whose video has not been found yet. Importing adds one; locating a video finds it. ?library-demo=empty starts
// with none. Without /devdata (CI) the bundles list, and opening one says it could not be loaded.
import type { LibraryApi } from './library';
import { httpSource } from './source';
import type { BundleSummary } from './types';

const bundle = (id: string, title: string, layers: BundleSummary['layers'], video_path: string | null, corrections = 0): BundleSummary => ({
  id, title, video_sha256: 'f'.repeat(64), schema_version: '0.1.0', created_at: '2026-10-20T14:02:00Z', imported_at: '2026-10-21T09:15:00Z',
  layers, video_path, corrections, manifest_sha256: 'e'.repeat(64),
});
// where each demo bundle and its video are served
const SERVED: Record<string, { bundle: string; video: string }> = {
  b1: { bundle: '/devdata/runs/ooo-genz-clip1/bundle', video: '/devdata/data/ooo-genz-clip1.mp4' },
  b2: { bundle: '/devdata/runs/ooo-genz-clip2/bundle-l4', video: '/devdata/data/ooo-genz-clip2.mp4' },
  b3: { bundle: '/devdata/runs/nes-biking/bundle', video: '/devdata/data/nes-biking.mp4' },
};

export function fakeLibrary(empty: boolean, delayMs = 300): LibraryApi {
  const wait = () => new Promise((r) => setTimeout(r, delayMs));
  let bundles: BundleSummary[] = empty ? [] : [
    bundle('b1', 'ooo-genz-clip1', { shots: 'api-terms', transcript: 'needs-review', faces: 'academic-only' }, '/Users/me/Videos/ooo-genz-clip1.mp4', 88),
    bundle('b2', 'ooo-genz-clip2', { shots: 'commercial-ok', transcript: 'commercial-ok' }, null),
    bundle('b3', 'nes-biking', { shots: 'commercial-ok', transcript: 'commercial-ok', faces: 'needs-review' }, '/Users/me/Videos/nes-biking.mp4', 0),
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
    async open(b) {
      const now = bundles.find((x) => x.id === b.id) ?? b;
      const at = SERVED[b.id];
      if (!at) throw new Error(`${b.title} is only in this demo's list: it has no layers to show`);
      return httpSource(at.bundle, now.video_path ? at.video : null);
    },
  };
}
