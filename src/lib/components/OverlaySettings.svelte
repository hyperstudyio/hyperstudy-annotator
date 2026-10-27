<script lang="ts">
  // What is drawn over the video, in the Overlays menu. Each overlay is a row you click to turn on or off, lit when on;
  // its style button opens how it is drawn: its colour (each person's own, the timeline's, or one you pick), opacity
  // and line width (view.svelte: kept per viewer, never in the data). One style is open at a time. After pyfeat-live's overlay settings. Reset puts
  // every style back; what is on stays on.
  import { useSession, useSource } from '../model/context';
  import { DEFAULT_STYLE, type OverlayKey, type OverlayLayers } from '../model/view.svelte';

  const s = useSession(), source = useSource();
  const L = $derived(s.view.s.layers);
  const b = $derived(s.bundle.layers);
  const noDetail = $derived(!b.faces?.detail);
  const handsUnlinked = $derived((b.hands?.hands ?? []).some((x) => !x.body && !x.face));

  type Row = { key: keyof OverlayLayers; style?: OverlayKey; label: string; missing: string | null; note?: string };
  const rows = $derived<Row[]>([
    { key: 'boxes', style: 'boxes', label: 'Faces', missing: b.faces ? null : 'No faces layer for this video' },
    { key: 'objects', style: 'objects', label: 'Objects', missing: b.objects ? null : 'No objects layer for this video' },
    { key: 'skeleton', style: 'skeleton', label: 'Skeletons', missing: b.bodies ? null : 'No bodies layer for this video' },
    { key: 'hands', style: 'hands', label: 'Hands', missing: b.hands ? null : 'No hands layer for this video', note: 'Dashed: found by the hand detector, with no body' },
    ...(handsUnlinked ? [{ key: 'unlinkedHands' as const, label: 'Hands with no body', missing: null, note: 'Often faces, logos or bokeh' }] : []),
    { key: 'landmarks', style: 'landmarks', label: 'Face landmarks', missing: noDetail ? 'No py-feat face detail for this video' : null },
    { key: 'gaze', style: 'gaze', label: 'Gaze', missing: !b.gaze && noDetail ? 'No gaze for this video' : null },
    { key: 'smooth', label: 'Smooth the drawing', missing: null, note: 'Display only: the data stay as they are' },
  ]);
  function set(key: keyof OverlayLayers, on: boolean) {
    s.view.setLayer(key, on);
    if (on && (key === 'landmarks' || key === 'gaze')) s.needDetail(source);
  }
  const styled = $derived(Object.keys(s.view.s.styles ?? {}).length > 0);
  // the colour a picker opens on: the last one chosen, else white
  const pick = (k: OverlayKey) => s.view.styleOf(k).colour ?? '#ffffff';
  let open = $state<OverlayKey | null>(null);
</script>

<div class="overlays">
  <div class="head">
    <span>Drawn over the video</span>
    <button class="link" onclick={() => s.view.resetStyles()} disabled={!styled} title="Every overlay back to its own colours, full opacity and normal width">Reset</button>
  </div>
  {#each rows as r (r.key)}
    {@const on = L[r.key] && !r.missing}
    {@const st = r.style ? s.view.styleOf(r.style) : DEFAULT_STYLE}
    <div class="row" class:on>
      <div class="line">
        <button class="toggle" aria-pressed={on} disabled={!!r.missing} title={r.missing ?? r.note} onclick={() => set(r.key, !L[r.key])}>
          <span class="mark" aria-hidden="true" style:background={r.style && st.colour ? st.colour : undefined} class:own={!!r.style && !st.colour}></span>
          {r.label}
        </button>
        {#if on && r.style}
          {@const k = r.style}
          <button class="style" aria-expanded={open === k} aria-label={`How ${r.label.toLowerCase()} are drawn`} title="Colour, opacity and width"
            onclick={() => (open = open === k ? null : k)}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 4h8M13 4h1M2 12h2M7 12h7" /><circle cx="11.5" cy="4" r="1.6" /><circle cx="5.5" cy="12" r="1.6" /></svg>
          </button>
        {/if}
      </div>
      {#if on && r.style && open === r.style}
        {@const k = r.style}
        <div class="controls">
          <div class="colour" role="group" aria-label={`${r.label}: colour`}>
            <button class="choice" class:chosen={!st.colour} aria-pressed={!st.colour} onclick={() => s.view.setStyle(k, { colour: null })}
              title="Each person's own colour, as on the timeline">By person</button>
            <label class="choice swatch" class:chosen={!!st.colour} title="One colour for all">
              <input type="color" value={pick(k)} aria-label={`${r.label}: one colour`} oninput={(e) => s.view.setStyle(k, { colour: e.currentTarget.value })} />
              <span style:background={pick(k)}></span>
            </label>
          </div>
          <label class="slider">Opacity
            <input type="range" min="0.1" max="1" step="0.05" value={st.opacity} aria-label={`${r.label}: opacity`}
              oninput={(e) => s.view.setStyle(k, { opacity: +e.currentTarget.value })} />
            <span class="value">{Math.round(st.opacity * 100)}%</span>
          </label>
          <label class="slider">Width
            <input type="range" min="0.5" max="3" step="0.25" value={st.width} aria-label={`${r.label}: line width`}
              oninput={(e) => s.view.setStyle(k, { width: +e.currentTarget.value })} />
            <span class="value">{st.width}×</span>
          </label>
          {#if k === 'gaze' && b.gaze && !noDetail}
            <label class="slider">From
              <select aria-label="Gaze source" title="Where the drawn gaze comes from (the Social rows always use Gaze-LLE)" value={s.view.s.gazeSource}
                onchange={(e) => s.view.setGazeSource(e.currentTarget.value as 'gaze_lle' | 'pyfeat')}>
                <option value="gaze_lle">Gaze-LLE</option><option value="pyfeat">py-feat's ray</option>
              </select>
            </label>
          {/if}
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .overlays { display: grid; gap: 2px; padding: 2px; }
  .head { display: flex; justify-content: space-between; align-items: baseline; padding: 4px 8px 6px; color: var(--color-text-muted); font-size: 12px; }
  .row { border-radius: 6px; }
  .row.on { background: var(--color-primary-light); box-shadow: inset 0 0 0 1px var(--color-primary); }   /* as a button that is on (Loop) */
  .line { display: flex; align-items: center; }
  .toggle { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; text-align: left; background: none; border: 0; padding: 7px 10px; color: var(--color-text-muted); }
  .style { flex: none; background: none; border: 0; padding: 4px 8px; color: var(--color-text-muted); }
  .style:hover:not(:disabled), .style[aria-expanded='true'] { color: var(--color-text-primary); background: none; }
  .style svg { fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; }
  .row.on .toggle { color: var(--color-text-primary); }
  .toggle:hover:not(:disabled) { background: var(--color-bg-hover); }
  .row.on .toggle:hover:not(:disabled) { background: none; }
  .toggle:disabled { opacity: .45; cursor: default; }
  /* the overlay's colour: each person's own (the four lane colours, as in the app's mark) or the one chosen */
  .mark { width: 10px; height: 10px; border-radius: 3px; flex: none; background: var(--color-border-strong); }
  .row.on .mark { background: var(--color-primary); }
  .row.on .mark.own { background: conic-gradient(var(--color-primary) 0 25%, var(--color-info) 0 50%, var(--color-caution) 0 75%, #c084fc 0); }
  .controls { display: grid; gap: 6px; padding: 0 10px 10px 30px; font-size: 12px; color: var(--color-text-secondary); }
  .colour { display: flex; gap: 4px; }
  .choice { position: relative; font-size: 12px; padding: 2px 8px; border-radius: 5px; background: none; border: 1px solid var(--color-border-strong); color: var(--color-text-secondary); cursor: pointer; display: inline-flex; align-items: center; }
  .choice.chosen { border-color: var(--color-primary); color: var(--color-text-primary); }
  .swatch { padding: 3px; }
  .swatch span { width: 22px; height: 14px; border-radius: 3px; display: block; }
  .swatch input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
  .swatch:has(input:focus-visible) { outline: 2px solid var(--color-info); outline-offset: 1px; }
  .slider { display: grid; grid-template-columns: 52px minmax(0, 1fr) 38px; align-items: center; gap: 8px; }
  .slider input[type=range] { accent-color: var(--color-primary); width: 100%; }
  .slider select { grid-column: 2 / -1; }
  .value { font-variant-numeric: tabular-nums; text-align: right; color: var(--color-text-muted); }
</style>
