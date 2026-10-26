// Pages outside the app. In the desktop app they open in the user's browser (the opener plugin, allowed for these
// URLs only in capabilities/default.json); in a browser, in a new tab.
import { inTauri } from './source';

export const DOCS_URL = 'https://docs.hyperstudy.io/annotator';

export async function openExternal(url: string) {
  if (inTauri()) { const { openUrl } = await import('@tauri-apps/plugin-opener'); await openUrl(url); }
  else window.open(url, '_blank', 'noopener');
}
