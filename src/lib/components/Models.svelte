<script lang="ts">
  // Settings > Models: what the steps' models need from you. Shot captions call a provider's API, with its key. Gated
  // models (their Hugging Face page asks you to accept its terms first) need access granted there and a Hugging Face
  // key to download them; the key is shown when a step uses one, or when the models cannot be listed (an older
  // pipeline, a listing that failed), so it can always be set.
  import KeyRow from './KeyRow.svelte';
  import { openExternal } from '../links';
  import { keyRows, type CliKeys, type KeyStatus, type ModelInfo, type PipelineApi } from '../pipeline';

  let { api, keys, cli, models, problem = null, onkeys, onbusy }: {
    api: PipelineApi; keys: KeyStatus[]; cli: CliKeys | null;
    /** the steps' models; null: not known (an older pipeline, or the listing failed: `problem`) */
    models: ModelInfo[] | null; problem?: string | null;
    onkeys: (now: KeyStatus[]) => void; onbusy: (busy: string | null) => void;
  } = $props();

  const rows = $derived(keyRows(keys, cli));
  const key = (name: string) => rows.find((r) => r.name === name);
  const anthropic = $derived(key('ANTHROPIC_API_KEY'));
  const hf = $derived(key('HF_TOKEN'));
  const gated = $derived((models ?? []).filter((m) => m.gated));
  // a gated model's page, where access is asked for: its Hugging Face id (hf://owner/name), else its id
  const page = (m: ModelInfo) => `https://huggingface.co/${(m.source?.startsWith('hf://') ? m.source.slice(5) : m.id).split('@')[0]}`;
</script>

<section class="set-part" aria-labelledby="captions-heading">
  <div class="set-head"><h2 id="captions-heading">Shot captions</h2></div>
  <ul class="set-rows">
    <li class="row"><span class="name">Provider</span><span>Anthropic (Claude)</span></li>
    {#if anthropic}<KeyRow {api} k={anthropic} elsewhere={anthropic.elsewhere} onchange={onkeys} {onbusy} />{/if}
  </ul>
</section>

<section class="set-part" aria-labelledby="gated-heading">
  <div class="set-head"><h2 id="gated-heading">Gated models</h2></div>
  {#if problem}<p class="error">Could not list the models: {problem}</p>{/if}
  {#if models && !gated.length && !problem}<p class="muted">None of the models the steps use needs access approval.</p>
  {:else if !models || problem}
    {#if hf}<ul class="set-rows"><KeyRow {api} k={hf} elsewhere={hf.elsewhere} label="Hugging Face key" onchange={onkeys} {onbusy} /></ul>{/if}
  {:else if gated.length}
    <p class="muted">Each needs access granted on its Hugging Face page, then your Hugging Face key to download it.</p>
    <ul class="set-rows">
      {#each gated as m (m.node + m.id)}
        <li class="row"><span class="name" title={m.id}>{m.id.split('/').pop()}</span>
          <button class="link" onclick={() => openExternal(page(m))}>Request access on Hugging Face</button></li>
      {/each}
      {#if hf}<KeyRow {api} k={hf} elsewhere={hf.elsewhere} label="Hugging Face key" onchange={onkeys} {onbusy} />{/if}
    </ul>
  {/if}
</section>

<style>
  .row { display: grid; grid-template-columns: 9rem minmax(0, 1fr); gap: 4px 16px; align-items: center; }
  .name { color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .link { justify-self: start; }
</style>
