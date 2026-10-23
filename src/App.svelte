<script lang="ts">
  // In the desktop app: the library, then a bundle in the viewer.
  // In a browser (development and testing): ?bundle=<URL of a bundle folder>&video=<URL of its video> opens that
  // bundle straight in the viewer; vite serves /devdata from a local http-server (see README).
  import Library from './lib/components/Library.svelte';
  import Viewer from './lib/components/Viewer.svelte';
  import { httpSource, inTauri, tauriSource, type BundleSource } from './lib/source';

  let source = $state<BundleSource | null>(null);
  let error = $state<string | null>(null);
  const desktop = inTauri();

  if (!desktop) {
    const q = new URLSearchParams(location.search);
    const bundle = q.get('bundle');
    if (bundle) httpSource(bundle, q.get('video')).then((s) => (source = s)).catch((e) => (error = String(e)));
  }

  async function openBundle(id: string) {
    error = null;
    try { source = await tauriSource(id); } catch (e) { error = String(e); }
  }
</script>

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
