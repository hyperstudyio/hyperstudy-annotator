<script module lang="ts">
  export type Page = 'extract' | 'annotator' | 'settings';
  /** A run on the Extract page: how far along (steps done over steps), or how it ended. */
  export type RunStatus = { state: 'running' | 'imported' | 'failed'; fraction: number };
  /** A newer version of the app: found, downloading (null fraction: no size given), or installed and waiting for the
   *  relaunch. */
  export type UpdateBadge = { state: 'available' | 'downloading' | 'ready'; version: string; fraction: number | null };
</script>

<script lang="ts">
  // The app's navigation: a slim rail down the left edge. Extract (run the pipeline on a video), Annotator (the
  // library, and a bundle open in the viewer), Settings (keys and machines), and the documentation, which opens in the
  // browser. Extract's icon carries the run: a ring that fills as its steps finish, then a dot for how it ended, so a
  // run can go on while you annotate. A newer version of the app adds an Update item, which leads to Settings; it
  // carries its download the same way.
  import { DOCS_URL, openExternal } from '../links';

  let { page, run, update = null, onnavigate, onupdate }: {
    page: Page; run: RunStatus | null; update?: UpdateBadge | null; onnavigate: (p: Page) => void; onupdate?: () => void;
  } = $props();

  const ITEMS: { key: Page; label: string; hint: string }[] = [
    { key: 'extract', label: 'Extract', hint: 'Run the pipeline on a video' },
    { key: 'annotator', label: 'Annotator', hint: 'Open a bundle to review and correct it' },
    { key: 'settings', label: 'Settings', hint: 'Keys and machines' },
  ];
  const R = 15, C = 2 * Math.PI * R;   // the run ring, around Extract's icon
  const runHint = $derived(!run ? '' : run.state === 'running' ? ` (running, ${Math.round(run.fraction * 100)}% of steps done)`
    : run.state === 'imported' ? ' (the run finished and its bundle is in the library)' : ' (the run stopped: Extract says why)');
</script>

<nav class="rail" aria-label="App">
  <svg class="mark" viewBox="0 0 32 32" width="30" height="30" role="img" aria-label="HyperStudy Annotator">
    <rect width="32" height="32" rx="8" fill="#1a1d24" />
    <g stroke-width="2.6" stroke-linecap="round">
      <path d="M7 10h7m4 0h7" stroke="var(--color-primary)" />
      <path d="M7 14.5h4m3 0h11" stroke="var(--color-info)" />
      <path d="M7 19h10m3 0h5" stroke="var(--color-caution)" />
      <path d="M7 23.5h5m4 0h6" stroke="#c084fc" />
    </g>
    <path d="M18 6v20" stroke="#fff" stroke-width="1.6" stroke-linecap="round" />
  </svg>

  <ul>
    {#each ITEMS as item (item.key)}
      <li>
        <button class="item" class:active={page === item.key} aria-current={page === item.key ? 'page' : undefined}
          title={item.hint + (item.key === 'extract' ? runHint : '')} onclick={() => onnavigate(item.key)}>
          <span class="icon">
            {#if item.key === 'extract'}
              <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                <rect x="2.5" y="3" width="15" height="9.5" rx="1.5" /><path d="M10 7.5v9m-3-3 3 3 3-3" />
              </svg>
              {#if run?.state === 'running'}
                <svg class="ring" viewBox="0 0 34 34" aria-hidden="true">
                  <circle class="track" cx="17" cy="17" r={R} />
                  <circle class="fill" cx="17" cy="17" r={R} stroke-dasharray={C} stroke-dashoffset={C * (1 - Math.max(run.fraction, 0.04))} />
                </svg>
              {:else if run}
                <span class="dot {run.state}" aria-hidden="true"></span>
              {/if}
            {:else if item.key === 'annotator'}
              <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                <path d="M3 5.5h5m3 0h6M3 10h3m3 0h8M3 14.5h8m3 0h3" /><path class="playhead" d="M12.5 2.5v15" />
              </svg>
            {:else}
              <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                <path d="M3 6h14M3 14h14" /><circle cx="7.5" cy="6" r="2" class="knob" /><circle cx="12.5" cy="14" r="2" class="knob" />
              </svg>
            {/if}
          </span>
          <span class="label">{item.label}</span>
        </button>
      </li>
    {/each}
  </ul>

  <span class="spacer"></span>
  {#if update}
    <button class="item update" title={update.state === 'available' ? `Version ${update.version} is ready to install`
      : update.state === 'downloading' ? `Downloading version ${update.version}` : `Version ${update.version} is installed: relaunch to finish`}
      onclick={() => onupdate?.()}>
      <span class="icon">
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
          <circle cx="10" cy="10" r="7.5" /><path d="M10 6v7m-3-3 3 3 3-3" />
        </svg>
        {#if update.state === 'downloading'}
          <svg class="ring" viewBox="0 0 34 34" aria-hidden="true">
            <circle class="track" cx="17" cy="17" r={R} />
            <circle class="fill" class:indeterminate={update.fraction == null} cx="17" cy="17" r={R} stroke-dasharray={C}
              stroke-dashoffset={C * (1 - Math.max(update.fraction ?? 0.25, 0.04))} />
          </svg>
        {:else}
          <span class="dot imported" aria-hidden="true"></span>
        {/if}
      </span>
      <span class="label">{update.state === 'ready' ? 'Relaunch' : 'Update'}</span>
    </button>
  {/if}
  <button class="item docs" title="The documentation, in your browser" onclick={() => openExternal(DOCS_URL)}>
    <span class="icon">
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
        <path d="M10 5.5C8.5 4.3 6.2 3.8 3 4v11.5c3.2-.2 5.5.3 7 1.5 1.5-1.2 3.8-1.7 7-1.5V4c-3.2-.2-5.5.3-7 1.5Zm0 0V17" />
      </svg>
    </span>
    <span class="label">Docs <span class="out" aria-label="(opens in your browser)">↗</span></span>
  </button>
</nav>

<style>
  .rail { width: 64px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 12px 0 10px;
          background: var(--color-bg-base); border-right: 1px solid var(--color-border-default); }
  .mark { margin-bottom: 14px; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .spacer { flex: 1; }

  .item { position: relative; width: 56px; padding: 7px 0 6px; display: flex; flex-direction: column; align-items: center; gap: 3px;
          background: none; border: 0; border-radius: 8px; color: var(--color-text-muted); }
  .item:hover:not(:disabled) { background: var(--color-bg-surface); color: var(--color-text-secondary); }
  .item:focus-visible { outline: 2px solid var(--color-info); outline-offset: -2px; }
  .item.active { background: var(--color-bg-elevated); color: var(--color-text-primary); }
  /* the page you are on: a bar on the rail's edge, flush with it */
  .item.active::before { content: ''; position: absolute; left: -4px; top: 10px; bottom: 10px; width: 3px; border-radius: 0 3px 3px 0; background: var(--color-primary); }
  .label { font-size: 10.5px; font-weight: 500; letter-spacing: .01em; line-height: 1.2; }
  .out { font-size: 9px; color: var(--color-text-muted); }

  .icon { position: relative; width: 34px; height: 26px; display: grid; place-items: center; }
  .icon > svg:first-child { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .knob { fill: var(--color-bg-base); }
  .item.active .knob { fill: var(--color-bg-elevated); }
  .item.active .playhead { stroke: var(--color-primary); }

  .ring { position: absolute; left: 0; top: -4px; width: 34px; height: 34px; transform: rotate(-90deg); fill: none; stroke-width: 2; }
  .ring .track { stroke: var(--color-border-strong); }
  .ring .fill { stroke: var(--color-primary); stroke-linecap: round; transition: stroke-dashoffset .5s ease-out; }
  .dot { position: absolute; right: 2px; top: 0; width: 8px; height: 8px; border-radius: 50%; box-shadow: 0 0 0 2px var(--color-bg-base); }
  .dot.imported { background: var(--color-primary); }
  .dot.failed { background: var(--color-danger); }
  .ring .fill.indeterminate { animation: spin 1.2s linear infinite; transform-origin: 17px 17px; }
  .update { color: var(--color-text-secondary); }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .ring .fill { transition: none; } .ring .fill.indeterminate { animation: none; } }
</style>
