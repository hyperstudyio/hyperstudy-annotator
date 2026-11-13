// The desktop app's source: an imported bundle, through the app's commands; corrections in the app's SQLite database.

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { bundlePath, typesIn } from '@hyperstudyio/annotator';
import type { Unmatched, Op, BundleSource, CarryRecord, FoundFile, BundleSummary, Manifest } from '@hyperstudyio/annotator';

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
      replace: (ops) => api.replaceCorrections(id, ops),
    },
    async typesElsewhere() {
      // other videos: this video's other runs are its versions, whose types carry over with their ids
      const others = (await api.list()).filter((b) => b.video_sha256 !== summary.video_sha256 && b.corrections > 0);
      return typesIn(await Promise.all(others.map(async (b) => ({ key: b.id, title: b.title, ops: await api.loadCorrections(b.id) }))));
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
    // a path the bundle names (a crop), checked as the browser's source and the app's own commands check theirs:
    // a bundle can come from anyone, and the asset protocol would serve whatever its scope allows
    assetUrl: (path) => convertFileSrc(`${bundle_dir}/${bundlePath(path)}`),
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
