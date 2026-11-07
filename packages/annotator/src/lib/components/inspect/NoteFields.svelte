<script lang="ts">
  // What an annotation says: its value (with the keys that set it) and, for a type about a person, who: the people on
  // screen during it first, one click each, then anyone else. Shown in Inspect and in the annotation's menu on the
  // timeline, so the two never differ.
  import { useSession } from '../../model/context';
  import type { Note } from '../../model/corrections';
  import PersonSelect from '../ui/PersonSelect.svelte';
  import Swatch from '../ui/Swatch.svelte';
  import ValueEditor from './ValueEditor.svelte';

  let { note: n }: { note: Note } = $props();
  const s = useSession();
  const type = $derived(s.typeOf(n.type));
  const edit = (fields: Partial<Omit<Note, 'id' | 'type'>>) => s.commit({ op: 'annotation.edit', id: n.id, fields });
  const who = $derived(n.person ? s.root(n.person) : null);
  const onScreen = $derived(type?.target === 'person' ? s.peopleDuring(n).slice(0, 6) : []);
</script>

{#if type}
  <h3>Value</h3>
  <ValueEditor {type} value={n.value} onchange={(value) => edit({ value })} />
  {#if type.kind === 'binary'}<div class="meta keys">Keys <kbd>y</kbd> <kbd>n</kbd></div>
  {:else if type.kind === 'category' && type.options.length}<div class="meta keys">Keys <kbd>1</kbd>–<kbd>{Math.min(9, type.options.length)}</kbd>, in this order</div>{/if}
  {#if type.target === 'person'}
    <h3>About</h3>
    {#if onScreen.length}
      <div class="people" role="group" aria-label="On screen during it">
        {#each onScreen as p (p)}
          <button class="person" class:on={who === p} aria-pressed={who === p} onclick={() => edit({ person: p })}><Swatch colour={s.colourOf(p)} size={8} />{s.nameOf(p)}</button>
        {/each}
      </div>
    {/if}
    <PersonSelect current={who && !onScreen.includes(who) ? who : null} onpick={(person) => edit({ person })} allowSpecial={false} allowNew={false}
      placeholder={onScreen.length ? 'Someone else…' : 'Choose a person…'} label="About" />
  {/if}
{/if}

<style>
  .keys { margin-top: 6px; font-size: 12px; }
  .people { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
  .person { display: inline-flex; align-items: center; gap: 6px; }
</style>
