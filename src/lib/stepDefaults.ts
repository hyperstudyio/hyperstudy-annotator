// The choices Settings > Models makes the default for a step (the shot captions' model and effort): kept per user, by
// the step's ref (vlm.shot-captions@1.0.0), and applied by Extract to a plan where the run has not chosen otherwise.
// Extract still changes them for one run.
import type { Plan, Settings } from './pipeline';

/** step ref -> setting key -> value */
export type StepDefaults = Record<string, Record<string, string>>;
const KEY = 'hyperstudy-annotator:step-defaults';

export function loadDefaults(storage: Storage | null = globalThis.localStorage ?? null): StepDefaults {
  try { return JSON.parse(storage?.getItem(KEY) ?? '{}') as StepDefaults; } catch { return {}; }   // none kept: the pipeline's
}
export function saveDefault(step: string, key: string, value: string, storage: Storage | null = globalThis.localStorage ?? null): StepDefaults {
  const now = loadDefaults(storage);
  now[step] = { ...now[step], [key]: value };
  try { storage?.setItem(KEY, JSON.stringify(now)); } catch { /* not kept: Extract uses the pipeline's own default */ }
  return now;
}

/** The defaults a plan's steps take, by step id: each one the run has not chosen otherwise and that is one of the
 *  step's choices. Kept apart from the run's own choices (Extract merges them under those when it plans and runs), so
 *  a default changed in Settings is what the next plan takes. */
export function defaultsFor(plan: Plan, chosen: Settings, defaults: StepDefaults): Settings {
  const out: Settings = {};
  for (const n of plan.nodes) {
    for (const s of n.settings ?? []) {
      const d = defaults[n.uses]?.[s.key];
      if (d === undefined || !s.choices.includes(d) || chosen[n.id]?.[s.key] !== undefined) continue;
      out[n.id] = { ...out[n.id], [s.key]: d };
    }
  }
  return out;
}

/** The run's own choices over the defaults. */
export const withDefaults = (defaults: Settings, chosen: Settings): Settings =>
  Object.fromEntries([...new Set([...Object.keys(defaults), ...Object.keys(chosen)])].map((n) => [n, { ...defaults[n], ...chosen[n] }]));
