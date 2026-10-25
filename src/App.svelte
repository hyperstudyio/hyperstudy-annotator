<script lang="ts">
  // In the desktop app: the library, then a bundle in the viewer.
  // In a browser (development and testing): ?bundle=<URL of a bundle folder>&video=<URL of its video> opens that
  // bundle straight in the viewer; vite serves /devdata from a local http-server (see README). &previous=<URL of an
  // earlier bundle of the same video> opens it as a re-run, offering the earlier bundle's corrections.
  import Library from './lib/components/Library.svelte';
  import Viewer from './lib/components/Viewer.svelte';
  import { httpSource, inTauri, tauriSource, type BundleSource } from './lib/source';
  import PipelineDialog from './lib/components/PipelineDialog.svelte';
  import type { PipelineApi } from './lib/pipeline';

  let source = $state<BundleSource | null>(null);
  let error = $state<string | null>(null);
  const desktop = inTauri();
  // browser mode's ?pipeline-demo: the Run pipeline dialog against a scripted stand-in (Tauri is absent here)
  let demo = $state<PipelineApi | null>(null);

  if (!desktop) {
    const q = new URLSearchParams(location.search);
    const bundle = q.get('bundle');
    if (q.has('pipeline-demo')) import('./lib/pipeline.fake').then((m) => (demo = m.fakePipeline(400, { rejectRun: q.get('pipeline-demo') === 'reject-run', slowStart: q.get('pipeline-demo') === 'slow-start', noNeeds: q.get('pipeline-demo') === 'no-needs', oldCli: q.get('pipeline-demo') === 'old-cli', twoPlaces: q.get('pipeline-demo') === 'two-places', summary: q.get('pipeline-demo') === 'summary', remote: q.get('pipeline-demo') === 'remote', machinesError: q.get('pipeline-demo') === 'machines-error' },
      // what each demo run was given (its consent, places and spending cap), for the browser tests
      ((window as unknown as { __pipelineRuns: unknown[] }).__pipelineRuns = []))));
    if (bundle) httpSource(bundle, q.get('video'), q.get('previous')).then((s) => (source = s)).catch((e) => (error = String(e)));
  }

  async function openBundle(id: string) {
    error = null;
    try { source = await tauriSource(id); } catch (e) { error = String(e); }
  }
</script>

{#if demo}
  <PipelineDialog api={demo} onclose={() => (demo = null)} onopen={(id) => (error = `would open ${id}`)} />
{/if}
{#if source}
  <Viewer {source} onback={desktop ? () => (source = null) : undefined} />
{:else if desktop}
  {#if error}<p class="error" style="padding: 0 20px">{error}</p>{/if}
  <Library onopen={openBundle} />
{:else}
  <div style="padding: 24px; max-width: 720px">
    <h1 style="font-size: 18px">HyperStudy Annotator (browser mode)</h1>
    {#if error}<p class="error">{error}</p>{/if}
    <p class="muted">Open a bundle with <code>?bundle=&lt;bundle folder URL&gt;&amp;video=&lt;video URL&gt;</code>. The desktop app imports bundles from disk instead.</p>
  </div>
{/if}
