<script lang="ts">
  // The Annotator page: the viewer, the whole width. Shown, it opens the video last opened here (else the newest), so
  // the page is the annotator itself, not a list to get through first. The video's name in the header is the switcher
  // between videos: it lists them, imports one (a bundle, checked against its manifest's checksums and copied into the
  // app) and locates a video that has moved (checked by sha256; bundles never contain video). Listed again each time
  // the page is shown: a run on Extract imports its bundle here.
  import Viewer from './Viewer.svelte';
  import Popover from './ui/Popover.svelte';
  import { LICENCE_TEXT, lastOpened, rememberOpened, strictest, type LibraryApi } from '../library';
  import type { BundleSource } from '../source';
  import type { BundleSummary } from '../types';

  let { library, active = true, request = null, onrequested, onextract, onmodal }: {
    library: LibraryApi; active?: boolean;
    /** a bundle to open (Extract's Open in Annotator), then `onrequested` once it is */
    request?: string | null; onrequested?: () => void;
    onextract: () => void; onmodal?: (open: boolean) => void;
  } = $props();

  let bundles = $state<BundleSummary[] | null>(null);   // null: not listed yet
  let current = $state<string | null>(null);
  let source = $state<BundleSource | null>(null);
  let opening = $state<string | null>(null);   // why the viewer is empty: a bundle could not be opened
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  let filter = $state('');

  const shown = $derived(bundles?.filter((b) => b.title.toLowerCase().includes(filter.trim().toLowerCase())) ?? []);
  const currentBundle = $derived(bundles?.find((b) => b.id === current) ?? null);

  async function open(b: BundleSummary) {
    current = b.id; opening = null; source = null;
    rememberOpened(b.id);
    if (!b.video_path) { opening = 'no video'; return; }   // asked for first: the viewer is the video
    try { const s = await library.open(b); if (current === b.id) source = s; }
    catch (e) { if (current === b.id) opening = String(e); }
  }
  async function refresh() {
    bundles = await library.list();
    const want = request ?? (current && bundles.some((b) => b.id === current) ? null : lastOpened());
    const b = bundles.find((x) => x.id === want) ?? (current ? null : bundles[0]);
    if (b && b.id !== current) await open(b);
    if (request) onrequested?.();
  }
  $effect(() => { if (active || request) refresh().catch((e) => (error = String(e))); });

  async function run(label: string, f: () => Promise<BundleSummary | null>) {
    busy = label; error = null;
    try {
      const b = await f();
      if (!b) return;
      bundles = await library.list();
      await open(bundles.find((x) => x.id === b.id) ?? b);   // what was imported or found is what you want to see
    } catch (e) { error = String(e); } finally { busy = null; }
  }
  const importBundle = () => run('Importing…', () => library.importBundle());
  $effect(() => { window.addEventListener('app:import', importBundle); return () => window.removeEventListener('app:import', importBundle); });   // File > Import…
  const locate = (b: BundleSummary) => run('Checking the video…', () => library.locateVideo(b));
  const caution = (b: BundleSummary) => { const l = strictest(b); return l === 'academic-only' || l === 'needs-review' ? LICENCE_TEXT[l] : null; };
</script>

{#snippet switcher()}
  <Popover label={`Switch video, now ${currentBundle?.title ?? ''}`} width={320} buttonClass="video-switch">
    {#snippet button()}<span class="title">{currentBundle?.title ?? 'Videos'}</span>{/snippet}
    {#snippet children(close)}
      {#if (bundles?.length ?? 0) > 6}<input class="filter" type="search" bind:value={filter} placeholder="Find a video" aria-label="Find a video" />{/if}
      <ul class="videos" aria-label="Videos">
        {#each shown as b (b.id)}
          <li>
            <button class="menu-item" aria-current={b.id === current ? 'true' : undefined} onclick={() => { close(); open(b); }}>
              <span class="tick" aria-hidden="true">{b.id === current ? '✓' : ''}</span>
              <span class="grow">{b.title}</span>
              {#if !b.video_path}<span class="warn">No video</span>{:else if caution(b)}<span class="note">{caution(b)}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
      <div class="menu-sep"></div>
      <button class="menu-item" onclick={() => { close(); importBundle(); }} disabled={!!busy}><span class="tick"></span>Import…</button>
      <button class="menu-item" onclick={() => { close(); onextract(); }}><span class="tick"></span>Extract from a video…</button>
    {/snippet}
  </Popover>
{/snippet}

<div class="annotator">
  {#if busy || error}
    <div class="status" aria-live="polite">{#if busy}<span class="muted">{busy}</span>{/if}{#if error}<span class="error">{error}</span> <button class="link" onclick={() => (error = null)}>Dismiss</button>{/if}</div>
  {/if}
  {#if source}
    {#key source}
      <Viewer {source} {active} {onmodal} title={switcher} />
    {/key}
  {:else}
    {#if currentBundle}<div class="bar">{@render switcher()}</div>{/if}
    <div class="empty">
      {#if bundles && !bundles.length}
        <p>Nothing to annotate yet.</p>
        <div class="row">
          <button class="primary" onclick={onextract}>Extract from a video…</button>
          <button onclick={importBundle} disabled={!!busy}>Import…</button>
        </div>
      {:else if opening && currentBundle}
        {#if !currentBundle.video_path}
          <p>{currentBundle.title} needs its video.</p>
          <button class="primary" onclick={() => locate(currentBundle)} disabled={!!busy}>Locate video…</button>
        {:else}
          <p class="error">{opening}</p>
          <button onclick={() => locate(currentBundle)} disabled={!!busy}>Locate the video again…</button>
        {/if}
      {:else if currentBundle}
        <p class="muted">Opening {currentBundle.title}…</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .annotator { height: 100%; display: flex; flex-direction: column; min-width: 0; }
  .annotator > :global(*:last-child) { flex: 1; min-height: 0; }
  .status { display: flex; gap: 10px; align-items: center; padding: 6px 16px; font-size: 12px; border-bottom: 1px solid var(--color-border-default); }
  .bar { padding: 8px 16px; background: var(--color-bg-surface); border-bottom: 1px solid var(--color-border-default); }
  /* the video's name, as the header's title: a menu that does not look like a button until you point at it */
  :global(button.video-switch) { background: none; border-color: transparent; padding: 2px 6px; margin-left: -6px; }
  :global(button.video-switch:hover:not(:disabled)) { background: var(--color-bg-hover); }
  .title { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .filter { width: calc(100% - 8px); margin: 4px; }
  .videos { list-style: none; margin: 0; padding: 0; }
  .tick { width: 12px; flex: none; color: var(--color-primary); }
  .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .warn { font-size: 12px; color: var(--color-caution); white-space: nowrap; }
  .note { font-size: 12px; color: var(--color-text-muted); white-space: nowrap; }
  .empty { display: grid; place-content: center; justify-items: center; gap: 12px; padding: 24px; text-align: center; }
  .empty p { margin: 0; max-width: 48ch; }
  .row { display: flex; gap: 8px; }
</style>
