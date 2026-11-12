<script lang="ts">
  // A shot, to edit its caption: who is in it and what text is on screen are rows of the timeline already.
  import { useSession } from '../../model/context';
  import { fmt } from '../../geometry';
  import type { Shot } from '../../types';

  let { shot }: { shot: Shot } = $props();
  const s = useSession();
  const caption = $derived(s.S.caption[shot.id] ?? shot.caption?.description ?? '');
  const model = $derived(shot.caption?.model ?? 'none');
</script>

<h2>Shot {shot.index + 1} of {s.bundle.shots.length}</h2>
<div class="meta">{fmt(shot.start)}–{fmt(shot.end)} · <button class="link" onclick={() => s.playback.playClip(shot)}>play</button></div>
<textarea rows="6" aria-label="Shot caption" title={`Written by ${model}`} placeholder="No caption: this run had no Anthropic key, or captions were off" value={caption}
  onchange={(e) => { const v = e.currentTarget.value; if (v !== caption) s.commit({ op: 'shot.caption', shot: shot.id, caption: v }); }}></textarea>
{#if shot.caption?.setting || shot.caption?.mood}<div class="meta tags">{[shot.caption.setting, shot.caption.mood].filter(Boolean).join(' · ')}</div>{/if}

<style>
  textarea { margin-top: 10px; width: 100%; }
  .tags { margin-top: 6px; }
</style>
