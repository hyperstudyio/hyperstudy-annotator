<script lang="ts">
  // The Annotator page: the viewer, with the bundles in a drawer beside it. Shown, it opens the bundle last opened here
  // (else the newest), so the page is the annotator itself, not a list to get through first. The drawer filters the
  // bundles, imports one (checked against its manifest's checksums and copied into the app), and locates a bundle's
  // video (checked by sha256; bundles never contain video). Listed again each time the page is shown: a run on Extract
  // imports its bundle here.
  import Viewer from './Viewer.svelte';
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
  let drawer = $state(true);
  let modal = $state(false);   // the viewer waits on a dialog: the drawer is out of reach, as the rail is

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
  const locate = (b: BundleSummary) => run('Checking the video…', () => library.locateVideo(b));
  const layers = (b: BundleSummary) => { const n = Object.keys(b.layers).length; return `${n} ${n === 1 ? 'layer' : 'layers'}`; };
  const caution = (b: BundleSummary) => { const l = strictest(b); return l === 'academic-only' || l === 'needs-review' ? LICENCE_TEXT[l] : null; };
</script>

<div class="annotator" class:closed={!drawer}>
  <aside class="drawer" aria-label="Bundles" inert={modal}>
    {#if drawer}
      <div class="head">
        <h2>Bundles{#if bundles?.length}<span class="count">{bundles.length}</span>{/if}</h2>
        <button class="icon" onclick={() => (drawer = false)} aria-label="Hide the bundles" title="Hide the bundles">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3 5 8l5 5" /></svg>
        </button>
      </div>
      {#if bundles?.length}   <!-- with none, the page itself offers the ways to get one -->
        <div class="tools">
          <button onclick={importBundle} disabled={!!busy}>Import bundle…</button>
          {#if bundles.length > 6}<input type="search" bind:value={filter} placeholder="Filter" aria-label="Filter the bundles" />{/if}
        </div>
      {/if}
      <div class="status" aria-live="polite">
        {#if busy}<p class="muted">{busy}</p>{/if}
        {#if error}<p class="error">{error}</p>{/if}
      </div>
      <ul aria-label="Bundles">
        {#each shown as b (b.id)}
          <li aria-label={b.title} class:on={b.id === current}>
            <button class="open" onclick={() => open(b)} aria-current={b.id === current ? 'true' : undefined} aria-label={`Open ${b.title}`}>
              <span class="name">{b.title}</span>
              <span class="meta">{layers(b)}{b.corrections ? `, ${b.corrections} corrected` : ''}</span>
              {#if !b.video_path}<span class="warn">No video</span>{:else if caution(b)}<span class="warn">{caution(b)}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <button class="icon reopen" onclick={() => (drawer = true)} aria-label="Show the bundles" title="Show the bundles">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
      </button>
    {/if}
  </aside>

  <main class="stage">
    {#if source}
      {#key source}
        <Viewer {source} {active} onmodal={(m) => { modal = m; onmodal?.(m); }} />
      {/key}
    {:else if bundles && !bundles.length}
      <div class="empty">
        <p>No bundles yet.</p>
        <div class="row">
          <button class="primary" onclick={onextract}>Extract from a video…</button>
          <button onclick={importBundle} disabled={!!busy}>Import bundle…</button>
        </div>
      </div>
    {:else if opening && currentBundle}
      <div class="empty">
        {#if !currentBundle.video_path}
          <p>{currentBundle.title} needs its video.</p>
          <button class="primary" onclick={() => locate(currentBundle)} disabled={!!busy}>Locate video…</button>
        {:else}
          <p class="error">{opening}</p>
          <button onclick={() => locate(currentBundle)} disabled={!!busy}>Locate the video again…</button>
        {/if}
      </div>
    {:else if currentBundle}
      <div class="empty"><p class="muted">Opening {currentBundle.title}…</p></div>
    {/if}
  </main>
</div>

<style>
  .annotator { height: 100%; display: grid; grid-template-columns: 240px minmax(0, 1fr); min-width: 0; }
  .annotator.closed { grid-template-columns: 32px minmax(0, 1fr); }
  .drawer { min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--color-border-default); background: var(--color-bg-base); }
  .head { display: flex; align-items: center; justify-content: space-between; padding: 14px 10px 8px 14px; }
  h2 { margin: 0; font-size: 13px; font-weight: 600; display: flex; gap: 8px; align-items: baseline; }
  .count { font-size: 11px; font-weight: 400; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
  .icon { background: none; border: 0; padding: 4px; border-radius: 4px; color: var(--color-text-muted); display: grid; place-items: center; }
  .icon:hover:not(:disabled) { color: var(--color-text-primary); }
  .icon svg { fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .reopen { margin: 12px auto 0; }
  .tools { display: grid; gap: 8px; padding: 0 12px 10px; }
  .tools button { justify-self: start; }
  .status:empty { display: none; }
  .status { padding: 0 14px 8px; font-size: 12px; }
  .status p { margin: 0; }
  ul { list-style: none; margin: 0; padding: 0 6px 12px; overflow: auto; flex: 1; }
  .open { width: 100%; display: grid; gap: 1px; text-align: left; background: none; border: 0; border-radius: 6px; padding: 8px 8px 9px; }
  .open:hover:not(:disabled) { background: var(--color-bg-surface); }
  .open:focus-visible { outline: 2px solid var(--color-info); outline-offset: -2px; }
  li.on .open { background: var(--color-bg-elevated); box-shadow: inset 2px 0 0 var(--color-primary); }
  .name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta, .warn { font-size: 11.5px; color: var(--color-text-muted); }
  .warn { color: var(--color-caution); }

  .stage { min-width: 0; min-height: 0; position: relative; }
  .empty { height: 100%; display: grid; place-content: center; justify-items: center; gap: 12px; padding: 24px; text-align: center; }
  .empty p { margin: 0; max-width: 48ch; }
  .row { display: flex; gap: 8px; }
</style>
