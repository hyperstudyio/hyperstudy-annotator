<script lang="ts">
  import { useSession } from '../../model/context';
  import { fmt } from '../../geometry';
  import { VALUE_KINDS } from '../../model/session.svelte';
  import type { AnnotationType, ValueKind } from '../../model/corrections';

  const s = useSession();
  let name = $state(''), kind = $state<ValueKind>('binary'), options = $state(''), min = $state(''), max = $state(''), target = $state<'person' | 'scene'>('person');
  const notes = $derived([...s.S.notes.values()].sort((a, b) => a.start - b.start));
  $effect(() => { if (!s.activeType || !s.typeOf(s.activeType)) s.activeType = s.S.types[0]?.id ?? null; });
  const span = $derived(s.selection && s.selection.kind !== 'person' && s.selection.kind !== 'note' && s.selection.kind !== 'objid' ? s.spanOf(s.selection) : null);
  const WHAT: Record<string, string> = { utt: 'utterance', face: 'face track', sound: 'sound', text: 'text', shot: 'shot', object: 'object', gesture: 'gesture', facing: 'facing event', gaze: 'gaze event' };
  const stop = (e: KeyboardEvent) => e.stopPropagation();

  async function addType() {
    const n = name.trim();
    if (!n) { s.toast('Give the type a name'); return; }
    const opts = options.split(',').map((x) => x.trim()).filter(Boolean);
    if (kind === 'category' && opts.length < 2) { s.toast('List at least two categories'); return; }
    const type: AnnotationType = { id: `type:${Date.now()}`, name: n, kind, target, options: kind === 'category' ? opts : [] };
    if (kind === 'number') { if (min !== '') type.min = Number(min); if (max !== '') type.max = Number(max); }
    s.activeType = type.id;
    if (s.view.s.collapsed.includes('annotations')) s.view.toggleCollapsed('annotations');
    s.view.setGroupShown('annotations', true);
    await s.commit({ op: 'annotation.type', type });
    s.toast(`“${n}” is now a timeline row. Drag across it to annotate.`);
    name = ''; options = ''; min = ''; max = '';
  }
  function annotateShot() {
    const shot = s.bundle.shotAt(s.playback.time);
    if (shot && s.activeType) s.addNote(s.activeType, shot.start, shot.end);
  }
</script>

<div class="meta">Your own annotations, kept apart from what the pipeline found.</div>
{#if s.S.types.length}
  <h3>Add an annotation</h3>
  <div class="list">
    <div class="row">Type
      <select aria-label="Annotation type" value={s.activeType} onchange={(e) => (s.activeType = e.currentTarget.value)}>
        {#each s.S.types as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
      </select>
    </div>
    <div class="row">
      {#if span && s.selection}<button class="primary" onclick={() => s.activeType && s.addNote(s.activeType, span.start, span.end)}>Annotate the selected {WHAT[s.selection.kind]} ({fmt(span.start)}–{fmt(span.end)})</button>{/if}
      <button class:primary={!span} onclick={annotateShot}>Annotate the current shot</button>
    </div>
    <div class="meta">Or drag across the type’s row in the timeline, or press <kbd>[</kbd> and <kbd>]</kbd> at the start and end while playing.</div>
  </div>
{/if}
<h3>Annotations · {notes.length}</h3>
{#if notes.length}
  <div class="list">
    {#each notes as n (n.id)}
      <button class="item" class:selected={s.isSel('note', n.id)} onclick={() => s.select('note', n.id)}>
        <span class="meta">{fmt(n.start)}</span>
        <span class="grow">{s.typeOf(n.type)?.name}: {s.noteValue(n)}{n.person ? ` (${s.nameOf(s.root(n.person))})` : ''}</span>
      </button>
    {/each}
  </div>
{:else}<div class="empty">{s.S.types.length ? 'None yet.' : 'Add a type first.'}</div>{/if}
{#if s.S.types.length}
  <h3>Types</h3>
  <div class="list">
    {#each s.S.types as t (t.id)}
      <div class="item"><span class="grow">{t.name}</span><span class="meta">{VALUE_KINDS[t.kind]}{t.kind === 'category' ? `: ${t.options.join(', ')}` : ''} · {t.target}</span></div>
    {/each}
  </div>
{/if}
<h3>New type</h3>
<div class="row"><input type="text" placeholder="Name, e.g. Mental state" aria-label="Type name" style="flex:1" bind:value={name} onkeydown={stop} /></div>
<div class="row">Value
  <select aria-label="Value kind" bind:value={kind}>{#each Object.entries(VALUE_KINDS) as [k, v] (k)}<option value={k}>{v}</option>{/each}</select>
  <select aria-label="About" bind:value={target}><option value="person">about a person</option><option value="scene">about the scene</option></select>
</div>
{#if kind === 'category'}<div class="row"><input type="text" placeholder="Categories, comma separated" aria-label="Categories" style="flex:1" bind:value={options} onkeydown={stop} /></div>{/if}
{#if kind === 'number'}
  <div class="row">Range (optional)
    <input type="number" placeholder="min" aria-label="Minimum" style="width:80px" bind:value={min} onkeydown={stop} />
    <input type="number" placeholder="max" aria-label="Maximum" style="width:80px" bind:value={max} onkeydown={stop} />
  </div>
{/if}
<div class="row"><button onclick={addType}>Add type</button></div>
