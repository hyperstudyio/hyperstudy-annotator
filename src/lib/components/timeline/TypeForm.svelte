<script lang="ts">
  // An annotation type, in a menu on the timeline: + Type on the Annotations row makes one (or copies another video's),
  // and a type's row name opens it to edit. An edit is saved as it is made (one op each, so undo takes one back). While
  // annotations use the type, what they depend on stays as it is: its value kind, what it is about, the categories they
  // use; and it cannot be deleted (Session.usesOf).
  import { useSession, useSource } from '../../model/context';
  import { VALUE_KINDS } from '../../model/session.svelte';
  import { applyTypeFields, kindChange, newType, type AnnotationType, type TypeFields, type ValueKind } from '../../model/corrections';
  import type { TypesElsewhere } from '../../source';

  let { type, close }: { type?: AnnotationType; close: () => void } = $props();
  const s = useSession(), source = useSource();

  // a new type is kept here until it is added; an existing one is the session's
  let draft = $state<AnnotationType>({ id: '', name: '', kind: 'binary', target: 'person', options: [] });
  const t = $derived(type ? s.typeOf(type.id) ?? type : draft);
  const uses = $derived(type ? s.usesOf(type.id) : []);
  const usedValue = (o: string) => uses.filter((n) => n.value === o).length;
  let option = $state('');

  function set(fields: TypeFields) {
    if (type) s.commit({ op: 'annotation.type_edit', id: type.id, fields });
    else applyTypeFields(draft, fields);
  }
  function addOption() {
    const o = option.trim();
    if (!o || t.options.includes(o)) { option = ''; return; }
    set({ options: [...t.options, o] });
    option = '';
  }
  async function add() {
    const name = draft.name.trim();
    if (!name) { s.toast('Give the type a name'); return; }
    if (draft.kind === 'category' && draft.options.length < 2) { s.toast('List at least two categories'); return; }
    const made = newType(draft, `type:${crypto.randomUUID()}`);
    await s.addType(made);
    s.toast(`“${name}” added. Drag across its row, or press A to annotate what is selected.`);
    close();
  }
  async function remove() {
    await s.commit({ op: 'annotation.type_delete', id: type!.id });
    close();
  }

  let elsewhere = $state<TypesElsewhere | null>(null);
  $effect(() => { if (!type) source.typesElsewhere().then((x) => (elsewhere = x), (e) => s.toast(`Could not read the other videos' types: ${e}`)); });
  const have = $derived(new Set(s.S.types.map((x) => x.id)));
  async function copy(types: AnnotationType[]) {
    const missing = types.filter((x) => !have.has(x.id));
    await s.copyTypes(types);
    s.toast(missing.length === 1 ? `“${missing[0].name}” added` : `${missing.length} types added`);
    close();
  }
  const locked = $derived(uses.length > 0);
  const lockedWhy = $derived(`${uses.length} annotation${uses.length === 1 ? ' uses' : 's use'} it`);
</script>

<div class="type-form">
  <label class="field">Name
    <input type="text" placeholder="e.g. Mental state" value={t.name} aria-label="Type name"
      oninput={(e) => { if (!type) draft.name = e.currentTarget.value; }}
      onchange={(e) => { const v = e.currentTarget.value.trim(); if (type && v && v !== t.name) set({ name: v }); }}
      onkeydown={(e) => { if (e.key === 'Enter' && !type) add(); }} />
  </label>
  <label class="field">Value
    <select aria-label="Value kind" value={t.kind} disabled={locked} title={locked ? `${lockedWhy}: it stays as it is` : undefined}
      onchange={(e) => set(kindChange(e.currentTarget.value as ValueKind))}>
      {#each Object.entries(VALUE_KINDS) as [k, v] (k)}<option value={k}>{v}</option>{/each}
    </select>
  </label>
  {#if t.kind === 'category'}
    <div class="field">
      <span></span>
      <div class="options">
        {#each t.options as o (o)}
          {@const n = usedValue(o)}
          <span class="option">{o}<button class="x" aria-label={`Remove ${o}`} disabled={n > 0} title={n ? `${n} annotation${n === 1 ? ' has' : 's have'} this value` : 'Remove'}
            onclick={() => set({ options: t.options.filter((x) => x !== o) })}>×</button></span>
        {/each}
        <input type="text" class="add-option" placeholder="Add a category" aria-label="Add a category" bind:value={option}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addOption(); } }} onblur={addOption} />
      </div>
    </div>
  {:else if t.kind === 'number'}
    <div class="field">Range
      <span class="range">
        <input type="number" aria-label="Minimum" placeholder="min" value={t.min ?? ''} onchange={(e) => set({ min: e.currentTarget.value === '' ? null : Number(e.currentTarget.value) })} />
        to
        <input type="number" aria-label="Maximum" placeholder="max" value={t.max ?? ''} onchange={(e) => set({ max: e.currentTarget.value === '' ? null : Number(e.currentTarget.value) })} />
      </span>
    </div>
  {/if}
  <label class="field">About
    <select aria-label="About" value={t.target} disabled={locked} title={locked ? `${lockedWhy}: it stays as it is` : undefined}
      onchange={(e) => set({ target: e.currentTarget.value as 'person' | 'scene' })}>
      <option value="person">a person</option><option value="scene">the scene</option>
    </select>
  </label>

  {#if type}
    <div class="foot">
      <button class="link danger" disabled={locked} title={locked ? `${lockedWhy}: delete them first` : undefined} onclick={remove}>Delete type</button>
      <span class="meta">{locked ? lockedWhy : 'Not used yet'}</span>
    </div>
  {:else}
    <div class="foot"><button class="primary" onclick={add}>Add type</button></div>
    {#if elsewhere?.length}
      <div class="copy">
        <div class="meta">Or copy from another video</div>
        {#each elsewhere as v (v.key)}
          {@const missing = v.types.filter((x) => !have.has(x.id))}
          <div class="video">
            <span class="grow"><span class="title">{v.title}</span><span class="meta">{v.types.map((x) => x.name).join(', ')}</span></span>
            <button disabled={!missing.length} title={missing.length ? undefined : 'This video has them all'} onclick={() => copy(v.types)}>
              {missing.length === v.types.length ? 'Copy' : missing.length ? `Copy ${missing.length} more` : 'Copied'}
            </button>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .type-form { display: grid; gap: 8px; padding: 8px 8px 6px; font-size: 13px; }
  .field { display: grid; grid-template-columns: 52px minmax(0, 1fr); align-items: center; gap: 8px; color: var(--color-text-secondary); }
  .field input[type=text], .field select { width: 100%; }
  .options { display: flex; flex-wrap: wrap; gap: 4px; }
  .option { display: inline-flex; align-items: center; gap: 2px; padding: 1px 2px 1px 8px; border-radius: 5px; border: 1px solid var(--color-border-strong); color: var(--color-text-primary); }
  .x { background: none; border: 0; padding: 0 4px; color: var(--color-text-muted); line-height: 1; }
  .x:hover:not(:disabled) { color: var(--color-text-primary); background: none; }
  .x:disabled { opacity: .35; }
  .add-option { flex: 1; min-width: 110px; }
  .range { display: flex; align-items: center; gap: 6px; }
  .range input { width: 72px; }
  .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 4px; }
  .danger:not(:disabled) { color: var(--color-danger); }
  .copy { display: grid; gap: 4px; border-top: 1px solid var(--color-border-default); padding-top: 8px; margin-top: 2px; }
  .video { display: flex; align-items: center; gap: 8px; }
  .grow { flex: 1; min-width: 0; display: grid; }
  .title { color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .video .meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
</style>
