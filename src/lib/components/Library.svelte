<script lang="ts">
  // Imported bundles. Import a bundle folder (checked against its manifest's checksums and copied into the app),
  // locate its video (checked by sha256; bundles never contain video), and open it.
  import { open } from '@tauri-apps/plugin-dialog';
  import { api } from '../source';
  import { tauriPipeline, type PipelineApi } from '../pipeline';
  import PipelineDialog from './PipelineDialog.svelte';
  import type { BundleSummary, LicenceMode } from '../types';

  let { onopen }: { onopen: (id: string) => void } = $props();

  let bundles = $state<BundleSummary[]>([]);
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  let pipeline = $state<PipelineApi | null>(null);   // the Run pipeline dialog, while open
  const openPipeline = async () => { pipeline = await tauriPipeline(); };

  async function refresh() { bundles = await api.list(); }
  $effect(() => { refresh().catch((e) => (error = String(e))); });

  async function run(label: string, f: () => Promise<unknown>) {
    busy = label; error = null;
    try { await f(); await refresh(); } catch (e) { error = String(e); } finally { busy = null; }
  }

  async function importBundle() {
    const dir = await open({ directory: true, title: 'Choose a track bundle folder (it holds manifest.json)' });
    if (typeof dir === 'string') await run('Checking and importing the bundle…', () => api.import(dir));
  }

  async function locate(b: BundleSummary) {
    const file = await open({ title: `Locate the video for ${b.title}`, filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv'] }] });
    if (typeof file === 'string') await run('Checking the video’s checksum…', () => api.locateVideo(b.id, file));
  }

  const ORDER: LicenceMode[] = ['commercial-ok', 'api-terms', 'needs-review', 'academic-only'];
  const strictest = (b: BundleSummary) => Object.values(b.layers).reduce((a, m) => (ORDER.indexOf(m) > ORDER.indexOf(a) ? m : a), 'commercial-ok' as LicenceMode);
</script>

{#if pipeline}
  <PipelineDialog api={pipeline} onclose={() => { pipeline = null; refresh(); }} onopen={(id) => { pipeline = null; onopen(id); }} />
{/if}
<div class="library" inert={!!pipeline}>
  <header>
    <h1>HyperStudy Annotator</h1>
    <span class="spacer"></span>
    <button onclick={openPipeline} disabled={!!busy}>Run pipeline…</button>
    <button class="primary" onclick={importBundle} disabled={!!busy}>Import bundle…</button>
  </header>
  {#if busy}<p class="muted status">{busy}</p>{/if}
  {#if error}<p class="error status">{error}</p>{/if}

  {#if !bundles.length && !busy}
    <div class="empty">
      <p>No bundles yet.</p>
      <p class="muted">A bundle is a folder with a <code>manifest.json</code>, made by the hyperstudy-perception pipeline. Importing copies it into the app; the video stays where it is.</p>
    </div>
  {:else}
    <ul>
      {#each bundles as b (b.id)}
        <li>
          <div class="title">{b.title}</div>
          <div class="muted meta">
            {Object.keys(b.layers).length} layers · schema {b.schema_version} · <span class="licence {strictest(b)}">{strictest(b)}</span>
            · {b.video_path ? b.video_path : 'video not located'}
          </div>
          <div class="actions">
            <button onclick={() => locate(b)} disabled={!!busy}>{b.video_path ? 'Change video…' : 'Locate video…'}</button>
            <button class="primary" onclick={() => onopen(b.id)} disabled={!!busy}>Open</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .library { max-width: 980px; margin: 0 auto; padding: 0 20px 40px; }
  header { display: flex; align-items: center; padding: 18px 0; }
  h1 { font-size: 18px; margin: 0; }
  .spacer { flex: 1; }
  .status { margin: 0 0 12px; }
  ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
  li { border: 1px solid var(--color-border-default); border-radius: 8px; padding: 12px 14px; background: var(--color-bg-surface);
       display: grid; grid-template-columns: 1fr auto; grid-template-rows: auto auto; column-gap: 12px; }
  .title { font-weight: 600; }
  .meta { grid-row: 2; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .actions { grid-row: 1 / 3; grid-column: 2; display: flex; gap: 8px; align-items: center; }
  .licence.academic-only { color: var(--color-caution); }
  .licence.commercial-ok { color: var(--color-primary); }
  .empty { border: 1px dashed var(--color-border-strong); border-radius: 8px; padding: 24px; text-align: center; }
  code { font-size: 12px; }
</style>
