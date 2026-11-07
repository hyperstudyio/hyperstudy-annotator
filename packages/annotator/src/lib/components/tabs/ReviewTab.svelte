<script lang="ts">
  import { useSession, useSource } from '../../model/context';
  import { describe } from '../../model/carryover';
  import { fmt } from '../../geometry';
  import { UNCERTAIN_GAP, NEUTRAL } from '../../model/session.svelte';
  import type { Utterance } from '../../types';
  import Crop from '../ui/Crop.svelte';
  import Swatch from '../ui/Swatch.svelte';
  import InspectUtterance from '../inspect/InspectUtterance.svelte';

  const s = useSession(), source = useSource();
  const dismiss = async (index: number) => { s.carry = await source.lineage!.dismiss(index); };
  const q = $derived(s.queue);
  const open = $derived(q.speakers.filter((u) => !s.reviewed(u)).length);
  const cur = $derived(s.selection?.kind === 'utt' ? s.bundle.utt.get(s.selection.id) ?? null : null);
  const byShot = $derived.by(() => {
    const m = new Map<string, Utterance[]>();
    for (const u of q.speakers) { if (!m.has(u.shot)) m.set(u.shot, []); m.get(u.shot)!.push(u); }
    return [...m];
  });
  const decided = (id: string) => id in s.S.included;
</script>

{#if cur}
  <div class="current"><InspectUtterance u={cur} /></div>
{:else}
  <div class="callout info">Pick an utterance below, or press <kbd>j</kbd> to start. Its faces are numbered on the video.</div>
{/if}
{#if s.notCarried.length}
  <h3>Not carried over from the earlier run · {s.notCarried.length}</h3>
  <div class="meta" style="margin-bottom:6px">Corrections made on an earlier run of this video that could not be matched to this one. Redo the ones still needed, then dismiss them.</div>
  <div class="list">
    {#each s.notCarried as u (u.index)}
      <div class="item">
        {#if u.span}<button class="link meta" title="Go to this moment" onclick={() => s.playback.seek(u.span!.start)}>{fmt(u.span.start)}</button>{/if}
        <span class="grow"><span class="what">{describe(u.op)}</span><span class="meta why">{u.reason}</span></span>
        <button onclick={() => dismiss(u.index)} aria-label={`Dismiss: ${describe(u.op)}`} title="Take it off this list for good (the earlier run keeps it)">Dismiss</button>
      </div>
    {/each}
  </div>
{/if}
<h3>Who is speaking · {open} of {q.speakers.length} left</h3>
<div class="meta">Faces are on screen but the speaker model is unsure (gap under {UNCERTAIN_GAP}, or no face scored as speaking). Grouped by shot.</div>
{#each byShot as [shotId, us] (shotId)}
  {@const shot = s.shot(shotId)}
  <button class="shot-group" onclick={() => s.select('shot', shotId)}>
    <span>Shot {(shot?.index ?? 0) + 1} · {fmt(shot?.start ?? 0)}</span>
    <span class="meta">{us.filter((u) => !s.reviewed(u)).length} left</span>
  </button>
  <div class="list">
    {#each us as u (u.id)}
      {@const sp = s.speakerOf(u)}
      {@const face = sp.kind === 'face' ? s.bundle.face.get(sp.face) : null}
      <button class="item" class:done={s.reviewed(u)} class:selected={s.isSel('utt', u.id)} onclick={() => { s.select('utt', u.id); s.playback.playClip(u); }}>
        {#if face?.crop}<Crop path={face.crop} size="xs" />{:else}<Swatch colour={s.speakerColour(sp) ?? NEUTRAL} />{/if}
        <span class="grow">“{s.uttText(u)}”</span>
        <span class="meta">{s.speakerName(sp)}</span>
      </button>
    {/each}
  </div>
{/each}
<h3>Possible duplicate people · {q.pairs.length}</h3>
<div class="meta" style="margin-bottom:6px">Similar faces that are never on screen together. Compare shows every track of both.</div>
{#if q.pairs.length}
  <div class="list">
    {#each q.pairs as p (p.a + p.b)}
      {@const ca = s.cropOf(p.a)}
      {@const cb = s.cropOf(p.b)}
      <div class="item">
        {#if ca}<Crop path={ca} size="sm" label="Compare" onclick={() => (s.lightbox = { kind: 'compare', a: p.a, b: p.b })} />{/if}
        {#if cb}<Crop path={cb} size="sm" label="Compare" onclick={() => (s.lightbox = { kind: 'compare', a: p.a, b: p.b })} />{/if}
        <span class="grow" title={`ArcFace distance ${p.distance}`}>{s.nameOf(p.a)} / {s.nameOf(p.b)}</span>
        <button onclick={() => (s.lightbox = { kind: 'compare', a: p.a, b: p.b })}>Compare</button>
      </div>
    {/each}
  </div>
{:else}<div class="empty">None left.</div>{/if}
<h3>Sounds only one model heard · {q.sounds.filter((x) => !decided(x.id)).length} of {q.sounds.length} left</h3>
<div class="list">
  {#each q.sounds as x (x.id)}
    <div class="item" class:done={decided(x.id)} class:selected={s.isSel('sound', x.id)}>
      <span class="meta">{fmt(x.start)}</span>
      <button class="link grow left" onclick={() => s.select('sound', x.id)}>{x.label}</button>
      <button onclick={() => s.playback.playClip(x)}>Play</button>
      <button class:on={s.S.included[x.id] === true} onclick={() => s.commit({ op: 'entity.include', id: x.id, included: true })} title="This sound is there">Real</button>
      <button class:on={s.S.included[x.id] === false} onclick={() => s.commit({ op: 'entity.include', id: x.id, included: false })} title="Nothing like this sound is there: it is left out of the export's included sounds">Not there</button>
    </div>
  {/each}
</div>

<style>
  .current { border: 1px solid var(--color-border-strong); border-radius: 8px; padding: 10px 12px; margin-bottom: 6px; }
  .shot-group { display: flex; align-items: center; gap: 8px; margin: 12px 0 4px; color: var(--color-text-secondary); background: none; border: 0; padding: 0; }
  .left { text-align: left; color: var(--color-text-primary); }
  .what, .why { display: block; white-space: normal; }
</style>
