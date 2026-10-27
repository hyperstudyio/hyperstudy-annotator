<script lang="ts">
  // The timeline under the video. Interactions, as settled in the prototype's review:
  //   click a segment: select it and loop it (click again to stop)   drag across empty space: loop that range
  //   click empty space: move the playhead                            drag along the time ruler: scrub
  //   drag speech onto a person's row: change the speaker              drag across an annotation row: add a span
  //   pinch (ctrl+wheel): zoom about the pointer                      drag a label's grip: reorder groups / rows
  //   drag a row's bottom edge: resize it                             drag the top edge: timeline height
  import { flushSync, tick } from 'svelte';
  import { useSession } from '../../model/context';
  import { GROUP_KEYS } from '../../model/view.svelte';
  import { arrange, buildGroups, rowHeight, speakerForDrop, ROW_H, type Bar, type Row } from '../../timeline/rows';
  import { LABEL_W, ZOOM_MAX, fitPps, scrollToKeep, tickStep, timeAtX } from '../../timeline/scale';
  import { fmt } from '../../geometry';
  import { plural, NEUTRAL } from '../../model/session.svelte';
  import Popover from '../ui/Popover.svelte';
  import ModelInfo from './ModelInfo.svelte';
  import TypeForm from './TypeForm.svelte';
  import RowLabel from './RowLabel.svelte';
  import PlotCanvas from './PlotCanvas.svelte';

  let { onresizeheight, onresetheight }: { onresizeheight: (dy: number, start: number) => void; onresetheight: () => void } = $props();
  const s = useSession();
  const pb = s.playback;
  const duration = $derived(s.bundle.duration);
  const GROUP_NAMES: Record<string, string> = { audio: 'Audio', prosody: 'Prosody', people: 'People', objects: 'Objects', gestures: 'Gestures', social: 'Social', sounds: 'Sounds', text: 'Text', annotations: 'Annotations' };
  const RANGE_MIN_S = 0.2, DRAG_PX = 5, SPEECH_DRAG_PX = 6;

  let scroller = $state<HTMLDivElement>();
  let content = $state<HTMLDivElement>();
  let scrollerW = $state(0);
  let scrollLeft = $state(0);
  let zoom = $state(1);
  const pps = $derived(fitPps(scrollerW, duration) * zoom);
  const visibleW = $derived(Math.max(0, scrollerW - LABEL_W));
  const step = $derived(tickStep(pps));
  const ticks = $derived(Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step));
  const groups = $derived(buildGroups(s));
  const arranged = $derived(arrange(groups, s.view.s));
  const rowById = $derived(new Map(groups.flatMap((g) => g.rows.map((r) => [r.id, r] as const))));
  const hiddenCount = $derived(s.view.s.hidden.length);

  type Gesture =
    | { kind: 'scrub' }
    | { kind: 'create'; type: string; start: number; now: number }
    | { kind: 'range'; start: number; x: number; moved: boolean; now: number }
    | { kind: 'speech'; utt: string; text: string; colour: string; x: number; y: number; moved: boolean; over: string | null; px: number; py: number }
    | { kind: 'reorder'; what: 'group' | 'row'; id: string; group: string; at: number | null; lineY: number | null }
    | { kind: 'resize'; id: string; y: number; h0: number; now: number };
  let gesture = $state<Gesture | null>(null);
  let resizingTimeline = $state(false);

  const timeOf = (e: PointerEvent) => timeAtX(e.clientX, content!.getBoundingClientRect().left, pps, duration);

  // --- pointer ------------------------------------------------------------------------------------------------------

  function rulerDown(e: PointerEvent) {
    e.preventDefault();
    gesture = { kind: 'scrub' };
    pb.seek(timeOf(e));
  }
  function bodyDown(e: PointerEvent, row: Row) {
    if (e.button !== 0 || (e.target as Element).closest('.bar')) return;
    e.preventDefault();
    const t = timeOf(e);
    if (row.create) { pb.seek(t); gesture = { kind: 'create', type: row.create, start: t, now: t }; return; }
    gesture = { kind: 'range', start: t, x: e.clientX, moved: false, now: t };
  }
  function speechDown(e: PointerEvent, bar: Bar) {
    if (e.button !== 0 || !bar.drag) return;
    e.preventDefault(); e.stopPropagation();
    gesture = { kind: 'speech', utt: bar.drag.utt, text: bar.drag.ghost, colour: bar.colour ?? NEUTRAL, x: e.clientX, y: e.clientY, moved: false, over: null, px: e.clientX, py: e.clientY };
  }
  function gripDown(e: PointerEvent, what: 'group' | 'row', id: string, group: string) {
    e.preventDefault(); e.stopPropagation();
    gesture = { kind: 'reorder', what, id, group, at: null, lineY: null };
  }
  function resizeDown(e: PointerEvent, row: Row, h: number) {
    e.preventDefault(); e.stopPropagation();
    gesture = { kind: 'resize', id: row.id, y: e.clientY, h0: h, now: h };
  }

  function reorderCandidates(g: Extract<Gesture, { kind: 'reorder' }>) {
    const sel = g.what === 'group' ? '[data-group-header]' : `[data-row][data-group="${CSS.escape(g.group)}"]`;
    return [...content!.querySelectorAll<HTMLElement>(sel)];
  }
  /** A group's extent runs from its header to its last row. */
  function extentOf(el: HTMLElement, what: 'group' | 'row') {
    const r = el.getBoundingClientRect();
    if (what === 'row') return { top: r.top, bottom: r.bottom };
    let last: Element = el;
    while (last.nextElementSibling?.matches('[data-row]')) last = last.nextElementSibling;
    return { top: r.top, bottom: last.getBoundingClientRect().bottom };
  }

  function onpointermove(e: PointerEvent) {
    const g = gesture;
    if (!g) return;
    switch (g.kind) {
      case 'scrub': pb.seek(timeOf(e)); break;
      case 'create': g.now = timeOf(e); pb.seek(g.now); break;
      case 'range':
        if (!g.moved && Math.abs(e.clientX - g.x) < DRAG_PX) return;
        g.moved = true; g.now = timeOf(e);
        break;
      case 'speech': {
        if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < SPEECH_DRAG_PX) return;
        g.moved = true; g.px = e.clientX; g.py = e.clientY;
        g.over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-drop]')?.dataset.drop ?? null;
        break;
      }
      case 'reorder': {
        const rects = reorderCandidates(g).map((el) => extentOf(el, g.what)), top = content!.getBoundingClientRect().top;
        if (!rects.length) return;
        let at = rects.findIndex((r) => e.clientY < (r.top + r.bottom) / 2);
        if (at < 0) at = rects.length;
        g.at = at;
        g.lineY = (at < rects.length ? rects[at].top : rects[rects.length - 1].bottom) - top - 1;
        break;
      }
      case 'resize': g.now = Math.round(g.h0 + e.clientY - g.y); break;
    }
  }

  async function onpointerup(e: PointerEvent) {
    const g = gesture;
    gesture = null;
    if (!g) return;
    switch (g.kind) {
      case 'create': {
        const end = timeOf(e);
        if (Math.abs(end - g.start) >= RANGE_MIN_S) await s.addNote(g.type, Math.min(g.start, end), Math.max(g.start, end));
        break;
      }
      case 'range': {
        if (!g.moved) { pb.seek(g.start); break; }
        const end = timeOf(e), a = Math.min(g.start, end), b = Math.max(g.start, end);
        if (b - a >= RANGE_MIN_S) pb.playClip({ start: a, end: b });
        break;
      }
      case 'speech': {
        const u = s.bundle.utt.get(g.utt);
        if (!u) break;
        if (!g.moved) { s.select('utt', u.id); s.clickPlay(); break; }
        const drop = g.over ? rowById.get(g.over)?.drop : undefined;
        if (!drop) break;
        const speaker = speakerForDrop(s, u, drop);
        if (!speaker) { s.toast('No unknown face is on screen during this utterance'); break; }
        if (JSON.stringify(speaker) === JSON.stringify(s.speakerOf(u))) break;
        await s.commit({ op: 'utterance.speaker', utt: u.id, speaker });
        s.toast(`“${s.uttText(u).slice(0, 40)}” → ${s.speakerName(speaker)}`);
        break;
      }
      case 'reorder': {
        if (g.at === null) break;
        if (g.what === 'group') s.view.moveGroup(arranged.map((x) => x.group.key), g.id, g.at);
        else {
          const shown = arranged.find((x) => x.group.key === g.group)?.rows.map((r) => r.id) ?? [];
          s.view.moveRow(g.group, shown, g.id, g.at);
        }
        break;
      }
      case 'resize': if (g.now !== g.h0) s.view.setHeight(g.id, g.now); break;
    }
  }

  function barClick(bar: Bar) {
    if (!bar.sel || bar.drag) return;   // speech is handled on pointerup (a click there, a drag elsewhere)
    s.select(bar.sel.kind, bar.sel.id);
    s.clickPlay();
  }

  // pinch to zoom, about the pointer; ordinary scrolling stays scrolling
  $effect(() => {
    const el = scroller;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const x = e.clientX - el.getBoundingClientRect().left - LABEL_W, t = (el.scrollLeft + x) / pps;
      const next = Math.min(ZOOM_MAX, Math.max(1, zoom * Math.exp(-e.deltaY * 0.01)));
      if (next === zoom) return;
      zoom = next;
      flushSync();   // lay the content out at the new scale now, so this and the next wheel event read one scale
      el.scrollLeft = scrollToKeep(t, x, pps);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  // keep the playhead in view while playing
  $effect(() => {
    const el = scroller, x = pb.time * pps;
    if (!el || pb.paused) return;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - LABEL_W - 40) el.scrollLeft = Math.max(0, x - 80);
  });

  // reveal the selection: scroll to its start, and to its bar
  $effect(() => {
    const span = s.spanOf(s.selection), el = scroller;
    if (!span || !el) return;
    const x = span.start * pps, w = el.clientWidth - LABEL_W;
    if (x < el.scrollLeft || x > el.scrollLeft + w - 60) el.scrollLeft = Math.max(0, x - w / 3);
    tick().then(() => {
      const bar = content?.querySelector<HTMLElement>('.bar.selected');
      if (!bar) return;
      const r = bar.getBoundingClientRect(), sr = el.getBoundingClientRect();
      if (r.top < sr.top + 24 || r.bottom > sr.bottom) el.scrollTop += r.top - sr.top - sr.height / 2;
    });
  });

  function startTimelineResize(e: PointerEvent) {
    e.preventDefault();
    const y0 = e.clientY, h0 = scroller!.getBoundingClientRect().height;
    resizingTimeline = true;
    const move = (ev: PointerEvent) => onresizeheight(y0 - ev.clientY, h0);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); resizingTimeline = false; s.view.save(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const range = $derived.by(() => {
    const g = gesture;
    if (g?.kind === 'range' && g.moved) return { start: Math.min(g.start, g.now), end: Math.max(g.start, g.now), preview: true };
    return pb.clip ? { ...pb.clip, preview: false } : null;
  });
  const marking = $derived.by(() => {
    const g = gesture;
    if (g?.kind === 'create') return { start: Math.min(g.start, g.now), end: Math.max(g.start, g.now) };
    if (s.marking !== null) return { start: Math.min(s.marking, pb.time), end: Math.max(s.marking, pb.time) };
    return null;
  });
  const heightOf = (row: Row) => (gesture?.kind === 'resize' && gesture.id === row.id ? gesture.now : rowHeight(row, s.view.s.heights));
  const barStyle = (bar: Bar) => `left:${bar.start * pps}px; width:${Math.max(3, (bar.end - bar.start) * pps - 1)}px; top:${bar.top ?? (bar.row ?? 0) * ROW_H + 3}px;${bar.colour ? ` background:${bar.colour};` : ''}`;
</script>

<svelte:window {onpointermove} {onpointerup} />

{#snippet bars(list: Bar[], summary = false)}
  {#each list as bar (bar.key)}
    {#if summary}
      <div class="bar summary" style="left:{bar.start * pps}px; width:{Math.max(3, (bar.end - bar.start) * pps - 1)}px; top:3px; background:{bar.colour}"></div>
    {:else}
      <!-- no focus on click: a focused button would also take the Space meant for play/pause -->
      <button class="bar {bar.flags.join(' ')}" class:draggable={!!bar.drag} style={barStyle(bar)} title={bar.title} tabindex="-1"
        onmousedown={(e) => e.preventDefault()} onpointerdown={bar.drag ? (e) => speechDown(e, bar) : undefined} onclick={() => barClick(bar)}>{bar.text ?? ''}</button>
    {/if}
  {/each}
{/snippet}

<section class="timeline" class:busy={gesture?.kind === 'reorder' || gesture?.kind === 'speech'} style="--label-w:{LABEL_W}px; --tl-h:{s.view.s.timelineH ? `${s.view.s.timelineH}px` : '42vh'}">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="timeline-resize" class:active={resizingTimeline} title="Drag to give the timeline more or less height · double-click to reset" onpointerdown={startTimelineResize} ondblclick={onresetheight}></div>
  <div class="tl-tools">
    <Popover label="Layers shown in the timeline" title="Choose which layers the timeline shows" width={200} buttonClass="plain">
      {#snippet button()}Layers{/snippet}
      {#snippet children()}
        {#each GROUP_KEYS as key (key)}
          <label class="menu-item"><input type="checkbox" checked={!s.view.s.hiddenGroups.includes(key)} onchange={(e) => s.view.setGroupShown(key, e.currentTarget.checked)} />{GROUP_NAMES[key]}</label>
        {/each}
      {/snippet}
    </Popover>
    <span class="spacer"></span>
    {#if hiddenCount}<button class="link" onclick={() => s.view.showRows('all')}>Show {plural(hiddenCount, 'hidden row')}</button>{/if}
    <label class="zoom">Zoom <input type="range" min="1" max={ZOOM_MAX} step="0.01" bind:value={zoom} title="Zoom (or pinch on the timeline)" onchange={(e) => e.currentTarget.blur()} /></label>
  </div>

  <div class="tl-scroll" bind:this={scroller} bind:clientWidth={scrollerW} onscroll={() => (scrollLeft = scroller!.scrollLeft)}>
    <div class="tl-content" bind:this={content} style="width:{LABEL_W + duration * pps}px">
      <div class="lane ruler">
        <div class="lane-label ruler-label"></div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="lane-body" style="width:{duration * pps}px; height:20px" title="Drag to scrub" onpointerdown={rulerDown}>
          {#each ticks as t (t)}<span class="tick" style="left:{t * pps}px">{fmt(t).replace(/\.\d$/, '')}</span>{/each}
        </div>
      </div>

      {#if s.bundle.shots.length}
        <div class="lane">
          <RowLabel row={{ id: 'shots', label: { kind: 'text', text: 'Shots' }, bars: [] }} info="shots" />
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="lane-body" style="width:{duration * pps}px; height:{ROW_H + 2}px" onpointerdown={(e) => bodyDown(e, { id: 'shots', label: { kind: 'text', text: '' }, bars: [] })}>
            {@render bars(s.bundle.shots.map((x) => ({ key: x.id, start: x.start, end: x.end, text: String(x.index + 1), sel: { kind: 'shot', id: x.id },
              flags: ['shot', ...(x.index % 2 ? ['odd' as const] : []), ...(s.isSel('shot', x.id) ? ['selected' as const] : [])],
              title: `Shot ${x.index + 1}: ${fmt(x.start)}–${fmt(x.end)}` })))}
          </div>
        </div>
        {#if s.bundle.shots.some((x) => x.caption?.description || s.S.caption[x.id])}
          <!-- each shot's caption in its own span: the words to read along, the whole of it on hover; a click opens it to edit -->
          <div class="lane">
            <RowLabel row={{ id: 'captions', label: { kind: 'text', text: 'Captions' }, bars: [] }} />
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="lane-body" style="width:{duration * pps}px; height:{ROW_H + 2}px" onpointerdown={(e) => bodyDown(e, { id: 'captions', label: { kind: 'text', text: '' }, bars: [] })}>
              {@render bars(s.bundle.shots.map((x) => { const c = s.S.caption[x.id] ?? x.caption?.description ?? ''; return { key: `caption-${x.id}`, start: x.start, end: x.end, text: (x.end - x.start) * pps >= 40 ? c : '',
                sel: { kind: 'shot', id: x.id }, flags: ['caption', ...(s.isSel('shot', x.id) ? ['selected' as const] : [])], title: c || `Shot ${x.index + 1} has no caption` }; }))}
            </div>
          </div>
        {/if}
      {/if}

      {#each arranged as { group, collapsed, hiddenHere, rows } (group.key)}
        <div class="lane group" data-group-header={group.key}>
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div class="lane-label group-label" role="button" tabindex="-1" title={collapsed ? 'Expand' : 'Collapse'} onclick={() => s.view.toggleCollapsed(group.key)}>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="grip" title="Drag to move this group" onpointerdown={(e) => gripDown(e, 'group', group.key, group.key)} onclick={(e) => e.stopPropagation()}>
              <svg viewBox="0 0 6 10" width="6" height="10" aria-hidden="true"><g fill="currentColor"><circle cx="1.5" cy="2" r="1" /><circle cx="4.5" cy="2" r="1" /><circle cx="1.5" cy="5" r="1" /><circle cx="4.5" cy="5" r="1" /><circle cx="1.5" cy="8" r="1" /><circle cx="4.5" cy="8" r="1" /></g></svg>
            </span>
            <svg class="chev" viewBox="0 0 10 10" width="9" height="9" aria-hidden="true"><path d={collapsed ? 'M3 1l4 4-4 4' : 'M1 3l4 4 4-4'} fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
            <span class="text">{group.label}</span>
            <span class="count">{group.count}</span>
            <ModelInfo group={group.key} title={group.label} />
            {#if group.key === 'annotations'}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span class="add-type" onclick={(e) => e.stopPropagation()}>
                <Popover label="New annotation type" width={300} chevron={false} buttonClass="plain" title="Add an annotation type: a row of its own">
                  {#snippet button()}<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M5 1v8M1 5h8" stroke="currentColor" stroke-width="1.6" /></svg>{/snippet}
                  {#snippet children(close)}<TypeForm {close} />{/snippet}
                </Popover>
              </span>
            {/if}
            {#if hiddenHere.length}<button class="link restore" title="Show hidden rows" onclick={(e) => { e.stopPropagation(); s.view.showRows(hiddenHere); }}>+{hiddenHere.length} hidden</button>{/if}
          </div>
          <div class="lane-body" style="width:{duration * pps}px; height:{collapsed ? 24 : 22}px">
            {#if collapsed}{@render bars(group.summary, true)}{/if}
          </div>
        </div>
        {#if !collapsed}
          {#each rows as row (row.id)}
            {@const h = heightOf(row)}
            {@const hideable = row.hideable !== false}
            <div class="lane" class:drop-target={gesture?.kind === 'speech' && gesture.moved && gesture.over === row.id}
              data-row={row.id} data-group={group.key} data-drop={row.drop ? row.id : undefined}>
              <RowLabel {row} ongrip={(e) => gripDown(e, 'row', row.id, group.key)} onhide={hideable ? () => s.view.hideRow(row.id) : undefined} />
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="lane-body" style="width:{duration * pps}px; height:{h}px" onpointerdown={(e) => bodyDown(e, row)}>
                {#if row.plot}<PlotCanvas plot={row.plot} height={h} x0={scrollLeft} width={visibleW} {pps} />{/if}
                {@render bars(row.bars)}
                {#if row.hint && !row.bars.length}<span class="hint-text">{row.hint}</span>{/if}
              </div>
              {#if hideable}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="lane-resize" title="Drag to change the row height · double-click to reset" onpointerdown={(e) => resizeDown(e, row, h)} ondblclick={() => s.view.setHeight(row.id, null)}></div>
              {/if}
            </div>
          {/each}
        {/if}
      {/each}

      {#each s.bundle.shots.slice(1) as x (x.id)}<div class="cut" style="left:{LABEL_W + x.start * pps}px"></div>{/each}
      {#if marking}<div class="marking" style="left:{LABEL_W + marking.start * pps}px; width:{(marking.end - marking.start) * pps}px"></div>{/if}
      {#if range}<div class="clip-span" style="left:{LABEL_W + range.start * pps}px; width:{(range.end - range.start) * pps}px"></div>{/if}
      <div class="playhead" style="left:{LABEL_W + pb.time * pps}px"></div>
      {#if gesture?.kind === 'reorder' && gesture.lineY !== null}<div class="reorder-line" style="top:{gesture.lineY}px"></div>{/if}
    </div>
  </div>
</section>

{#if gesture?.kind === 'speech' && gesture.moved}
  <div class="ghost" style="left:{gesture.px + 12}px; top:{gesture.py + 8}px; background:{gesture.colour}">{gesture.text}</div>
{/if}

<style>
  .timeline { grid-column: 1; border-top: 1px solid var(--color-border-default); background: var(--color-bg-surface); position: relative; min-width: 0; }
  .timeline.busy, .timeline.busy * { cursor: grabbing !important; user-select: none; }
  .timeline-resize { position: absolute; top: -4px; left: 0; right: 0; height: 7px; cursor: row-resize; z-index: 6; }
  .timeline-resize:hover, .timeline-resize.active { background: var(--color-primary-light); }
  .tl-tools { display: flex; align-items: center; gap: 10px; padding: 6px 16px; color: var(--color-text-secondary); min-width: 0; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; min-width: 0; }
  .spacer { flex: 1; }
  .hint { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 1 auto; }
  .meta { color: var(--color-text-muted); }
  .zoom { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .tl-scroll { position: relative; overflow: auto; max-height: var(--tl-h); }
  .tl-content { position: relative; min-width: 100%; }
  .lane { display: flex; border-bottom: 1px solid var(--color-border-default); position: relative; }
  .lane.drop-target { background: var(--color-primary-light); }
  .lane-body { position: relative; flex: none; cursor: crosshair; }
  .ruler .lane-body { cursor: ew-resize; }
  .ruler-label { position: sticky; left: 0; z-index: 3; width: var(--label-w); flex: none; background: var(--color-bg-surface); border-right: 1px solid var(--color-border-default); }
  .lane-resize { position: absolute; left: 0; right: 0; bottom: -3px; height: 6px; cursor: row-resize; z-index: 4; }
  .lane-resize:hover { background: var(--color-primary-light); }
  .group { background: var(--color-bg-elevated); }
  .group-label { position: sticky; left: 0; z-index: 3; width: var(--label-w); flex: none; padding: 3px 6px 3px 16px; display: flex; align-items: center; gap: 6px;
                 border-right: 1px solid var(--color-border-default); overflow: hidden; white-space: nowrap; cursor: pointer;
                 color: var(--color-text-primary); font-weight: 600; background: var(--color-bg-elevated); }
  .group-label .text { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .group-label .count { color: var(--color-text-muted); font-weight: 400; }
  .group-label .restore { font-weight: 400; }
  .chev { color: var(--color-text-muted); flex: none; }
  .grip { position: absolute; left: 3px; width: 10px; display: grid; place-items: center; color: var(--color-text-muted); cursor: grab; visibility: hidden; }
  .group-label:hover .grip { visibility: visible; }
  .tick { position: absolute; top: 0; bottom: 0; border-left: 1px solid var(--color-border-strong); color: var(--color-text-muted); font-size: 10px; padding-left: 3px; pointer-events: none; }
  .hint-text { position: absolute; left: 8px; top: 4px; color: var(--color-text-muted); font-size: 11px; pointer-events: none; }

  .bar { position: absolute; height: 16px; border-radius: 4px; font-size: 11px; line-height: 16px; padding: 0 4px; overflow: hidden; white-space: nowrap;
         text-overflow: clip; cursor: pointer; color: #111; border: 0; text-align: left; background: #8a8a8a; }
  .bar:hover { filter: brightness(1.12); }
  .bar.vis { height: 6px; opacity: .55; border-radius: 3px; }
  .bar.caption { background: var(--color-bg-elevated); color: var(--color-text-secondary); text-align: left; text-overflow: ellipsis; border: 1px solid var(--color-border-default); }
  .bar.speech { height: 10px; border-radius: 3px; padding: 0; }   /* when a person speaks; the words are in the transcript row */
  .bar.draggable { cursor: grab; }
  .bar.excluded { background: transparent !important; border: 1px dashed var(--color-text-muted); color: var(--color-text-muted); }
  .bar.unconfirmed { outline: 1px dashed var(--color-text-muted); outline-offset: -1px; }
  .bar.flagged { box-shadow: inset 0 -3px 0 var(--color-caution); }
  .bar.selected { outline: 2px solid #fff; outline-offset: 0; z-index: 2; opacity: 1; }
  .bar.shot { background: var(--color-bg-card); color: var(--color-text-muted); border-radius: 0; border-right: 2px solid var(--color-bg-base); }
  .bar.shot.odd { background: var(--color-bg-elevated); }
  .bar.neutral { background: #8a8a8a; }
  .bar.summary { opacity: .5; pointer-events: none; height: 16px; border-radius: 4px; }

  .cut { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(255,255,255,.12); pointer-events: none; z-index: 1; }
  .playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--color-primary); pointer-events: none; z-index: 2; }
  .clip-span { position: absolute; top: 0; bottom: 0; background: rgba(76,175,80,.14); border-left: 1px solid var(--color-primary); border-right: 1px solid var(--color-primary); pointer-events: none; z-index: 1; }
  .marking { position: absolute; top: 0; bottom: 0; background: rgba(33,150,243,.18); pointer-events: none; z-index: 1; }
  .reorder-line { position: absolute; left: 0; right: 0; height: 2px; background: var(--color-primary); z-index: 7; pointer-events: none; }
  .ghost { position: fixed; z-index: 30; pointer-events: none; padding: 2px 8px; border-radius: 4px; color: #111; font-size: 12px; box-shadow: 0 4px 12px rgba(0,0,0,.5);
           max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .add-type { margin-left: auto; }
  .add-type :global(.trigger) { padding: 3px 5px; }
</style>
