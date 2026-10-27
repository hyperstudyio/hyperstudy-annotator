<script lang="ts">
  // Settings > Models: every model the steps use, by step: what it is (a page to read about it, as the timeline's ⓘ
  // gives), where it runs (here, or a hosted API), its licence when it limits use, the choices the step offers (their
  // defaults: Extract can still change them for one run, stepDefaults.ts), and what it needs from you: a provider's key
  // (with a Test), or access to a gated model on Hugging Face and the Hugging Face key to download it. A key saved that
  // no step uses (0.0.2 listed every key) is shown so it can be removed. A pipeline from before steps were listed gives
  // only the models: they are listed by step ref, and the keys the app keeps are shown below them.
  import KeyRow from './KeyRow.svelte';
  import { openExternal } from '../links';
  import { LICENCE_TEXT } from '../library';
  import { modelNote } from '../models';
  import { loadDefaults, saveDefault } from '../stepDefaults';
  import { choiceLabel, choiceName, keyRows, type CliKeys, type KeyStatus, type ModelInfo, type ModelsListing, type PipelineApi, type StepInfo } from '../pipeline';
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
  // a step whose model is a choice shows the one chosen, not every model it could use
  const modelsOf = (s: StepInfo) => {
    const all = (models?.models ?? []).filter((m) => m.node === s.node), pick = s.settings.find((x) => x.key === 'model');
    return pick && all.some((m) => pick.choices.includes(m.id)) ? all.filter((m) => m.id === valueOf(s, 'model', pick.value)) : all;
  };
  const gated = $derived((models?.models ?? []).filter((m) => m.gated));
  const used = $derived(new Set(steps.flatMap((s) => s.secrets)));
  const hf = $derived(key('HF_TOKEN'));
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
  const size = (m: ModelInfo) => m.size_gb ? `${m.size_gb < 1 ? m.size_gb.toFixed(1) : Math.round(m.size_gb * 10) / 10} GB, downloaded once` : null;
  const page = (m: ModelInfo) => `https://huggingface.co/${(m.source?.startsWith('hf://') ? m.source.slice(5) : m.id).split('@')[0]}`;
  const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
</script>

<section class="set-part" aria-labelledby="models-heading">
  <div class="set-head"><h2 id="models-heading">The steps' models</h2></div>
  <p class="muted">What each step runs, and what it needs from you. The choices here are the defaults; Extract can change them for one run.</p>
  {#if problem}<p class="error">Could not list the models: {problem}</p>{/if}
  {#if models}
    <ul class="set-rows steps">
      {#each steps as s (s.node)}
        <li class="step" aria-label={s.title}>
          <span class="title">{s.title}</span>
          <div class="body">
            {#each modelsOf(s) as m (m.id)}
              {@const n = note(m)}
              <div class="model">
                {#if n.link}<button class="link name" onclick={() => openExternal(n.link!)} title={m.source ?? m.id}>{n.name}</button>{:else}<span class="name" title={m.source ?? m.id}>{n.name}</span>{/if}
                {#if n.detail}<span class="muted">{n.detail}</span>{/if}
                {#if limits(m)}<span class="licence">{LICENCE_TEXT[m.licence_mode as LicenceMode]}</span>{/if}
              </div>
            {/each}
            <div class="where muted">{[s.service ? `Runs on the ${s.service}` : 'Runs on your computers', ...modelsOf(s).map(size).filter(Boolean)].join(' · ')}</div>
            {#if s.settings.length}
              {#if unsaved}<p class="error">{unsaved}</p>{/if}
              <div class="choices">
                {#each s.settings as st (st.key)}
                  <label class="choice">{capital(st.key)}
                    <select value={valueOf(s, st.key, st.value)} onchange={(e) => choose(s, st.key, e.currentTarget.value)} aria-label={`${s.title}: ${st.key}`}>
                      {#each st.choices as c (c)}<option value={c}>{choiceLabel(st, c)}</option>{/each}
                    </select>
                  </label>
                {/each}
              </div>
            {/if}
            {#each s.secrets as name (name)}
              {@const k = key(name)}
              {#if k}<ul class="set-rows keys"><KeyRow {api} {k} elsewhere={k.elsewhere} label={`${k.label} key`} onchange={onkeys} {onbusy} /></ul>{/if}
            {/each}
            {#each modelsOf(s).filter((m) => m.gated) as m (m.id)}
              <div class="gated">Needs access granted on its page first. <button class="link" onclick={() => openExternal(page(m))}>Request access on Hugging Face</button></div>
            {/each}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if gated.length && hf}
  <section class="set-part" aria-labelledby="hf-heading">
    <div class="set-head"><h2 id="hf-heading">Hugging Face</h2></div>
    <p class="muted">Gated models download with your Hugging Face key, once access is granted on their pages.</p>
    <ul class="set-rows"><KeyRow {api} k={hf} elsewhere={hf.elsewhere} label="Hugging Face key" onchange={onkeys} {onbusy} /></ul>
  </section>
{/if}

{#if anthropicOld || leftover.length}
  <section class="set-part" aria-labelledby="keys-heading">
    <div class="set-head"><h2 id="keys-heading">{anthropicOld ? 'Keys' : 'Keys no step uses'}</h2></div>
    {#if !anthropicOld}<p class="muted">Saved earlier; nothing sends them now. Remove them if you do not need them.</p>{/if}
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
  .gated { font-size: 12px; color: var(--color-caution); }
  @media (max-width: 560px) { .step { grid-template-columns: minmax(0, 1fr); } }
</style>
