// Hugging Face access, as Settings > Models sets it up: a gated model downloads only once its owner has granted your
// account access (per person, never per organisation), with a token of yours. `perception keys check HF_TOKEN` says,
// for each gated model the steps use, whether your account has it (perception #38); a pipeline from before says only
// whether Hugging Face accepts the token.
import type { CheckResult, ModelAccess, ModelInfo } from './pipeline';

export const SIGN_IN_URL = 'https://huggingface.co/login';
/** A new token of the Read type (the type is preselected by the address: unverified). */
export const NEW_TOKEN_URL = 'https://huggingface.co/settings/tokens/new?tokenType=read';

/** A repo's page, where access is asked for: hf://owner/name@revision[/file], or the id. */
export const repoOf = (m: Pick<ModelInfo, 'id' | 'source'>) =>
  (m.source?.startsWith('hf://') ? m.source.slice(5) : m.id).split('@')[0].split('/').slice(0, 2).join('/');
export const pageOf = (repo: string) => `https://huggingface.co/${repo}`;

// what people call them; another gated model goes by its repo's name
const NAMES: Record<string, string> = { 'facebook/sam3': 'SAM 3', 'facebook/dinov3-vitl16-pretrain-lvd1689m': 'DINOv3', 'pyannote/speaker-diarization-community-1': 'pyannote' };
const OWNERS: Record<string, string> = { facebook: 'Meta', 'meta-llama': 'Meta' };
export const shortName = (repo: string) => NAMES[repo] ?? repo.split('/').pop() ?? repo;

/** How access is granted, when Hugging Face says: by the owner, by hand, or on accepting the terms. */
export function grantedBy(repo: string, gating: ModelAccess['gating'] | undefined): string | null {
  if (gating === 'manual') { const owner = repo.split('/')[0]; return `${OWNERS[owner] ?? owner} reviews requests`; }
  return gating === 'auto' ? 'Granted on accepting the terms' : null;
}

/** Whether the pipeline said each model's access (false: one from before, which says only whether the token works). */
export const perModel = (c: CheckResult | null): c is CheckResult & { models: ModelAccess[] } => Array.isArray(c?.models);

/** A model's access in an answer, or null when the answer does not say it. */
export const accessOf = (c: CheckResult | null, repo: string): ModelAccess | null =>
  perModel(c) ? c.models.find((m) => m.repo === repo) ?? null : null;

/** Every gated model the steps use, once, with the steps' refs that use it. */
export function gatedModels(models: ModelInfo[]): { repo: string; id: string; nodes: string[] }[] {
  const by = new Map<string, { repo: string; id: string; nodes: string[] }>();
  for (const m of models.filter((x) => x.gated)) {
    const repo = repoOf(m), e = by.get(repo) ?? { repo, id: m.id, nodes: [] };
    if (!e.nodes.includes(m.node)) e.nodes.push(m.node);
    by.set(repo, e);
  }
  return [...by.values()];
}

/** Set up: Hugging Face accepted the token and granted every one of `repos`. */
export const allGranted = (c: CheckResult | null, repos: string[]) =>
  !!c?.ok && perModel(c) && repos.length > 0 && repos.every((r) => accessOf(c, r)?.access === 'granted');
