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

/** The settings a plan should have that it does not: each default the run has not chosen otherwise, that is one of the
 *  step's choices and not already its value. Empty when the plan already has them (so planning again stops). */
export function defaultsToApply(plan: Plan, chosen: Settings, defaults: StepDefaults): Settings {
  const out: Settings = {};
  for (const n of plan.nodes) {
    for (const s of n.settings ?? []) {
      const d = defaults[n.uses]?.[s.key];
      if (d === undefined || d === s.value || !s.choices.includes(d) || chosen[n.id]?.[s.key] !== undefined) continue;
      out[n.id] = { ...out[n.id], [s.key]: d };
    }
  }
  return out;
}
