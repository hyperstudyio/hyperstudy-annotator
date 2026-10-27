// The models behind what the timeline shows, said the same way whatever their bundle recorded: a short name, what the
// rest of its id says (the parenthesis: "mlx-community conversion"), a page to read about it when one can be worked out
// from its source or id, and its licence in words (the bundle's own text is the tooltip). Bundles record models
// unevenly (an id like "facebook/sam3 (Sam3VideoModel, bfloat16)", a source of hf://… or a URL, often neither): what
// cannot be worked out is left out, not guessed.
import type { Layers } from './model/bundle';
import type { LicenceMode, Model } from './types';
import { openable } from './links';

export interface ModelNote { name: string; detail: string | null; link: string | null; licence: LicenceMode; licenceText: string | null }

const ANTHROPIC = 'https://docs.anthropic.com/en/docs/about-claude/models/overview';

/** A page for the model: its source when that is a web address the app may open (links.ts), its Hugging Face page
 *  (hf://, or an id shaped owner/name), Anthropic's models page for Claude; else null. */
export function modelLink(m: Pick<Model, 'id' | 'source'>): string | null {
  const link = pageOf(m);
  return link && openable(link) ? link : null;
}

function pageOf(m: Pick<Model, 'id' | 'source'>): string | null {
  const src = m.source?.trim() ?? '';
  const web = src.match(/https?:\/\/\S+/)?.[0];
  if (web) return web;
  const hf = src.match(/hf:\/\/([\w.-]+(?:\/[\w.-]+)?)/)?.[1];
  if (hf) return `https://huggingface.co/${hf}`;
  const id = m.id.trim().split(/\s/)[0];
  if (/^claude-/.test(id)) return ANTHROPIC;
  if (/^[\w.-]+\/[\w.-]+$/.test(id)) return `https://huggingface.co/${id}`;
  return null;
}

/** "nvidia/parakeet-tdt-0.6b-v3 (mlx-community conversion)" → name "nvidia/parakeet-tdt-0.6b-v3", detail "mlx-community
 *  conversion"; a long id with no parenthesis stays whole. */
export function modelNote(m: Model): ModelNote {
  const paren = m.id.match(/^(.*?)\s*\((.*)\)\s*$/);
  return { name: (paren ? paren[1] : m.id).trim(), detail: paren ? paren[2].trim() : null, link: modelLink(m),
    licence: m.licence_mode, licenceText: m.licence ?? null };
}

/** Which bundle layers each timeline group draws (and the shot rows: `shots`). */
export const GROUP_LAYERS: Record<string, (keyof Layers)[]> = {
  shots: ['shots'], audio: ['transcript', 'speakers'], prosody: ['prosody'], people: ['faces', 'speakers'], objects: ['objects'],
  gestures: ['gestures', 'hands', 'bodies'], social: ['facing', 'gaze'], sounds: ['sounds'], text: ['text'], annotations: [],
};

/** The models behind a group, each once, in the order its layers list them. */
export function groupModels(layers: Layers, group: string): ModelNote[] {
  const seen = new Set<string>();
  return (GROUP_LAYERS[group] ?? []).flatMap((k) => layers[k]?.producer.models ?? [])
    .filter((m) => !seen.has(m.id) && seen.add(m.id)).map(modelNote);
}
