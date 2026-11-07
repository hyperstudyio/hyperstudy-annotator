// @hyperstudyio/annotator: the HyperStudy Annotator's editor, for the desktop app and for HyperStudy.
// An app gives the editor a BundleSource (where the bundle's files come from and where its edits are kept) and,
// optionally, how a page outside it opens; everything else is the editor's. The look is annotator.css
// (`@hyperstudyio/annotator/annotator.css`, imported by the workspace), scoped to `.hs-annotator`.

// The editor
export { default as Viewer } from './components/Viewer.svelte';
export { default as Workspace } from './components/Workspace.svelte';
export { default as Popover } from './components/ui/Popover.svelte';

// Where a bundle comes from, and where its edits are kept
export type { BundleSource, CarryRecord, CorrectionStore, EarlierVersion, FoundFile, Lineage, TypesElsewhere } from './source';
export { LocalCorrectionStore, bundlePath, httpSource, localTypesElsewhere } from './webSource';

// The model: a bundle, an open session on it, its edit log and the annotated result
export { Bundle } from './model/bundle';
export type { Layers } from './model/bundle';
export { Session } from './model/session.svelte';
export {
  FORMAT, fold, live, typesIn, upgrade, readCorrectionsFile, editsFile, ImportError, RunUnknownError,
} from './model/corrections';
export type { AnnotationType, CorrectionsFile, Op } from './model/corrections';
export { ANNOTATED_FORMAT, annotated, serialiseAnnotated } from './model/annotated';
export type { Annotated } from './model/annotated';
export type { Unmatched } from './model/carryover';

// Licences, links out, and the models behind a layer
export { LICENCE_TEXT, strictest } from './licences';
export { OPENABLE, browserOpen, openable } from './links';
export type { OpenExternal } from './links';
export { downloadSize, modelNote } from './models';
export { latestOnly } from './latest';

// The bundle's file format, as the editor reads it
export type * from './types';
