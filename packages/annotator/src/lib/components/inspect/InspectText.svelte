<script lang="ts">
  import { useSession } from '../../model/context';
  import { fmt } from '../../geometry';
  import type { TextItem } from '../../types';

  let { item: x }: { item: TextItem } = $props();
  const s = useSession();
  const source = $derived((s.bundle.layers.text?.producer.config.source as string | undefined) ?? s.bundle.layers.text?.producer.models[0]?.id ?? '');
</script>

<h2>On-screen text</h2>
<div class="meta">{fmt(x.start)}–{fmt(x.end)} · <button class="link" onclick={() => s.playback.playClip(x)}>play</button></div>
<div class="quote">“{x.text}”</div>
<div class="meta">{source}</div>

<style>
  .quote { font-size: 16px; margin: 10px 0; }
</style>
