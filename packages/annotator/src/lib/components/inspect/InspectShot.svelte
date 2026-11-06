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
<div class="meta">{fmt(shot.start)}–{fmt(shot.end)} <button class="link" onclick={() => s.playback.playClip(shot)}>Play</button></div>
<h3 title={`Written by ${model}`}>Caption</h3>
<textarea rows="6" aria-label="Shot caption" value={caption}
  onchange={(e) => { const v = e.currentTarget.value; if (v !== caption) s.commit({ op: 'shot.caption', shot: shot.id, caption: v }); }}></textarea>
{#if shot.caption?.setting}<div class="meta">Setting: {shot.caption.setting}</div>{/if}
{#if shot.caption?.mood}<div class="meta">Mood: {shot.caption.mood}</div>{/if}
