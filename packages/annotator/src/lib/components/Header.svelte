<script lang="ts">
  // The video's name (the app's switcher between videos, when it gives one) and Export, which saves the annotated
  // result: the pipeline's layers with your edits applied. Everything else about the video is the Details tab. Imports
  // edits from a file when asked (the switcher's Import edits…, File > Import Edits…: app:import-edits), and offers to import the annotator prototype's edits
  // when its file sits next to the bundle; the questions an import can raise are asked here, under the header.
  // In the interface the bundle is the video's annotation, and the op log is its edits.
  import { useSession, useSource } from '../model/context';
  import { ImportError, RunUnknownError, type Op } from '../model/corrections';
  import { plural } from '../model/session.svelte';
  import { annotated, serialiseAnnotated } from '../model/annotated';
  import type { FoundFile } from '../source';

  import type { Snippet } from 'svelte';
  let { onback, title }: { onback?: () => void; title?: Snippet } = $props();
  const s = useSession(), source = useSource();
  const b = $derived(s.bundle);
  let found = $state<(FoundFile & { ops: Op[] }) | null>(null);
  let foundError = $state<string | null>(null);
  let pending = $state<{ ops: Op[]; from: string } | null>(null);   // an import waiting for "replace" (the log is not empty)
  let dismissed = $state(false);
  // a file that does not say which run it was made on, on a video with several runs: asked before importing
  let ask = $state<{ text: string; from: string; runs: number } | null>(null);

  $effect(() => {
    source.findPrototypeCorrections().then(async (f) => {
      if (!f) return;
      try { found = { ...f, ops: await s.parseCorrections(f.text, source.lineage) }; }
      catch (e) {
        if (e instanceof RunUnknownError) ask = { text: f.text, from: 'the prototype', runs: e.runs };
        else foundError = `${f.path}: ${e instanceof ImportError ? e.message : String(e)}`;
      }
    }).catch((e) => { foundError = String(e); });
  });

  async function apply(ops: Op[], from: string) {
    if (s.ops.length && !pending) { pending = { ops, from }; return; }
    pending = null;
    await s.replaceCorrections(ops);
    dismissed = true;
    s.toast(`Imported ${plural(ops.length, 'edit')} from ${from}`);
  }
  async function importFile() {
    try {
      const text = await source.pickCorrectionsFile();
      if (text === null) return;
      try { await apply(await s.parseCorrections(text, source.lineage), 'the file'); }
      catch (e) { if (e instanceof RunUnknownError) ask = { text, from: 'the file', runs: e.runs }; else throw e; }
    } catch (e) { s.toast(e instanceof ImportError ? `Not imported: ${e.message}` : `Could not read that file: ${e}`); }
  }
  async function importAsThisRun() {
    const a = ask!;
    ask = null;
    try { await apply(await s.parseCorrections(a.text, source.lineage, undefined, { thisRun: true }), a.from); }
    catch (e) { s.toast(e instanceof ImportError ? `Not imported: ${e.message}` : `Could not read that file: ${e}`); }
  }
  // the annotated result: the pipeline's layers with the edits applied, and the edits themselves (annotated.ts)
  async function exportFile() {
    try { if (await source.saveCorrectionsFile(`${source.title}.annotated.json`, serialiseAnnotated(annotated(s, { title: source.title })))) s.toast(`Exported ${source.title}`); }
    catch (e) { s.toast(`Could not save: ${e}`); }
  }
  $effect(() => { window.addEventListener('app:import-edits', importFile); return () => window.removeEventListener('app:import-edits', importFile); });
  $effect(() => { window.addEventListener('app:export', exportFile); return () => window.removeEventListener('app:export', exportFile); });   // File > Export…
</script>

<header>
  {#if onback}<button onclick={onback}>All videos</button>{/if}
  {#if title}{@render title()}{:else}<h1>{source.title}</h1>{/if}
  <span class="gap"></span>
  <button class="primary" onclick={exportFile} title="Save this video's annotations, with your edits applied, to a file">Export…</button>
</header>
{#if pending}
  <div class="banner">
    Importing replaces your {plural(s.ops.length, 'edit')} with {plural(pending.ops.length, 'edit')} from {pending.from}.
    <button class="primary" onclick={() => pending && apply(pending.ops, pending.from)}>Replace</button>
    <button onclick={() => (pending = null)}>Cancel</button>
  </div>
{:else if ask && (ask.from !== 'the prototype' || (!s.ops.length && !dismissed))}
  <!-- a file the user picked is asked about at once; one found next to the bundle, like its import offer, only while
       the log is empty -->
  <div class="banner">
    The edits from {ask.from} do not say which of this video's {ask.runs} runs they were made on. Were they made on this one?
    <button class="primary" onclick={importAsThisRun}>Yes, import them here</button>
    <button onclick={() => { if (ask?.from === 'the prototype') dismissed = true; ask = null; }}>Cancel</button>
  </div>
{:else if found && !dismissed && !s.ops.length}
  <div class="banner">
    <span title={found.path}>{plural(found.ops.length, 'edit')} from the annotator prototype are next to this video.</span>
    <button class="primary" onclick={() => found && apply(found.ops, 'the prototype')}>Import</button>
    <button onclick={() => (dismissed = true)}>Not now</button>
  </div>
{:else if foundError && !dismissed}
  <div class="banner error-banner">An edits file next to this video cannot be imported: {foundError} <button onclick={() => (dismissed = true)}>Dismiss</button></div>
{/if}

<style>
  header { display: flex; align-items: center; gap: 12px; padding: 8px 16px; background: var(--color-bg-surface); border-bottom: 1px solid var(--color-border-default); min-width: 0; }
  h1 { font-size: 15px; margin: 0; font-weight: 600; white-space: nowrap; }
  .gap { flex: 1; }
  .banner { display: flex; align-items: center; gap: 10px; padding: 6px 16px; background: var(--color-primary-light); border-bottom: 1px solid var(--color-border-default); flex-wrap: wrap; }
  .error-banner { background: var(--color-caution-light); }
</style>
