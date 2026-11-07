<script lang="ts">
  // Every face track of a person, one track enlarged, two people side by side (to decide whether they are one), or
  // an image. Esc or a click outside closes it.
  import { useSession } from '../model/context';
  import { fmt } from '../geometry';
  import { plural } from '../model/session.svelte';
  import type { FaceTrack } from '../types';
  import Swatch from './ui/Swatch.svelte';

  const s = useSession();
  const box = $derived(s.lightbox);
  const close = () => (s.lightbox = null);
  let dialog = $state<HTMLDivElement>();
  $effect(() => { if (box) dialog?.focus(); });
  // Esc closes the lightbox, wherever the focus is, and does nothing else (the viewer's Esc clears the selection).
  function onkeydowncapture(e: KeyboardEvent) { if (box && e.key === 'Escape') { e.stopPropagation(); close(); } }
  const tracks = (p: string) => s.tracksOf.get(p) ?? [];
  function inspect(t: FaceTrack) { close(); s.select('face', t.id); }
  async function same(a: string, b: string) {
    close();
    const nb = s.nameOf(b), na = s.nameOf(a);
    await s.commit({ op: 'person.merge', from: b, into: a });
    s.toast(`Merged ${nb} into ${na}`);
  }
  async function different(a: string, b: string) { close(); await s.commit({ op: 'person.distinct', a, b }); }
</script>

<svelte:window {onkeydowncapture} />

{#snippet grid(list: FaceTrack[])}
  <div class="grid">
    {#each list as t (t.id)}
      <button class="figure" title="Inspect this track" onclick={() => inspect(t)}>
        {#if t.crop}<img src={s.asset(t.crop)} alt="" loading="lazy" />{:else}<span class="nocrop">no crop</span>{/if}
        <span class="caption">{fmt(t.start)} · shot {(s.bundle.shotNumber(t.shot) ?? 0) + 1}{s.includedFace(t) ? '' : ' · excluded'}</span>
      </button>
    {/each}
  </div>
{/snippet}

{#if box}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="lightbox" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="box" role="dialog" aria-modal="true" tabindex="-1" bind:this={dialog}>
      {#if box.kind === 'person'}
        <h2><Swatch colour={s.colourOf(box.person)} /> {s.nameOf(box.person)} <span class="meta">{plural(tracks(box.person).length, 'track')}</span></h2>
        <div class="meta">Every face track assigned to this person. Click one to inspect or reassign it.</div>
        {@render grid(tracks(box.person))}
      {:else if box.kind === 'face'}
        {@const t = s.bundle.face.get(box.face)}
        {#if t}
          <h2>Face track {t.id.slice(5)} <span class="meta">{s.nameOf(s.personOf(t))} · {fmt(t.start)}–{fmt(t.end)}</span></h2>
          {#if t.crop}<img class="big" src={s.asset(t.crop)} alt="" />{/if}
        {/if}
      {:else if box.kind === 'compare'}
        {@const a = box.a}
        {@const b = box.b}
        <div class="compare">
          {#each [a, b] as p (p)}
            <div>
              <h2><Swatch colour={s.colourOf(p)} /> {s.nameOf(p)}</h2>
              {@render grid(tracks(p))}
            </div>
          {/each}
        </div>
        <div class="actions">
          <button class="primary" onclick={() => same(a, b)}>Same person</button>
          <button onclick={() => different(a, b)}>Different people</button>
        </div>
      {:else}
        <h2>{box.title}</h2>
        <img class="big" src={s.asset(box.src)} alt="" />
      {/if}
      <div class="actions end"><button onclick={close}>Close</button></div>
    </div>
  </div>
{/if}

<style>
  .lightbox { position: fixed; inset: 0; z-index: 20; background: rgba(0,0,0,.72); display: flex; align-items: center; justify-content: center; padding: 32px; }
  .box { background: var(--color-bg-surface); border: 1px solid var(--color-border-strong); border-radius: 10px; max-width: min(1100px, 100%); max-height: 100%; overflow: auto; padding: 16px 20px 20px; outline: none; }
  h2 { margin: 0 0 4px; font-size: 16px; display: flex; gap: 12px; align-items: center; }
  .meta { color: var(--color-text-muted); font-weight: 400; font-size: 13px; }
  .big { max-width: 100%; max-height: 60vh; border-radius: 8px; display: block; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-top: 12px; }
  .figure { margin: 0; padding: 0; border: 0; background: none; text-align: left; display: flex; flex-direction: column; }
  .figure img { width: 100%; aspect-ratio: 4 / 5; object-fit: cover; border-radius: 6px; display: block; border: 2px solid transparent; }
  .figure:hover img { border-color: var(--color-primary); }
  .nocrop { aspect-ratio: 4 / 5; display: grid; place-items: center; background: var(--color-bg-card); border-radius: 6px; color: var(--color-text-muted); }
  .caption { font-size: 11px; color: var(--color-text-muted); margin-top: 3px; }
  .compare { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .actions { display: flex; gap: 8px; margin-top: 12px; }
  .actions.end { justify-content: flex-end; margin-top: 14px; }
</style>
