// Pages outside the annotator. A link to any host other than these (a bundle's model source can name anything) is
// not offered. How a page is opened is the host app's: the desktop app opens it in the user's browser; a web page, in
// a new tab (`browserOpen`, the default).

/** The hosts a page can be opened on: the documentation, where the keys are made, and the models' pages. */
export const OPENABLE = ['docs.hyperstudy.io', 'console.anthropic.com', 'console.runpod.io', 'huggingface.co', 'github.com', 'docs.anthropic.com', 'zenodo.org'];

/** Whether `url` is an https page on a host the annotator may open. */
export function openable(url: string): boolean {
  try { const u = new URL(url); return u.protocol === 'https:' && OPENABLE.includes(u.hostname); } catch { return false; }
}

/** Opens a page outside the annotator; given to `Viewer`/`Workspace` by the app that embeds them. */
export type OpenExternal = (url: string) => void | Promise<void>;

/** A new browser tab, for a page on an openable host. */
export const browserOpen: OpenExternal = (url) => {
  if (!openable(url)) throw new Error(`not a page the annotator opens: ${url}`);
  window.open(url, '_blank', 'noopener');
};
