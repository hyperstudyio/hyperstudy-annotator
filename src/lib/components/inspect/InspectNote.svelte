<script lang="ts">
  import { useSession } from '../../model/context';
  import { fmt } from '../../geometry';
  import { VALUE_KINDS } from '../../model/session.svelte';
  import type { Note } from '../../model/corrections';
  import PersonSelect from '../ui/PersonSelect.svelte';
  import ValueEditor from './ValueEditor.svelte';

  let { note: n }: { note: Note } = $props();
  const s = useSession();
  const type = $derived(s.typeOf(n.type));
  const edit = (fields: Partial<Omit<Note, 'id' | 'type'>>) => s.commit({ op: 'annotation.edit', id: n.id, fields });
</script>

<h2>{type?.name ?? 'Note'} <span class="meta normal">{type ? VALUE_KINDS[type.kind] : ''}</span></h2>
<div class="meta">{fmt(n.start)}–{fmt(n.end)} · <button class="link" onclick={() => s.playback.playClip(n)}>play</button></div>
{#if type}
  <h3>Value</h3>
  <ValueEditor {type} value={n.value} onchange={(value) => edit({ value })} />
  {#if type.target === 'person'}
    <h3>About</h3>
    <PersonSelect current={n.person ? s.root(n.person) : null} onpick={(person) => edit({ person })} allowSpecial={false} allowNew={false} placeholder="Choose a person…" label="About" />
  {/if}
{/if}
<h3>Span</h3>
<div class="row">
  <button onclick={() => edit({ start: Math.min(s.playback.time, n.end) })}>Start = playhead</button>
  <button onclick={() => edit({ end: Math.max(s.playback.time, n.start) })}>End = playhead</button>
</div>
<div class="row" style="margin-top:14px"><button onclick={async () => { await s.commit({ op: 'annotation.delete', id: n.id }); s.selection = null; }}>Delete</button></div>

<style>
  .normal { font-weight: 400; }
</style>
