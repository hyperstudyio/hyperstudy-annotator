// Pages outside the app. In the desktop app they open in the user's browser (the opener plugin, allowed for the
// annotator's openable hosts only in capabilities/default.json: a test keeps the two lists the same); in a browser
// (development and testing), in a new tab.
import { browserOpen, openable } from '@hyperstudyio/annotator';
import type { OpenExternal } from '@hyperstudyio/annotator';
import { inTauri } from './tauriSource';

export const DOCS_URL = 'https://docs.hyperstudy.io/annotator';

export const openExternal: OpenExternal = async (url) => {
  if (!openable(url)) throw new Error(`not a page the app opens: ${url}`);
  if (inTauri()) { const { openUrl } = await import('@tauri-apps/plugin-opener'); await openUrl(url); }
  else browserOpen(url);
};
