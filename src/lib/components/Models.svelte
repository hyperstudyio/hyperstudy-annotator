<script lang="ts">
  // Settings > Models: every model the steps use, by step: what it is (a page to read about it, as the timeline's ⓘ
  // gives), where it runs (here, or a hosted API), its licence when it limits use, the choices the step offers (their
  // defaults: Extract can still change them for one run, stepDefaults.ts), and what it needs from you: a provider's key
  // (with a Test), or access to a gated model on Hugging Face, set up at the top (HfAccess). A key saved that
  // no step uses (0.0.2 listed every key) is shown so it can be removed. A pipeline from before steps were listed gives
  // only the models: they are listed by step ref, and the keys the app keeps are shown below them. A feature in several
  // steps (objects: its names, its tracks, itself; the pipeline says, perception #45) is one row, each model and key once.
  import KeyRow from './KeyRow.svelte';
  import HfAccess from './HfAccess.svelte';
  import { accessOf, gatedModels, repoOf } from '../hfAccess';
  import { openExternal } from '../links';
  import { LICENCE_TEXT } from '../library';
  import { downloadSize, modelNote } from '../models';
  import { loadDefaults, saveDefault } from '../stepDefaults';
  import { choiceLabel, choiceName, keyRows, oncePerModel, stepGroups, type CheckResult, type CliKeys, type KeyStatus, type ModelInfo, type ModelsListing, type PipelineApi, type StepInfo } from '../pipeline';
  import type { LicenceMode } from '../types';
  let { api, keys, cli, models, problem = null, onkeys, onbusy }: {
    api: PipelineApi; keys: KeyStatus[]; cli: CliKeys | null;
    /** the models and steps; null: not known (an older pipeline, or the listing failed: `problem`) */
    models: ModelsListing | null; problem?: string | null;
    onkeys: (now: KeyStatus[]) => void; onbusy: (busy: string | null) => void;
  } = $props();
  const rows = $derived(keyRows(keys, cli));
  const key = (name: string) => rows.find((r) => r.name === name);
  // the steps, or (an older pipeline) one per step ref the models name
  const steps = $derived<StepInfo[]>(models?.nodes ?? [...new Set((models?.models ?? []).map((m) => m.node))]
    .map((node) => ({ node, title: node.replace(/@.*/, ''), service: null, secrets: [], settings: [] })));
  const groups = $derived(stepGroups(steps));
  // a step whose model is a choice shows the one chosen, not every model it could use
  const modelsOf = (s: StepInfo) => {
    const all = (models?.models ?? []).filter((m) => m.node === s.node), pick = s.settings.find((x) => x.key === 'model');
    return pick && all.some((m) => pick.choices.includes(m.id)) ? all.filter((m) => m.id === valueOf(s, 'model', pick.value)) : all;
  };
  const gated = $derived(gatedModels(models?.models ?? []));
  const used = $derived(new Set(steps.flatMap((s) => s.secrets)));
  const hf = $derived(key('HF_TOKEN'));
  // the Hugging Face token is set up with the access it gives, above the steps, not on each step that downloads with it
  const hfShown = $derived(!!(gated.length && hf));
  let hfCheck = $state<CheckResult | null>(null);
  // a step by its feature's name (the objects tracks are Objects')
  const stepTitle = (node: string) => groups.find((g) => g.parts.some((s) => s.node === node))?.step.title ?? node.replace(/@.*/, '');
  // a feature's models, each once (where a step only records one another downloads, the download's)
  const featureModels = (parts: StepInfo[]) => oncePerModel(parts.flatMap(modelsOf));
  // a feature waits on Hugging Face while one of its gated models is not known to be granted
  const needsAccess = (parts: StepInfo[]) => featureModels(parts).some((m) => m.gated && accessOf(hfCheck, repoOf(m))?.access !== 'granted');
  // where it runs: your computers, its API, or both for a feature with steps in each
  const where = (parts: StepInfo[]) => {
    const at = [...(parts.some((p) => !p.service) ? ['your computers'] : []), ...new Set(parts.filter((p) => p.service).map((p) => `the ${p.service}`))];
    return `Runs on ${at.join(' and ')}`;
  };
  const toAccess = () => {
    const at = document.getElementById('hf-access');
    at?.scrollIntoView({ block: 'start' });
    at?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  };
  // a pipeline that does not list its steps: the Anthropic key, as before
  const anthropicOld = $derived(!models?.nodes ? key('ANTHROPIC_API_KEY') : undefined);
  // every other key saved that no step here names (0.0.2 listed every key): it still reaches the pipeline's commands,
  // so it always has a row, where it can be removed (RunPod's is in Compute, with RunPod)
  const leftover = $derived(rows.filter((r) => r.stored && r.name !== 'RUNPOD_API_KEY' && !used.has(r.name)
    && !(r.name === 'HF_TOKEN' && gated.length) && !(anthropicOld && r.name === 'ANTHROPIC_API_KEY')));
  let defaults = $state(loadDefaults());
  // a default kept is the step's only while the pipeline still offers it (an update can take a model away): else its own
  const valueOf = (s: StepInfo, k: string, fallback: string | null) => {
    const kept = defaults[s.node]?.[k], choices = s.settings.find((x) => x.key === k)?.choices ?? [];
    return (kept !== undefined && choices.includes(kept) ? kept : fallback) ?? '';
  };
  let unsaved = $state<string | null>(null);
  const choose = (s: StepInfo, k: string, v: string) => {
    const r = saveDefault(s.node, k, v);
    defaults = r.defaults;
    unsaved = r.saved ? null : `Could not keep this choice (${r.problem}): Extract plans with the step's own default.`;
  };
  // its page from its id; then called as people say it (a Claude model by its name)
  const note = (m: ModelInfo) => {
    const n = modelNote({ id: m.id, source: m.source, revision: null, licence: null, licence_mode: m.licence_mode as LicenceMode });
    return { ...n, name: choiceName(n.name) };
  };
  // only a licence that limits use is said; the rest is the common case
  const limits = (m: ModelInfo) => m.licence_mode === 'academic-only' || m.licence_mode === 'needs-review';
  // only a model with a source is downloaded (one recorded without, as the objects layer records SAM 3, is not)
  const size = (m: ModelInfo) => m.source ? downloadSize(m.size_gb) : null;
  const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
</script>

{#if hfShown && hf}
  <HfAccess {api} k={hf} elsewhere={hf.elsewhere} {gated} {stepTitle} bind:check={hfCheck} {onkeys} {onbusy} />
{/if}

<section class="set-part" aria-labelledby="models-heading">
  <div class="set-head"><h2 id="models-heading">The steps' models</h2></div>
  <p class="muted">What each step runs, and what it needs from you. The choices here are the defaults; Extract can change them for one run.</p>
  {#if problem}<p class="error">Could not list the models: {problem}</p>{/if}
  {#if models}
    <ul class="set-rows steps">
      {#each groups as { step: s, parts } (s.node)}
        {@const ms = featureModels(parts)}
        <li class="step" aria-label={s.title}>
          <span class="title">{s.title}</span>
          <div class="body">
            {#each ms as m (m.id)}
              {@const n = note(m)}
              <div class="model">
                {#if n.link}<button class="link name" onclick={() => openExternal(n.link!)} title={m.source ?? m.id}>{n.name}</button>{:else}<span class="name" title={m.source ?? m.id}>{n.name}</span>{/if}
                {#if n.detail}<span class="muted">{n.detail}</span>{/if}
                {#if limits(m)}<span class="licence">{LICENCE_TEXT[m.licence_mode as LicenceMode]}</span>{/if}
              </div>
            {/each}
            <div class="where muted">{[where(parts), ...ms.map(size).filter(Boolean)].join(' · ')}</div>
            {#if parts.some((p) => p.settings.length)}
              {#if unsaved}<p class="error">{unsaved}</p>{/if}
              <div class="choices">
                {#each parts.flatMap((p) => p.settings.map((st) => ({ p, st }))) as { p, st } (`${p.node}.${st.key}`)}
                  <label class="choice">{capital(st.key)}
                    <select value={valueOf(p, st.key, st.value)} onchange={(e) => choose(p, st.key, e.currentTarget.value)} aria-label={`${s.title}: ${st.key}`}>
                      {#each st.choices as c (c)}<option value={c}>{choiceLabel(st, c)}</option>{/each}
                    </select>
                  </label>
                {/each}
              </div>
            {/if}
            {#each [...new Set(parts.flatMap((p) => p.secrets))].filter((n) => !(hfShown && n === 'HF_TOKEN')) as name (name)}
              {@const k = key(name)}
              {#if k}<ul class="set-rows keys"><KeyRow {api} {k} elsewhere={k.elsewhere} label={`${k.label} key`} onchange={onkeys} {onbusy} /></ul>{/if}
            {/each}
            {#if hfShown && needsAccess(parts)}<button class="link gated" onclick={toAccess}>Needs Hugging Face access</button>{/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if anthropicOld || leftover.length}
  <section class="set-part" aria-labelledby="keys-heading">
    <div class="set-head"><h2 id="keys-heading">{anthropicOld ? 'Keys' : 'Keys no step uses'}</h2></div>
    {#if !anthropicOld}<p class="muted">Saved earlier. No step uses them, but the pipeline is still given them with every command: remove them if you do not need them.</p>{/if}
    <ul class="set-rows">
      {#if anthropicOld}<KeyRow {api} k={anthropicOld} elsewhere={anthropicOld.elsewhere} label="Anthropic key" onchange={onkeys} {onbusy} />{/if}
      {#each leftover as k (k.name)}<KeyRow {api} {k} label={`${k.label} key`} onchange={onkeys} {onbusy} />{/each}
    </ul>
  </section>
{/if}

<style>
  .step { display: grid; grid-template-columns: 9rem minmax(0, 1fr); gap: 4px 16px; align-items: baseline; }
  .title { color: var(--color-text-secondary); }
  .body { display: grid; gap: 6px; min-width: 0; }
  .model { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; min-width: 0; }
  .name { overflow-wrap: anywhere; text-align: left; }
  .model .muted, .where { font-size: 12px; }
  .licence { font-size: 12px; color: var(--color-caution); }
  .choices { display: flex; flex-wrap: wrap; gap: 8px 16px; }
  .choice { display: inline-flex; gap: 8px; align-items: center; color: var(--color-text-secondary); font-size: 13px; }
  .keys > :global(li) { padding: 4px 0 0; border: 0; }
  .keys :global(.key) { grid-template-columns: 7rem minmax(0, 1fr) auto; }
  .gated { font-size: 12px; color: var(--color-caution); justify-self: start; text-align: left; }
  @media (max-width: 560px) { .step { grid-template-columns: minmax(0, 1fr); } }
</style>
