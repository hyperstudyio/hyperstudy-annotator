<script lang="ts">
  // The bundle's name and contents, the correction count, Undo, Import and Export. Offers to import the annotator
  // prototype's corrections file when one sits next to the bundle.
  import { useSession, useSource } from '../model/context';
  import { ImportError, RunUnknownError, type Op } from '../model/corrections';
  import { plural } from '../model/session.svelte';
  import type { FoundFile } from '../source';
  import type { LicenceMode } from '../types';

  let { onback }: { onback?: () => void } = $props();
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
    s.toast(`Imported ${plural(ops.length, 'correction')} from ${from}`);
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
  async function exportFile() {
    try { if (await source.saveCorrectionsFile('perception_corrections.json', s.exportCorrections())) s.toast(`Exported ${plural(s.ops.length, 'correction')}`); }
    catch (e) { s.toast(`Could not save: ${e}`); }
  }
  const ORDER: LicenceMode[] = ['commercial-ok', 'api-terms', 'needs-review', 'academic-only'];
  const strictest = $derived(Object.values(b.manifest.layers).map((l) => l.licence_mode).reduce<LicenceMode | null>((a, m) => (!a || ORDER.indexOf(m) > ORDER.indexOf(a) ? m : a), null));
  const sub = $derived(`${plural(b.shots.length, 'shot')} · ${plural(b.utterances.length, 'utterance')} · ${plural(b.faces.length, 'face track')} · ${plural(b.sounds.length, 'sound event')}`);
  const sources = $derived(Object.entries(b.manifest.layers).map(([k, l]) => `${k}: ${l.stage} (${l.licence_mode})`).join('\n'));
</script>

<header>
  {#if onback}<button onclick={onback} title="Back to the library">Library</button>{/if}
  <h1>{source.title}</h1>
  <span class="sub" title={sources}>{sub}</span>
  {#if strictest}<span class="licence {strictest}" title="Most restrictive licence mode among this bundle's layers">{strictest}</span>{/if}
  <span class="count">{plural(s.ops.length, 'correction')}</span>
  <button disabled={!s.ops.length} onclick={() => s.undo()} title="Undo the last change (Cmd+Z)">Undo</button>
  <button onclick={importFile} title="Import a corrections file (from this app or the annotator prototype)">Import</button>
  <button class="primary" onclick={exportFile}>Export corrections</button>
</header>
{#if pending}
  <div class="banner">
    Importing replaces your {plural(s.ops.length, 'correction')} with {plural(pending.ops.length, 'correction')} from {pending.from}.
    <button class="primary" onclick={() => pending && apply(pending.ops, pending.from)}>Replace</button>
    <button onclick={() => (pending = null)}>Cancel</button>
  </div>
{:else if ask && (ask.from !== 'the prototype' || (!s.ops.length && !dismissed))}
  <!-- a file the user picked is asked about at once; one found next to the bundle, like its import offer, only while
       the log is empty -->
  <div class="banner">
    Corrections from {ask.from} do not say which run of this video they were made on, and the library has {ask.runs} runs of it.
    Were they made on this one? Their ids name this run's faces only if they were.
    <button class="primary" onclick={importAsThisRun}>Yes, import them here</button>
    <button onclick={() => { if (ask?.from === 'the prototype') dismissed = true; ask = null; }}>Cancel</button>
  </div>
{:else if found && !dismissed && !s.ops.length}
  <div class="banner">
    The annotator prototype's corrections for this video are next to the bundle ({plural(found.ops.length, 'correction')}, <code>{found.path.split('/').slice(-2).join('/')}</code>). Import them?
    <button class="primary" onclick={() => found && apply(found.ops, 'the prototype')}>Import</button>
    <button onclick={() => (dismissed = true)}>Not now</button>
  </div>
{:else if foundError && !dismissed}
  <div class="banner error-banner">A corrections file next to this bundle cannot be imported: {foundError} <button onclick={() => (dismissed = true)}>Dismiss</button></div>
{/if}

<style>
  header { display: flex; align-items: center; gap: 12px; padding: 8px 16px; background: var(--color-bg-surface); border-bottom: 1px solid var(--color-border-default); min-width: 0; }
  h1 { font-size: 15px; margin: 0; font-weight: 600; white-space: nowrap; }
  .sub { color: var(--color-text-muted); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .count { color: var(--color-text-secondary); white-space: nowrap; }
  .licence { font-size: 11px; padding: 1px 8px; border-radius: 10px; border: 1px solid var(--color-border-strong); white-space: nowrap; }
  .licence.academic-only { color: var(--color-caution); border-color: var(--color-caution); }
  .licence.commercial-ok { color: var(--color-primary); border-color: var(--color-primary); }
  .banner { display: flex; align-items: center; gap: 10px; padding: 6px 16px; background: var(--color-primary-light); border-bottom: 1px solid var(--color-border-default); flex-wrap: wrap; }
  .error-banner { background: var(--color-caution-light); }
  code { font-size: 12px; }
</style>
