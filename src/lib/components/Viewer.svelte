<script lang="ts">
  // Loads a bundle and its corrections, then shows the workspace.
  import { Bundle } from '../model/bundle';
  import { Session } from '../model/session.svelte';
  import type { BundleSource } from '../source';
  import Workspace from './Workspace.svelte';

  let { source, onback }: { source: BundleSource; onback?: () => void } = $props();
  let session = $state<Session | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    const src = source;
    session = null; error = null;
    Bundle.load(src).then(async (bundle) => {
      const s = new Session(bundle, src.corrections);
      s.asset = src.assetUrl;
      await s.load();
      if (src === source) session = s;
    }).catch((e) => { error = String(e); });
  });
</script>

{#if session}
  <Workspace {session} {source} {onback} />
{:else}
  <div class="loading">
    {#if error}<p class="error">{error}</p>{#if onback}<button onclick={onback}>Back to the library</button>{/if}
    {:else}<p class="muted">Loading {source.title}…</p>{/if}
  </div>
{/if}

<style>
  .loading { padding: 24px; }
</style>
