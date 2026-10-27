<script lang="ts">
  // Imported bundles. Import a bundle folder (checked against its manifest's checksums and copied into the app),
  // locate its video (checked by sha256; bundles never contain video), and open it. Listed again each time the page is
  // shown: a run on Extract imports its bundle here. With none yet, the page offers the two ways to get one.
  import { LICENCE_TEXT, strictest, type LibraryApi } from '../library';
  import type { BundleSummary } from '../types';

  let { library, onopen, onextract, active = true }: { library: LibraryApi; onopen: (id: string) => void; onextract: () => void; active?: boolean } = $props();

  let bundles = $state<BundleSummary[] | null>(null);   // null: not listed yet
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);

  async function refresh() { bundles = await library.list(); }
  $effect(() => { if (active) refresh().catch((e) => (error = String(e))); });

  async function run(label: string, f: () => Promise<unknown>) {
    busy = label; error = null;
    try { if (await f()) await refresh(); } catch (e) { error = String(e); } finally { busy = null; }
  }
  const importBundle = () => run('Checking and importing the bundle…', () => library.importBundle());
  const locate = (b: BundleSummary) => run('Checking the video’s checksum…', () => library.locateVideo(b));

  const layers = (b: BundleSummary) => { const n = Object.keys(b.layers).length; return `${n} ${n === 1 ? 'layer' : 'layers'}`; };
  const corrections = (b: BundleSummary) => b.corrections ? `, ${b.corrections} ${b.corrections === 1 ? 'correction' : 'corrections'}` : '';
  const home = (p: string) => p.replace(/^\/Users\/[^/]+/, '~');
</script>

<div class="library">
  <header>
    <div class="title">
      <h1 class="page-title">Annotator</h1>
      <p class="page-lead">Open a bundle to review and correct what the pipeline found.</p>
    </div>
    {#if bundles?.length}
      <button onclick={onextract} disabled={!!busy}>Extract from a video…</button>
      <button onclick={importBundle} disabled={!!busy}>Import bundle…</button>
    {/if}
  </header>
  <div class="status" aria-live="polite">
    {#if busy}<p class="muted">{busy}</p>{/if}
    {#if error}<p class="error">{error}</p>{/if}
  </div>

  {#if bundles && !bundles.length}
    <section class="start" aria-label="No bundles yet">
      <h2>No bundles yet</h2>
      <div class="ways">
        <div class="way">
          <h3>Extract from a video</h3>
          <p class="muted">Run the pipeline on a video, on this computer or a machine you choose. The bundle it makes lands here.</p>
          <button class="primary" onclick={onextract} disabled={!!busy}>Extract from a video…</button>
        </div>
        <div class="way">
          <h3>Import a bundle</h3>
          <p class="muted">Add a bundle folder made on another computer. It is checked and copied into the app; its video stays where it is.</p>
          <button onclick={importBundle} disabled={!!busy}>Import bundle…</button>
        </div>
      </div>
    </section>
  {:else if bundles}
    <ul aria-label="Bundles">
      {#each bundles as b (b.id)}
        {@const licence = strictest(b)}
        <li aria-label={b.title}>
          <button class="open" onclick={() => onopen(b.id)} disabled={!!busy} aria-label={`Open ${b.title}`}>
            <span class="name">{b.title}</span>
            <span class="meta">{layers(b)}{corrections(b)}. <span class="licence {licence}">{LICENCE_TEXT[licence]}</span></span>
            <span class="video" class:missing={!b.video_path}>{b.video_path ? home(b.video_path) : 'Video not found yet: locate it to play the bundle'}</span>
          </button>
          <div class="actions">
            {#if b.video_path}<button class="quiet" onclick={() => locate(b)} disabled={!!busy} aria-label={`Change the video for ${b.title}`}>Change video…</button>
            {:else}<button onclick={() => locate(b)} disabled={!!busy} aria-label={`Locate the video for ${b.title}`}>Locate video…</button>{/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .library { max-width: 980px; padding: 0 24px 40px; }
  header { display: flex; align-items: flex-end; gap: 8px; padding: 28px 0 20px; }
  .title { flex: 1; min-width: 0; }
  .status:empty { display: none; }
  .status p { margin: 0 0 12px; }

  ul { list-style: none; padding: 0; margin: 0; border-top: 1px solid var(--color-border-default); }
  li { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; border-bottom: 1px solid var(--color-border-default); }
  /* the whole bundle is what opens it */
  .open { display: grid; gap: 2px; text-align: left; background: none; border: 0; border-radius: 0; padding: 12px 10px; min-width: 0; }
  .open:hover:not(:disabled) { background: var(--color-bg-surface); }
  .open:hover:not(:disabled) .name { text-decoration: underline; text-decoration-color: var(--color-border-strong); text-underline-offset: 3px; }
  .open:focus-visible { outline: 2px solid var(--color-info); outline-offset: -2px; }
  .name { font-weight: 600; font-size: 14px; }
  .meta, .video { font-size: 12px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .video { color: var(--color-text-muted); }
  .video.missing { color: var(--color-caution); }
  .licence.academic-only, .licence.needs-review { color: var(--color-caution); }
  .actions { display: flex; gap: 8px; align-items: center; padding-right: 6px; }
  .quiet { background: none; border-color: transparent; color: var(--color-text-muted); }
  .quiet:hover:not(:disabled) { color: var(--color-text-primary); }

  .start { display: grid; gap: 14px; padding-top: 4px; }
  .start h2 { margin: 0; font-size: 15px; font-weight: 600; }
  .ways { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
  .way { display: grid; gap: 6px; align-content: start; justify-items: start; padding: 18px 20px; border-radius: 10px;
         background: var(--color-bg-surface); border: 1px solid var(--color-border-default); }
  .way h3 { margin: 0; font-size: 14px; font-weight: 600; }
  .way p { margin: 0; max-width: 46ch; }
  .way button { margin-top: 8px; }
</style>
