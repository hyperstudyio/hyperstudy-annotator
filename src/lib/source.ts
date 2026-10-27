// Where an open bundle's data comes from, and where its corrections are kept. The viewer only sees these interfaces.
//   tauriSource: an imported bundle, through the app's commands; corrections in the app's SQLite database.
//   httpSource:  a bundle directory served over HTTP (browser development and testing; see README); corrections in
//                this browser's localStorage, keyed by the video's sha256.

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { Unmatched } from './model/carryover';
import type { Op } from './model/corrections';
import type { BundleSummary, Manifest } from './types';

/** The op log of one bundle. Every method returns what the store holds afterwards, so the caller can tell when
 *  another writer (another browser tab) changed the log in between. */
export interface CorrectionStore {
  load(): Promise<Op[]>;
  /** Append ops; resolves to the number of ops the log holds now. */
  append(ops: Op[]): Promise<number>;
  /** Keep the oldest `keep` ops (undo). */
  truncate(keep: number): Promise<number>;
  /** Replace the whole log (importing a file). */
  replace(ops: Op[]): Promise<number>;
  /** Called when another writer changed the log (another tab of this page); returns an unsubscribe function. */
  subscribe?(onchange: () => void): () => void;
}

/** What happened to an earlier version's corrections when this version was opened. */
export interface CarryRecord { from_bundle_id: string; status: 'carried' | 'declined'; carried: number; unmatched: Unmatched[]; created_at: string }

/** An earlier version of the same video (a re-run's predecessor) whose corrections can start this one's log. */
export interface EarlierVersion { id: string; label: string; corrections: number; open(): Promise<BundleSource> }

/** Versions of one video. The earlier version's log is only read; carried ops go into this version's log. */
export interface Lineage {
  record(): Promise<CarryRecord | null>;
  /** The newest earlier version with corrections (asked when this one has none of its own and was not started fresh). */
  previous(): Promise<EarlierVersion | null>;
  carry(from: string, ops: Op[], unmatched: Unmatched[]): Promise<number>;
  decline(from: string): Promise<void>;
  /** Take one op (by its index in the earlier log) off the review list. */
  dismiss(index: number): Promise<CarryRecord>;
  /** How many other runs of this video the library holds. */
  others(): Promise<number>;
  /** Another run of this video, by its manifest sha256 (where an imported corrections file was made). */
  find(bundleSha256: string): Promise<EarlierVersion | null>;
}

/** A corrections file found next to the bundle (the prototype's `perception_corrections.json`). */
export interface FoundFile { path: string; text: string }

export interface BundleSource {
  title: string;
  manifest: Manifest;
  /** The bundle's identity: its manifest's sha256. */
  bundleSha256: string;
  videoUrl: string | null;
  corrections: CorrectionStore;
  /** Earlier versions of this video, when the source knows about them. */
  lineage?: Lineage;
  /** A layer file, parsed; null when the manifest lists no such layer. */
  layer<T>(name: string): Promise<T | null>;
  /** A side file the manifest lists (e.g. layers/faces_detail.json), parsed. */
  file<T>(path: string): Promise<T>;
  /** A URL the webview can load for a bundle asset (a crop under assets/). */
  assetUrl(path: string): string;
  /** The prototype's corrections file for this bundle's run, if one sits next to it. */
  findPrototypeCorrections(): Promise<FoundFile | null>;
  /** Ask the user for a corrections file to import (null if they cancel). */
  pickCorrectionsFile(): Promise<string | null>;
  /** Save an exported corrections file (a save dialog in the app, a download in a browser). */
  saveCorrectionsFile(name: string, text: string): Promise<boolean>;
}

export const inTauri = () => '__TAURI_INTERNALS__' in window;

export const api = {
  list: () => invoke<BundleSummary[]>('list_bundles'),
  import: (path: string) => invoke<BundleSummary>('import_bundle', { path }),
  open: (id: string) => invoke<{ summary: BundleSummary; manifest: Manifest; bundle_dir: string }>('open_bundle', { id }),
  locateVideo: (id: string, path: string) => invoke<BundleSummary>('locate_video', { id, path }),
  readLayer: (id: string, name: string) => invoke<string>('read_layer', { id, name }),
  readFile: (id: string, path: string) => invoke<string>('read_bundle_file', { id, path }),
  loadCorrections: (id: string) => invoke<Op[]>('load_corrections', { id }),
  appendCorrections: (id: string, ops: Op[]) => invoke<number>('append_corrections', { id, ops }),
  truncateCorrections: (id: string, keep: number) => invoke<number>('truncate_corrections', { id, keep }),
  replaceCorrections: (id: string, ops: Op[]) => invoke<number>('replace_corrections', { id, ops }),
  findPrototypeCorrections: (id: string) => invoke<FoundFile | null>('find_prototype_corrections', { id }),
  readCorrectionsFile: (path: string) => invoke<string>('read_corrections_file', { path }),
  writeCorrectionsFile: (path: string, text: string) => invoke<void>('write_corrections_file', { path, text }),
  previousVersion: (id: string) => invoke<BundleSummary | null>('previous_version', { id }),
  getCarryover: (id: string) => invoke<CarryRecord | null>('get_carryover', { id }),
  carryOver: (id: string, from: string, ops: Op[], unmatched: Unmatched[]) => invoke<number>('carry_over', { id, from, ops, unmatched }),
  declineCarryover: (id: string, from: string) => invoke<void>('decline_carryover', { id, from }),
  dismissUnmatched: (id: string, index: number) => invoke<CarryRecord>('dismiss_unmatched', { id, index }),
  findVersion: (id: string, manifestSha256: string) => invoke<BundleSummary | null>('find_version', { id, manifestSha256 }),
  countVersions: (id: string) => invoke<number>('count_versions', { id }),
};

const versionLabel = (b: { created_at?: string | null; imported_at?: string }) =>
  `The version made ${new Date(b.created_at || b.imported_at || '').toLocaleString()}`;

// TODO: [ANNOTATOR-PORT] Step 9 - Check the native dialogs by hand: import a corrections file, export one (save
// dialog), and the offer to import the prototype's perception_corrections.json next to an imported bundle.
// Spec: the dialogs need a person at the keyboard; the code paths are the same as browser mode except for open/save.
// Plan: docs/PORT_PLAN.md#steps
export async function tauriSource(id: string): Promise<BundleSource> {
  const { summary, manifest, bundle_dir } = await api.open(id);
  const { open, save } = await import('@tauri-apps/plugin-dialog');
  return {
    title: summary.title,
    manifest,
    bundleSha256: summary.manifest_sha256,
    videoUrl: summary.video_path ? convertFileSrc(summary.video_path) : null,
    corrections: {
      load: () => api.loadCorrections(id),
      append: (ops) => api.appendCorrections(id, ops),
      truncate: (keep) => api.truncateCorrections(id, keep),
      replace: (ops) => api.replaceCorrections(id, ops),
    },
    lineage: {
      record: () => api.getCarryover(id),
      async previous() {
        const b = await api.previousVersion(id);
        return b && { id: b.id, label: versionLabel(b), corrections: b.corrections, open: () => tauriSource(b.id) };
      },
      carry: (from, ops, unmatched) => api.carryOver(id, from, ops, unmatched),
      decline: (from) => api.declineCarryover(id, from),
      dismiss: (index) => api.dismissUnmatched(id, index),
      others: () => api.countVersions(id),
      async find(sha) {
        const b = await api.findVersion(id, sha);
        return b && { id: b.id, label: versionLabel(b), corrections: b.corrections, open: () => tauriSource(b.id) };
      },
    },
    async layer<T>(name: string) {
      return name in manifest.layers ? (JSON.parse(await api.readLayer(id, name)) as T) : null;
    },
    async file<T>(path: string) { return JSON.parse(await api.readFile(id, path)) as T; },
    assetUrl: (path) => convertFileSrc(`${bundle_dir}/${path}`),
    findPrototypeCorrections: () => api.findPrototypeCorrections(id),
    async pickCorrectionsFile() {
      const path = await open({ title: 'Import edits from a file', filters: [{ name: 'Edits', extensions: ['json'] }] });
      return typeof path === 'string' ? api.readCorrectionsFile(path) : null;
    },
    async saveCorrectionsFile(name, text) {
      const path = await save({ title: 'Export', defaultPath: name, filters: [{ name: 'Annotations', extensions: ['json'] }] });
      if (!path) return false;
      await api.writeCorrectionsFile(path, text);
      return true;
    },
  };
}

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
  async truncate(keep: number) { return this.#write(this.#read().slice(0, keep)); }
  async replace(ops: Op[]) { return this.#write(ops); }
  subscribe(onchange: () => void) {
    const listener = (e: StorageEvent) => { if (e.key === this.key) onchange(); };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }
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
      const n = (await prev.corrections.load()).length;
      return n && read()?.status !== 'declined' && !(await store.load()).length ? { id: previousUrl, label: `The bundle at ${previousUrl}`, corrections: n, open: async () => prev } : null;
    },
    async carry(from, ops, unmatched) {
      if (read()?.status === 'declined') throw new Error('this version was started without the earlier corrections (declined)');
      if ((await store.load()).length) throw new Error('this version already has corrections of its own');
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

export async function httpSource(bundleUrl: string, videoUrl: string | null, previousUrl: string | null = null): Promise<BundleSource> {
  const base = bundleUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/manifest.json`);
  if (!res.ok) throw new Error(`no manifest at ${base} (${res.status})`);
  const manifestText = await res.text();
  const manifest = JSON.parse(manifestText) as Manifest;
  const store = new LocalCorrectionStore(manifest.video.sha256, localStorage, previousUrl ? base : undefined);
  const getJson = async <T>(path: string) => {
    const r = await fetch(`${base}/${path}`);
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return (await r.json()) as T;
  };
  return {
    title: manifest.video.filename?.replace(/\.[^.]+$/, '') ?? base.split('/').pop() ?? 'bundle',
    manifest,
    bundleSha256: await sha256Hex(manifestText),
    videoUrl,
    corrections: store,
    lineage: previousUrl ? localLineage(base, previousUrl, videoUrl, store) : undefined,
    async layer<T>(name: string) {
      const entry = manifest.layers[name];
      return entry ? getJson<T>(entry.file) : null;
    },
    file: getJson,
    assetUrl: (path) => `${base}/${path}`,
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
