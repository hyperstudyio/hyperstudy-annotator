<script lang="ts">
  // Settings > Models: Hugging Face access, for the gated models the steps use. Setting it up is a sequence (an
  // account, access asked for on each model's page, a token, the token here), so it is numbered, and each number turns
  // green once its step is known to be done. The token is checked as soon as it is saved, and whenever this is shown:
  // the account it belongs to, and each model's access (`keys check HF_TOKEN`); Check again asks again, as an owner's
  // review takes time. Once every model is granted it is one line, with the steps a click away. A pipeline from before
  // the per-model check keeps the key's own Test.
  import { untrack } from 'svelte';
  import { openExternal } from '../links';
  import { NEW_TOKEN_URL, SIGN_IN_URL, accessOf, allGranted, grantedBy, pageOf, perModel, shortName } from '../hfAccess';
  import { olderCli, tooOld, type CheckResult, type KeyStatus, type PipelineApi } from '../pipeline';

  let { api, k, elsewhere = null, gated, stepTitle, check = $bindable(null), onkeys, onbusy }: {
    api: PipelineApi; k: KeyStatus;
    /** where the command line finds a token on its own, or null */
    elsewhere?: string | null;
    /** the gated models the steps use, with the steps' refs */
    gated: { repo: string; id: string; nodes: string[] }[];
    stepTitle: (node: string) => string;
    /** the last answer that said each model's access (null: none yet, or a pipeline from before) */
    check?: CheckResult | null;
    onkeys: (now: KeyStatus[]) => void; onbusy: (busy: string | null) => void;
  } = $props();

  const has = $derived(k.stored || !!elsewhere);
  let legacy = $state(false);   // the pipeline says only whether the token works
  let checking = $state(false);
  let editing = $state(false);
  let draft = $state('');
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  let tested = $state<CheckResult | null>(null);   // a pipeline from before: its Test's answer
  let showSteps = $state(false);
  let asked = 0;

  // the latest question wins: an answer to an earlier one (a token since replaced) is dropped
  async function ask(manual = false) {
    const mine = ++asked;
    checking = true; error = null; tested = null;
    try {
      const r = await api.checkKey('HF_TOKEN');
      if (mine !== asked) return;
      legacy = !perModel(r);
      check = legacy ? null : r;
      if (legacy && manual) tested = r;
    } catch (e) {
      if (mine !== asked) return;
      check = null;
      // a pipeline from before keys check has no check to keep; any other failure is said, and can be asked again
      legacy = olderCli(e);
      if (!legacy) error = `Could not check the token: ${e}`;
      else if (manual) error = tooOld(e, 'test keys');
    } finally { if (mine === asked) checking = false; }
  }
  $effect(() => { untrack(() => ask()); });

  const act = async (what: string, f: () => Promise<KeyStatus[]>) => {
    asked++;   // an answer on its way is the old token's
    checking = false; busy = what; error = null; tested = null; onbusy(what);
    try { onkeys(await f()); } catch (e) { error = String(e); busy = null; onbusy(null); return; }
    busy = null; onbusy(null);
    await ask();
  };
  const save = () => {
    const value = draft;
    draft = ''; editing = false;   // out of the page at once, whatever the keychain answers
    return act('Saving the Hugging Face token…', () => api.setKey(k.name, value));
  };
  const focus = (el: HTMLElement) => { el.focus(); };

  const repos = $derived(gated.map((m) => m.repo));
  const accepted = $derived(!!check?.ok);
  const done = $derived(allGranted(check, repos));
  const collapsed = $derived(done && !editing && !showSteps);
  const refused = $derived(has && !!check && !check.ok);
  const refusal = $derived(check && /refused/.test(check.detail) ? 'Hugging Face refused this token.' : `Could not check the token: ${check?.detail}.`);
  const STATUS = { granted: '✓ Granted', 'not-granted': 'Not yet', unknown: 'Could not check' } as const;
  const status = (repo: string) => { const a = accessOf(check, repo); return a && accepted ? a : null; };
  const count = $derived(repos.length === 1 ? 'access to its model' : `access to all ${repos.length} models`);
</script>

<section class="set-part hf" aria-label="Hugging Face access" id="hf-access">
  {#if collapsed}
    <div class="set-head line">
      <h2 tabindex="-1">Hugging Face</h2>
      <span class="summary">{check?.account ? `Signed in as ${check.account}` : 'Token accepted'} · {count}</span>
      <span class="actions">
        <button class="plain" onclick={() => ask(true)} disabled={checking || !!busy}>Check again</button>
        <button class="plain" onclick={() => { editing = true; }} disabled={!!busy} aria-label="Replace the Hugging Face token">Replace</button>
        {#if k.stored}<button class="plain danger" onclick={() => act('Removing the Hugging Face token…', () => api.removeKey(k.name))} disabled={!!busy} aria-label="Remove the Hugging Face token">Remove</button>{/if}
        <button class="plain" onclick={() => (showSteps = true)} aria-expanded="false">Show steps</button>
      </span>
    </div>
  {:else}
    <div class="set-head">
      <h2 tabindex="-1">Hugging Face access</h2>
      {#if done}<button class="plain" onclick={() => { showSteps = false; editing = false; }} aria-expanded="true">Hide steps</button>{/if}
    </div>
    <ol class="steps">
      <li aria-label="Sign in">
        <span class="n" class:done={accepted} aria-hidden="true">1</span>
        <span>Sign in to Hugging Face, or create an account</span>
        <button onclick={() => openExternal(SIGN_IN_URL)}>Open Hugging Face</button>
      </li>
      <li aria-label="Ask for access">
        <span class="n" class:done aria-hidden="true">2</span>
        <span>Ask for access to each model</span>
        <span class="actions">
          {#if checking}<span class="muted" role="status">Checking…</span>
          {:else if has && !legacy}<button class="plain" onclick={() => ask(true)} disabled={!!busy}>Check again</button>{/if}
        </span>
        <ul class="models">
          {#each gated as m (m.repo)}
            {@const a = status(m.repo)}
            <li aria-label={shortName(m.repo)}>
              <span class="name" title={m.repo}>{shortName(m.repo)}</span>
              <span class="meta">
                <span class="used">{m.nodes.map(stepTitle).join(', ')}</span>
                {#if grantedBy(m.repo, accessOf(check, m.repo)?.gating)}<span class="how">{grantedBy(m.repo, accessOf(check, m.repo)?.gating)}</span>{/if}
              </span>
              <button class:plain={a?.access === 'granted'} onclick={() => openExternal(pageOf(m.repo))} aria-label={`Ask for access to ${shortName(m.repo)}`}>Ask for access</button>
              <span class="status {a?.access ?? ''}" title={a?.reason ?? undefined}>{a ? STATUS[a.access] : ''}</span>
            </li>
          {/each}
        </ul>
      </li>
      <li aria-label="Create a token">
        <span class="n" class:done={accepted} aria-hidden="true">3</span>
        <span>Create a token with Read access</span>
        <button onclick={() => openExternal(NEW_TOKEN_URL)}>Create token</button>
      </li>
      <li aria-label="Hugging Face token">
        <span class="n" class:done={accepted} aria-hidden="true">4</span>
        {#if editing || !has}
          <form class="enter" aria-label="Hugging Face token" onsubmit={(e) => { e.preventDefault(); save(); }}>
            <label for="hf-token">Paste it here</label>
            {#if editing}
              <input id="hf-token" type="password" bind:value={draft} placeholder="hf_…" autocomplete="off" spellcheck="false" use:focus
                     onkeydown={(e) => { if (e.key === 'Escape') { editing = false; draft = ''; } }} />
            {:else}
              <input id="hf-token" type="password" bind:value={draft} placeholder="hf_…" autocomplete="off" spellcheck="false" />
            {/if}
            <button type="submit" class="primary" disabled={!draft.trim() || !!busy}>Save</button>
            {#if has}<button type="button" onclick={() => { editing = false; draft = ''; }}>Cancel</button>{/if}
          </form>
          <span></span>
        {:else}
          <span class="token">
            <span>Your token</span>
            {#if k.stored}<span class="muted">Saved in the keychain</span>{:else}<span class="muted">Found in <span class="path">{elsewhere}</span></span>{/if}
            {#if accepted && check?.account}<span class="ok">Signed in as {check.account}</span>{/if}
          </span>
          <span class="actions">
            {#if legacy}<button class="plain" onclick={() => ask(true)} disabled={checking || !!busy} aria-label="Test the Hugging Face token">Test</button>{/if}
            <button class="plain" onclick={() => { editing = true; }} disabled={!!busy} aria-label="Replace the Hugging Face token">Replace</button>
            {#if k.stored}<button class="plain danger" onclick={() => act('Removing the Hugging Face token…', () => api.removeKey(k.name))} disabled={!!busy} aria-label="Remove the Hugging Face token">Remove</button>{/if}
          </span>
        {/if}
        {#if refused && !editing}<p class="note error" role="alert">{refusal}</p>{/if}
        {#if tested}<p class="note" class:ok={tested.ok} class:error={!tested.ok} role="status">{tested.ok ? '✓ ' : ''}{tested.detail}.</p>{/if}
      </li>
    </ol>
  {/if}
  {#if busy}<p class="note muted" role="status">{busy}</p>{/if}
  {#if error}<p class="note error" role="alert">{error}</p>{/if}
</section>

<style>
  .hf h2:focus { outline: none; }
  .hf h2:focus-visible { outline: 2px solid var(--color-info); outline-offset: 2px; }
  .line { justify-content: flex-start; flex-wrap: wrap; gap: 4px 14px; }
  .summary { color: var(--color-text-secondary); flex: 1 1 auto; min-width: 0; }
  .actions { display: flex; gap: 2px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
  .steps { list-style: none; margin: 0; padding: 0; }
  .steps > li { display: grid; grid-template-columns: 1.25rem minmax(0, 1fr) auto; gap: 6px 12px; align-items: baseline; padding: 10px 0;
                border-top: 1px solid var(--color-border-default); }
  .steps > li:first-child { border-top: 0; }
  /* the sequence's numbers: muted until the step is known to be done */
  .n { font-weight: 600; font-variant-numeric: tabular-nums; color: var(--color-text-muted); text-align: right; }
  .n.done { color: var(--color-primary); }
  .models { grid-column: 2 / -1; list-style: none; margin: 2px 0 0; padding: 0; display: grid; gap: 2px; }
  .models > li { display: grid; grid-template-columns: 4.75rem 8.5rem minmax(0, 1fr) auto 5.25rem; grid-template-areas: "name used how ask status";
                 gap: 4px 12px; align-items: baseline; padding: 3px 0; }
  .name { grid-area: name; color: var(--color-text-primary); overflow-wrap: anywhere; }
  .meta { display: contents; }
  .used { grid-area: used; color: var(--color-text-secondary); }
  .how { grid-area: how; color: var(--color-text-muted); font-size: 12px; }
  .models button { grid-area: ask; padding: 2px 9px; }
  .status { grid-area: status; white-space: nowrap; color: var(--color-text-muted); }
  .status.granted { color: var(--color-primary); }
  .status.not-granted { color: var(--color-caution); }
  .enter { grid-column: 2 / -1; display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
  .enter label { margin-right: 4px; }
  .enter input { flex: 1 1 14rem; min-width: 0; max-width: 26rem; }
  .token { display: flex; flex-wrap: wrap; gap: 2px 12px; align-items: baseline; min-width: 0; overflow-wrap: anywhere; }
  .ok { color: var(--color-primary); }
  .path { color: var(--color-text-secondary); }
  .note { grid-column: 2 / -1; margin: 0; font-size: 12px; }
  .hf > .note { margin-left: calc(1.25rem + 12px); }
  @media (max-width: 560px) {
    .models > li { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "name status" "meta ask"; }
    .meta { grid-area: meta; display: flex; flex-wrap: wrap; gap: 0 10px; align-items: baseline; }
    .models button { justify-self: end; }
  }
</style>
