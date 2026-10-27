<script lang="ts">
  import { useSession } from '../../model/context';
  import { fmt } from '../../geometry';
  import type { Shot } from '../../types';
  import Toggle from '../ui/Toggle.svelte';
  import Crop from '../ui/Crop.svelte';
  import Swatch from '../ui/Swatch.svelte';

  let { shot }: { shot: Shot } = $props();
  const s = useSession();
  const caption = $derived(s.S.caption[shot.id] ?? shot.caption?.description ?? '');
  const onScreen = $derived([...new Set((s.bundle.facesByShot.get(shot.id) ?? []).map((t) => s.personOf(t)))]);
  const texts = $derived(s.bundle.texts.filter((x) => x.start < shot.end && x.end > shot.start));
  const model = $derived(shot.caption?.model ?? 'none');
</script>

<h2>Shot {shot.index + 1} of {s.bundle.shots.length}</h2>
<div class="meta">{fmt(shot.start)}–{fmt(shot.end)} <button class="link" onclick={() => s.playback.playClip(shot)}>Play</button></div>
<h3 title={`Written by ${model}`}>Caption</h3>
<textarea rows="5" aria-label="Shot caption" value={caption}
  onchange={(e) => { const v = e.currentTarget.value; if (v !== caption) s.commit({ op: 'shot.caption', shot: shot.id, caption: v }); }}></textarea>
{#if shot.caption?.setting}<div class="meta">Setting: {shot.caption.setting}</div>{/if}
{#if shot.caption?.mood}<div class="meta">Mood: {shot.caption.mood}</div>{/if}
<div class="row"><Toggle label="Send this caption to agents" checked={s.includedId(shot.id)} onchange={(v) => s.commit({ op: 'entity.include', id: shot.id, included: v })} /></div>
<h3>People in this shot</h3>
{#if onScreen.length}
  <div class="list">
    {#each onScreen as p (p)}
      {@const crop = s.cropOf(p)}
      <button class="item" onclick={() => s.select('person', p, { seek: false })}>
        {#if crop}<Crop path={crop} size="sm" />{:else}<Swatch colour={s.colourOf(p)} />{/if}
        <span class="grow">{s.nameOf(p)}</span>
      </button>
    {/each}
  </div>
{:else}<div class="empty">No faces detected.</div>{/if}
{#if texts.length}
  <h3>On-screen text</h3>
  <div class="list">{#each texts as x (x.id)}<button class="item" onclick={() => s.select('text', x.id)}><span class="grow">{x.text}</span></button>{/each}</div>
{/if}
