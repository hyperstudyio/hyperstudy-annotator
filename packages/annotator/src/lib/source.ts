// Where an open bundle's data comes from, and where its corrections are kept. The viewer only sees these interfaces;
// each app supplies its own: the desktop app's tauriSource (its SQLite library), webSource's httpSource (a bundle
// served over HTTP, corrections in localStorage), and HyperStudy's own.

import type { Unmatched } from './model/carryover';
import type { AnnotationType, Op } from './model/corrections';
import type { Manifest } from './types';

/** The op log of one bundle. Every method returns what the store holds afterwards, so the caller can tell when
 *  another writer (another browser tab) changed the log in between. */
export interface CorrectionStore {
  load(): Promise<Op[]>;
  /** Append ops; resolves to the number of ops the log holds now. Undo is an append too (a `revert` op): a log never
   *  shrinks, except by `replace`. */
  append(ops: Op[]): Promise<number>;
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
  /** The annotation types the library's other videos define, to copy from one. */
  typesElsewhere(): Promise<TypesElsewhere>;
}

/** By the log they come from (a bundle id, or a browser's storage key): runs of different videos can share a title. */
export type TypesElsewhere = { key: string; title: string; types: AnnotationType[] }[];
