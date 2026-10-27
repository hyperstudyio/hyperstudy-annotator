<script lang="ts">
  // Settings > Compute > Cloud GPU: the providers that start a GPU machine for a step and delete it after
  // (`perception cloud`). A provider added here shows up in the step menus on Extract; choosing it there is still what
  // sends a step's inputs. RunPod is set up with its API key (kept in the keychain, KeyRow: replaced or tested there,
  // never removed on its own); AWS uses the AWS credentials on this computer, through SkyPilot. Adding one checks it can
  // be used first; Test checks again, changing nothing (`perception cloud check`); Remove takes RunPod's key with it.
  import KeyRow from './KeyRow.svelte';
  import { openExternal } from '../links';
  import { keyRows, provider, tooOld, type CheckResult, type CliKeys, type CloudProviderName, type CloudStatus, type KeyStatus, type PipelineApi } from '../pipeline';

  let { api, cloud, keys, cli, onchange, onkeys, onbusy }: {
    api: PipelineApi; cloud: CloudStatus; keys: KeyStatus[]; cli: CliKeys | null;
    onchange: (now: CloudStatus) => void; onkeys: (now: KeyStatus[]) => void;
    /** what is under way, then null (Start run on Extract waits for it) */
    onbusy: (busy: string | null) => void;
  } = $props();

  const NAMES: Record<CloudProviderName, string> = { runpod: 'RunPod', aws: 'AWS' };
  // RunPod first: it needs only a key, so it is the one most people can add
  const offered = $derived((['runpod', 'aws'] as CloudProviderName[]).filter((p) => provider(cloud, p)));
  const added = $derived(offered.filter((p) => provider(cloud, p)!.enabled));
  const addable = $derived(offered.filter((p) => !provider(cloud, p)!.enabled));
  const runpodKey = $derived(keyRows(keys, cli).find((k) => k.name === 'RUNPOD_API_KEY'));

  let adding = $state<CloudProviderName | null>(null);
  let draft = $state('');
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  const act = async (what: string, f: () => Promise<void>) => {
    busy = what; error = null; onbusy(what);
    try { await f(); return true; } catch (e) { error = String(e); return false; } finally { busy = null; onbusy(null); }
  };
  const start = () => { adding = addable[0] ?? null; draft = ''; error = null; };
  // RunPod with no key saved or found: the key is saved first (the CLI reads it from the keychain), then RunPod checks
  // it. A key RunPod refuses is taken out again: it would otherwise sit in the keychain, sent to every command, with
  // RunPod not added.
  const needsKey = $derived(adding === 'runpod' && !runpodKey?.stored && !runpodKey?.elsewhere);
  const add = async () => {
    const p = adding!;
    const value = draft;
    draft = '';
    if (await act(`Checking ${NAMES[p]}…`, async () => {
      const saved = p === 'runpod' && !!value.trim();
      if (saved) onkeys(await api.setKey('RUNPOD_API_KEY', value));
      try { onchange(await api.cloud(true, p)); }
      catch (e) { if (saved) onkeys(await api.removeKey('RUNPOD_API_KEY')); throw e; }
    })) { changed(p); adding = null; }
  };
  // What a Test said is shown only while what it was said of is unchanged: the provider (each time it is added or
  // removed, and RunPod's key each time it is saved here) and where RunPod's key is found. A Test that answers after
  // the key changed, or about another provider, is not shown as the new one's.
  let changes = $state<Record<CloudProviderName, number>>({ aws: 0, runpod: 0 });
  const changed = (p: CloudProviderName) => { changes = { ...changes, [p]: changes[p] + 1 }; };
  const about = (p: CloudProviderName) => `${changes[p]}|${p === 'runpod' ? `${runpodKey?.stored}|${runpodKey?.elsewhere ?? ''}` : ''}`;
  let results = $state<Partial<Record<CloudProviderName, { about: string; said: CheckResult }>>>({});
  const tested = $derived(Object.fromEntries((Object.keys(results) as CloudProviderName[])
    .filter((p) => results[p]!.about === about(p)).map((p) => [p, results[p]!.said])) as Partial<Record<CloudProviderName, CheckResult>>);
  const test = async (p: CloudProviderName) => {
    const of = about(p);
    busy = `Testing ${NAMES[p]}…`; error = null;
    try { results = { ...results, [p]: { about: of, said: await api.checkCloud(p) } }; } catch (e) { error = tooOld(e, 'test cloud providers'); } finally { busy = null; }
  };
  const keyChanged = (now: KeyStatus[]) => { changed('runpod'); onkeys(now); };
  const remove = (p: CloudProviderName) => act(`Removing ${NAMES[p]}…`, async () => {
    changed(p);
    onchange(await api.cloud(false, p));
    if (p === 'runpod' && runpodKey?.stored) onkeys(await api.removeKey('RUNPOD_API_KEY'));
  });
  // RunPod's machine is whichever of its GPUs is free: its price is the most of theirs
  const price = (p: CloudProviderName) => `${p === 'runpod' ? 'up to ' : ''}$${provider(cloud, p)!.hourly_usd.toFixed(2)} an hour`;
  const focus = (el: HTMLElement) => { el.focus(); };
</script>

<section class="set-part" aria-labelledby="cloud-heading">
  <div class="set-head">
    <h2 id="cloud-heading">Cloud GPU</h2>
    {#if addable.length && !adding}<button onclick={start} disabled={!!busy}>Add provider…</button>{/if}
  </div>
  {#if !added.length && !adding}<p class="muted">None yet. A cloud GPU is started for a step and deleted when it ends, billed by the hour.</p>{/if}
  {#if runpodKey?.stored && !added.includes('runpod')}
    <!-- a RunPod key in the keychain with RunPod not added (saved in an earlier version): it can still be replaced or removed -->
    <ul class="set-rows"><KeyRow {api} k={runpodKey} label="RunPod API key" onchange={onkeys} {onbusy} /></ul>
  {/if}

  {#if added.length}
    <ul class="set-rows">
      {#each added as p (p)}
        <li class="provider" aria-label={NAMES[p]}>
          <div class="head">
            <strong>{NAMES[p]}</strong>
            <span class="muted">{provider(cloud, p)!.machine.replace(/^(RunPod, |AWS )/, '')}, {price(p)}</span>
            <button class="plain" onclick={() => test(p)} disabled={!!busy} aria-label={`Test ${NAMES[p]}`} title="Check it can be used now, changing nothing">Test</button>
            <button class="plain danger" onclick={() => remove(p)} disabled={!!busy} aria-label={`Remove ${NAMES[p]}`} title={p === 'runpod' ? 'Its API key is removed with it' : undefined}>Remove</button>
          </div>
          {#if tested[p]}<p class="tested" class:ok={tested[p]!.ok} class:error={!tested[p]!.ok} role="status">{tested[p]!.ok ? `✓ ${NAMES[p]} can be used` : tested[p]!.detail}.</p>{/if}
          {#if p === 'runpod' && runpodKey}
            <ul class="set-rows inner"><KeyRow {api} k={runpodKey} elsewhere={runpodKey.elsewhere} removable={false} onchange={keyChanged} {onbusy} /></ul>
          {:else if p === 'aws'}
            <p class="muted">Uses the AWS credentials on this computer.</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if adding}
    <form class="add" aria-label="Add a cloud GPU provider" onsubmit={(e) => { e.preventDefault(); add(); }}>
      <div class="choices" role="radiogroup" aria-label="Provider">
        {#each addable as p (p)}
          <label class="choice" class:on={adding === p}><input type="radio" name="provider" checked={adding === p} onchange={() => (adding = p)} />{NAMES[p]}
            <span class="muted">{price(p)}</span></label>
        {/each}
      </div>
      {#if adding === 'runpod'}
        {#if needsKey}
          <div class="field">
            <input type="password" bind:value={draft} placeholder="Paste your RunPod API key" aria-label="RunPod API key" autocomplete="off" spellcheck="false" use:focus />
            <button type="button" class="link" onclick={() => openExternal('https://console.runpod.io/user/settings')}>Get one at console.runpod.io</button>
          </div>
        {:else}<p class="muted">Uses the RunPod key {runpodKey?.stored ? 'saved in the keychain' : `found in ${runpodKey?.elsewhere}`}.</p>{/if}
      {:else}
        <p class="muted">Uses the AWS credentials on this computer, through SkyPilot.</p>
      {/if}
      <div class="buttons">
        <button type="submit" class="primary" disabled={!!busy || (needsKey && !draft.trim())}>Add {NAMES[adding]}</button>
        <button type="button" onclick={() => (adding = null)} disabled={!!busy}>Cancel</button>
      </div>
    </form>
  {/if}

  <div class="status" aria-live="polite">
    {#if busy}<p class="muted">{busy}</p>{/if}
    {#if error}<p class="error">{error}</p>{/if}
  </div>
</section>

<style>
  .provider { display: grid; gap: 6px; }
  .head { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
  .head .muted { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .provider p { margin: 0; font-size: 12px; }
  .ok { color: var(--color-primary); }
  .inner > :global(li) { padding: 0; }
  .add { display: grid; gap: 10px; padding: 12px 14px; border: 1px solid var(--color-border-strong); border-radius: 8px; background: var(--color-bg-surface); }
  .add p { margin: 0; }
  .choices { display: flex; gap: 6px; flex-wrap: wrap; }
  .choice { display: inline-flex; gap: 8px; align-items: baseline; padding: 5px 12px; border: 1px solid var(--color-border-strong); border-radius: 6px; cursor: pointer; }
  .choice.on { border-color: var(--color-primary); background: var(--color-primary-light); }
  .choice input { position: absolute; opacity: 0; pointer-events: none; }
  .choice:has(input:focus-visible) { outline: 2px solid var(--color-info); outline-offset: 1px; }
  .field { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .field input { flex: 1 1 18rem; min-width: 0; }
  .buttons { display: flex; gap: 6px; }
  .status:empty { display: none; }
  .status p { margin: 0; }
</style>
