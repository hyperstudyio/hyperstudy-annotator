// Where an open bundle's data comes from, and where its corrections are kept. The viewer only sees these interfaces.
//   tauriSource: an imported bundle, through the app's commands; corrections in the app's SQLite database.
//   httpSource:  a bundle directory served over HTTP (browser development and testing; see README); corrections in
//                this browser's localStorage, keyed by the video's sha256.

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
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

/** A corrections file found next to the bundle (the prototype's `perception_corrections.json`). */
export interface FoundFile { path: string; text: string }

export interface BundleSource {
  title: string;
  manifest: Manifest;
  videoUrl: string | null;
  corrections: CorrectionStore;
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
};

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
    videoUrl: summary.video_path ? convertFileSrc(summary.video_path) : null,
    corrections: {
      load: () => api.loadCorrections(id),
      append: (ops) => api.appendCorrections(id, ops),
      truncate: (keep) => api.truncateCorrections(id, keep),
      replace: (ops) => api.replaceCorrections(id, ops),
    },
    async layer<T>(name: string) {
      return name in manifest.layers ? (JSON.parse(await api.readLayer(id, name)) as T) : null;
    },
    async file<T>(path: string) { return JSON.parse(await api.readFile(id, path)) as T; },
    assetUrl: (path) => convertFileSrc(`${bundle_dir}/${path}`),
    findPrototypeCorrections: () => api.findPrototypeCorrections(id),
    async pickCorrectionsFile() {
      const path = await open({ title: 'Import a corrections file', filters: [{ name: 'Corrections', extensions: ['json'] }] });
      return typeof path === 'string' ? api.readCorrectionsFile(path) : null;
    },
    async saveCorrectionsFile(name, text) {
      const path = await save({ title: 'Export corrections', defaultPath: name, filters: [{ name: 'Corrections', extensions: ['json'] }] });
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
  constructor(sha256: string, private storage: Storage = localStorage) { this.key = `hyperstudy-annotator:corrections:${sha256}`; }
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

export async function httpSource(bundleUrl: string, videoUrl: string | null): Promise<BundleSource> {
  const base = bundleUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/manifest.json`);
  if (!res.ok) throw new Error(`no manifest at ${base} (${res.status})`);
  const manifest = (await res.json()) as Manifest;
  const getJson = async <T>(path: string) => {
    const r = await fetch(`${base}/${path}`);
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return (await r.json()) as T;
  };
  return {
    title: manifest.video.filename?.replace(/\.[^.]+$/, '') ?? base.split('/').pop() ?? 'bundle',
    manifest,
    videoUrl,
    corrections: new LocalCorrectionStore(manifest.video.sha256),
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
