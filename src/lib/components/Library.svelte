<script lang="ts">
  // Imported bundles. Import a bundle folder (checked against its manifest's checksums and copied into the app),
  // locate its video (checked by sha256; bundles never contain video), and open it. Listed again each time the page is
  // shown: a run on Extract imports its bundle here.
  import { open } from '@tauri-apps/plugin-dialog';
  import { api } from '../source';
  import type { BundleSummary, LicenceMode } from '../types';

  let { onopen, onextract, active = true }: { onopen: (id: string) => void; onextract: () => void; active?: boolean } = $props();

  let bundles = $state<BundleSummary[]>([]);
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);

  async function refresh() { bundles = await api.list(); }
  $effect(() => { if (active) refresh().catch((e) => (error = String(e))); });

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

<div class="library">
  <header>
    <div class="title">
      <h1 class="page-title">Annotator</h1>
      <p class="page-lead">Open a bundle to review and correct what the pipeline found.</p>
    </div>
    <button onclick={onextract} disabled={!!busy}>Extract from a video…</button>
    <button class="primary" onclick={importBundle} disabled={!!busy}>Import bundle…</button>
  </header>
  {#if busy}<p class="muted status">{busy}</p>{/if}
  {#if error}<p class="error status">{error}</p>{/if}

  {#if !bundles.length && !busy}
    <div class="empty">
      <p>No bundles yet. Extract one from a video, or import a bundle folder.</p>
      <p class="muted">A bundle is a folder with a <code>manifest.json</code>, made by the hyperstudy-perception pipeline. Importing copies it into the app; the video stays where it is.</p>
      <button class="primary" onclick={onextract}>Extract from a video…</button>
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
  .library { max-width: 980px; padding: 0 20px 40px; }
  header { display: flex; align-items: flex-end; gap: 8px; padding: 28px 0 20px; }
  .title { flex: 1; min-width: 0; }
  .status { margin: 0 0 12px; }
  ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
  li { border: 1px solid var(--color-border-default); border-radius: 8px; padding: 12px 14px; background: var(--color-bg-surface);
       display: grid; grid-template-columns: 1fr auto; grid-template-rows: auto auto; column-gap: 12px; }
  .title { font-weight: 600; }
  .meta { grid-row: 2; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .actions { grid-row: 1 / 3; grid-column: 2; display: flex; gap: 8px; align-items: center; }
  .licence.academic-only { color: var(--color-caution); }
  .licence.commercial-ok { color: var(--color-primary); }
  .empty { border: 1px dashed var(--color-border-strong); border-radius: 8px; padding: 24px; text-align: center; display: grid; justify-items: center; gap: 4px; }
  .empty p { margin: 0; }
  .empty button { margin-top: 10px; }
  code { font-size: 12px; }
</style>
