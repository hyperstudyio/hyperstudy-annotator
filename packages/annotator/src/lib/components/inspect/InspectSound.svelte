<script lang="ts">
  import { useSession } from '../../model/context';
  import { fmt } from '../../geometry';
  import type { SoundEvent } from '../../types';

  let { sound: x }: { sound: SoundEvent } = $props();
  const s = useSession();
  const peers = $derived(s.bundle.sounds.filter((y) => y.label === x.label).length);
</script>

<h2>Sound: {x.label}</h2>
<div class="meta">{fmt(x.start)}–{fmt(x.end)} · <button class="link" onclick={() => s.playback.playClip(x)}>play</button></div>
<h3>Evidence</h3>
<div>Reported by {x.sources.join(' and ')}{x.score !== null ? ` (peak ${x.score.toFixed(2)})` : ''}.</div>
{#if x.agreement === false}<div class="callout">Only PE-A-Frame reports this. It also reports sounds that are absent, so listen before keeping it.</div>{/if}
{#if x.agreement === true}<div class="meta">An AudioSet tagger agrees.</div>{/if}
