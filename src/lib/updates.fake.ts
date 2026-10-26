// A scripted stand-in for the updater, for browser mode (?update-demo): Tauri is absent there. `available` offers
// 0.0.2 and downloads it in five steps; `current` has nothing newer; `offline` cannot reach the releases; `bad-download`
// offers 0.0.2 and fails its signature check. A relaunch is recorded on window.__relaunched, for the browser tests.
import type { UpdaterApi } from './updates.svelte';

export type UpdateDemo = 'available' | 'current' | 'offline' | 'bad-download';

export function fakeUpdater(mode: UpdateDemo, ms = 150): UpdaterApi {
  const wait = () => new Promise((r) => setTimeout(r, ms));
  return {
    version: async () => '0.0.1',
    async check() {
      await wait();
      if (mode === 'offline') throw new Error('Could not fetch a valid release JSON from the remote');
      if (mode === 'current') return null;
      return {
        version: '0.0.2',
        notes: 'Settings has a section for updates.\nThe rail shows when one is ready.',
        async install(on) {
          const total = 5_000_000;
          for (let done = 1_000_000; done <= total; done += 1_000_000) { await wait(); on(done, total); }
          if (mode === 'bad-download') throw new Error('the signature of the update does not match the public key');
        },
      };
    },
    relaunch: async () => { (window as unknown as { __relaunched: boolean }).__relaunched = true; },
  };
}
