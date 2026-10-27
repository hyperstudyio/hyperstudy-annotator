// The library the Annotator page lists: the bundles imported into the app. The page is given one of these: the app's
// (Tauri commands and its file dialogs), or in a browser's ?library-demo a scripted stand-in (library.fake.ts), so the
// page can be tried and tested without the app.
import { api, tauriSource, type BundleSource } from './source';
import type { BundleSummary, LicenceMode } from './types';

export interface LibraryApi {
  list(): Promise<BundleSummary[]>;
  /** Ask for a bundle folder, then check it against its manifest and copy it in (null: the user canceled). */
  importBundle(): Promise<BundleSummary | null>;
  /** Ask for the bundle's video, then check its checksum against the bundle's (null: the user canceled). */
  locateVideo(b: BundleSummary): Promise<BundleSummary | null>;
  /** The bundle, to show in the viewer. */
  open(b: BundleSummary): Promise<BundleSource>;
}

export function tauriLibrary(): LibraryApi {
  const dialog = () => import('@tauri-apps/plugin-dialog');
  return {
    list: () => api.list(),
    async importBundle() {
      const dir = await (await dialog()).open({ directory: true, title: 'Choose a bundle folder (it holds manifest.json)' });
      return typeof dir === 'string' ? api.import(dir) : null;
    },
    async locateVideo(b) {
      const file = await (await dialog()).open({ title: `Locate the video for ${b.title}`, filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv'] }] });
      return typeof file === 'string' ? api.locateVideo(b.id, file) : null;
    },
    open: (b) => tauriSource(b.id),
  };
}

/** The strictest licence among a bundle's layers: what anyone using the whole bundle must keep to. */
const ORDER: LicenceMode[] = ['commercial-ok', 'api-terms', 'needs-review', 'academic-only'];
export const strictest = (b: BundleSummary): LicenceMode =>
  Object.values(b.layers).reduce((a, m) => (ORDER.indexOf(m) > ORDER.indexOf(a) ? m : a), 'commercial-ok' as LicenceMode);

/** A licence as people say it. */
export const LICENCE_TEXT: Record<LicenceMode, string> = {
  'commercial-ok': 'Commercial use allowed', 'api-terms': "Under the API provider's terms",
  'needs-review': 'Licence under review', 'academic-only': 'Academic use only',
};

/** The bundle last opened on this computer: the Annotator opens it again when it is shown (a convenience; storage may be
 *  unavailable, and then the newest bundle opens). */
const LAST = 'annotator.lastBundle';
export const lastOpened = (): string | null => { try { return localStorage.getItem(LAST); } catch { return null; } };
export const rememberOpened = (id: string) => { try { localStorage.setItem(LAST, id); } catch { /* not kept */ } };
