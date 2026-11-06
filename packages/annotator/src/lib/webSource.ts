// A bundle directory served over HTTP (browser development and testing; see README), its corrections in this
// browser's localStorage, keyed by the video's sha256. Uses nothing but fetch and Web Storage.

import { live, typesIn, type Op } from './model/corrections';
import type { BundleSource, CarryRecord, CorrectionStore, Lineage, TypesElsewhere } from './source';
import type { Manifest } from './types';

/** Corrections kept in this browser's localStorage under the video's sha256. Each call reads what is stored, never a
 *  copy loaded earlier, so two tabs of the same bundle do not overwrite each other's work. */
export class LocalCorrectionStore implements CorrectionStore {
  readonly key: string;
  /** `version` keeps a re-run's log apart from the log of the video's first bundle (browser mode's `previous=`). */
  constructor(sha256: string, private storage: Storage = localStorage, version?: string) {
    this.key = `hyperstudy-annotator:corrections:${sha256}${version ? `:${version}` : ''}`;
  }
  #read(): Op[] {
    const text = this.storage.getItem(this.key);
    return text ? (JSON.parse(text) as Op[]) : [];
  }
  #write(ops: Op[]) { this.storage.setItem(this.key, JSON.stringify(ops)); return ops.length; }
  async load() { return this.#read(); }
  async append(ops: Op[]) { return this.#write([...this.#read(), ...ops]); }
  async replace(ops: Op[]) { return this.#write(ops); }
  subscribe(onchange: () => void) {
    const listener = (e: StorageEvent) => { if (e.key === this.key) onchange(); };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }
}

/** Browser mode's other videos: the logs this browser keeps for other videos (a video's logs are keyed by its sha256,
 *  then a run's URL), named by the title kept when each was opened. */
export function localTypesElsewhere(videoSha256: string, storage: Storage = localStorage): TypesElsewhere {
  const prefix = 'hyperstudy-annotator:corrections:', logs: { key: string; title: string; ops: Op[] }[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix) || key.startsWith(prefix + videoSha256)) continue;
    logs.push({ key, title: storage.getItem(key.replace(':corrections:', ':title:')) ?? key.slice(prefix.length, prefix.length + 12), ops: JSON.parse(storage.getItem(key) ?? '[]') });
  }
  return typesIn(logs);
}

/** Browser mode's lineage: `previous` is the URL of the earlier bundle, whose log is the video's usual one; this
 *  version's log and its carry-over record are kept under this bundle's URL. */
function localLineage(base: string, previousUrl: string, videoUrl: string | null, store: CorrectionStore, storage: Storage = localStorage): Lineage {
  const key = `hyperstudy-annotator:carryover:${base}`;
  const read = (): CarryRecord | null => { const t = storage.getItem(key); return t ? (JSON.parse(t) as CarryRecord) : null; };
  const write = (r: CarryRecord) => { storage.setItem(key, JSON.stringify(r)); return r; };
  return {
    async record() { return read(); },
    async previous() {
      const prev = await httpSource(previousUrl, videoUrl);
      const n = live(await prev.corrections.load()).length;
      return n && read()?.status !== 'declined' && !live(await store.load()).length ? { id: previousUrl, label: `The bundle at ${previousUrl}`, corrections: n, open: async () => prev } : null;
    },
    async carry(from, ops, unmatched) {
      if (read()?.status === 'declined') throw new Error('this version was started without the earlier corrections (declined)');
      if (live(await store.load()).length) throw new Error('this version already has corrections of its own');
      const n = await store.append(ops);
      write({ from_bundle_id: from, status: 'carried', carried: ops.length, unmatched, created_at: new Date().toISOString() });
      return n;
    },
    async decline(from) { write({ from_bundle_id: from, status: 'declined', carried: 0, unmatched: [], created_at: new Date().toISOString() }); },
    async dismiss(index) { const r = read()!; return write({ ...r, unmatched: r.unmatched.filter((u) => u.index !== index) }); },
    async others() { return 1; },
    async find(sha) {
      const prev = await httpSource(previousUrl, videoUrl);
      return prev.bundleSha256 === sha ? { id: previousUrl, label: `The bundle at ${previousUrl}`, corrections: 0, open: async () => prev } : null;
    },
  };
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A path a bundle names (a layer, a side file, an asset such as a crop), checked as the desktop app's
 *  `bundle::safe_path` checks it: plain relative segments only. In a URL that also rules out what a browser would
 *  read as leaving the bundle: backslashes, percent-escaped dots, slashes or backslashes, and a query or fragment.
 *  A bundle can come from anyone (a study member's upload), and a path out of it would be fetched with the viewer's
 *  cookies. Returns the path; throws for any other. */
export function bundlePath(path: string): string {
  const plain = path !== '' && !/[\\?#]|%(2e|2f|5c)/i.test(path)
    && path.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
  if (!plain || /^[a-z][a-z0-9+.-]*:/i.test(path)) throw new Error(`not a path inside the bundle: ${JSON.stringify(path)}`);
  return path;
}

/** Every path the manifest names, checked before anything is fetched from it. */
function checkManifestPaths(manifest: Manifest) {
  for (const entry of Object.values(manifest.layers ?? {})) {
    bundlePath(entry.file);
    for (const side of entry.side_files ?? []) bundlePath(side.file);
  }
}

export async function httpSource(bundleUrl: string, videoUrl: string | null, previousUrl: string | null = null): Promise<BundleSource> {
  const base = bundleUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/manifest.json`);
  if (!res.ok) throw new Error(`no manifest at ${base} (${res.status})`);
  const manifestText = await res.text();
  const manifest = JSON.parse(manifestText) as Manifest;
  checkManifestPaths(manifest);
  const store = new LocalCorrectionStore(manifest.video.sha256, localStorage, previousUrl ? base : undefined);
  const getJson = async <T>(path: string) => {
    const r = await fetch(`${base}/${bundlePath(path)}`);
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return (await r.json()) as T;
  };
  const title = manifest.video.filename?.replace(/\.[^.]+$/, '') ?? base.split('/').pop() ?? 'bundle';
  try { localStorage.setItem(store.key.replace(':corrections:', ':title:'), title); } catch { /* the title only names it to others */ }
  return {
    title,
    manifest,
    bundleSha256: await sha256Hex(manifestText),
    videoUrl,
    corrections: store,
    lineage: previousUrl ? localLineage(base, previousUrl, videoUrl, store) : undefined,
    async typesElsewhere() { return localTypesElsewhere(manifest.video.sha256); },
    async layer<T>(name: string) {
      const entry = manifest.layers[name];
      return entry ? getJson<T>(entry.file) : null;
    },
    file: getJson,
    assetUrl: (path) => `${base}/${bundlePath(path)}`,
    async findPrototypeCorrections() {
      // the bake-off layout: runs/<clip>/bundle next to runs/<clip>/perception_corrections.json
      const path = `${base.replace(/\/[^/]+$/, '')}/perception_corrections.json`;
      const r = await fetch(path);
      return r.ok ? { path, text: await r.text() } : null;
    },
    pickCorrectionsFile: () => new Promise((resolve) => {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json' });
      input.onchange = async () => resolve(input.files?.[0] ? await input.files[0].text() : null);
      input.oncancel = () => resolve(null);
      input.click();
    }),
    async saveCorrectionsFile(name, text) {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
      document.body.append(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
      return true;
    },
  };
}
