// Pages outside the app. In the desktop app they open in the user's browser (the opener plugin, allowed for these hosts
// only in capabilities/default.json: a test keeps the two lists the same); in a browser, in a new tab.
import { inTauri } from './source';

export const DOCS_URL = 'https://docs.hyperstudy.io/annotator';

/** The hosts a page can be opened on: the documentation, where the keys are made, and the models' pages. A link to any
 *  other host (a bundle's model source can name anything) is not offered. */
export const OPENABLE = ['docs.hyperstudy.io', 'console.anthropic.com', 'console.runpod.io', 'huggingface.co', 'github.com', 'docs.anthropic.com', 'zenodo.org'];

/** Whether `url` is an https page on a host the app may open. */
export function openable(url: string): boolean {
  try { const u = new URL(url); return u.protocol === 'https:' && OPENABLE.includes(u.hostname); } catch { return false; }
}

export async function openExternal(url: string) {
  if (!openable(url)) throw new Error(`not a page the app opens: ${url}`);
  if (inTauri()) { const { openUrl } = await import('@tauri-apps/plugin-opener'); await openUrl(url); }
  else window.open(url, '_blank', 'noopener');
}
