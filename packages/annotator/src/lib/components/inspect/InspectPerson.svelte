<script lang="ts">
  import { useSession } from '../../model/context';
  import { fmt } from '../../geometry';
  import { NOT_PERSON, UNKNOWN } from '../../model/corrections';
  import { coVisible, plural } from '../../model/session.svelte';
  import Crop from '../ui/Crop.svelte';
  import Swatch from '../ui/Swatch.svelte';
  import ColourPick from '../ui/ColourPick.svelte';
  import Name from '../ui/Name.svelte';
  import PersonSelect from '../ui/PersonSelect.svelte';

  let { person: p }: { person: string } = $props();
  const s = useSession();
  const tracks = $derived(s.tracksOf.get(p) ?? []);
  const secs = $derived(tracks.reduce((a, t) => a + t.end - t.start, 0));
  const crop = $derived(s.cropOf(p));
  const suggestions = $derived(s.queue.pairs.filter((q) => q.a === p || q.b === p).slice(0, 4));
  const sameName = $derived(s.special(p) ? [] : s.people.filter((q) => q !== p && !s.special(q) && s.nameOf(q) === s.nameOf(p)));
  const clashes = $derived(s.special(p) ? [] : coVisible(tracks).slice(0, 3));
  const rename = (name: string) => s.commit({ op: 'person.rename', person: p, name });
  async function merge(into: string) {
    const from = s.nameOf(p);
    await s.commit({ op: 'person.merge', from: p, into });
    s.select('person', s.root(into), { seek: false });
    s.toast(`Merged ${from} into ${s.nameOf(s.root(into))}`);
  }
  async function notPerson() {
    const name = s.nameOf(p);
    await s.commit({ op: 'person.not_person', person: p });
    s.toast(`${name} marked as not a person`);
    s.select('person', NOT_PERSON, { seek: false });
  }
</script>

<div class="row">
  {#if crop}<Crop path={crop} size="lg" label="Show every track of this person" onclick={() => (s.lightbox = { kind: 'person', person: p })} />
  {:else}<Swatch colour={s.colourOf(p)} size={28} />{/if}
  <div style="min-width:0; flex:1">
    <h2 class="named">{#if !s.special(p)}<ColourPick id={p} colour={s.colourOf(p)} size={14} label={`${s.nameOf(p)}'s colour`} />{/if}<Name text={s.nameOf(p)} id={p} area="panel" onrename={s.special(p) ? undefined : rename} /></h2>
    <div class="meta">
      {secs.toFixed(1)} s on screen{#if s.S.names[p] && s.isMachinePerson(p)} · machine label {p.slice(7)}{/if}
      {#if !s.special(p)} · <button class="link" onclick={() => (s.renaming = `${p}@panel`)}>rename</button>{/if}
    </div>
  </div>
</div>
{#each clashes as [a, b] (a.id + b.id)}
  <div class="callout">
    Two of {s.nameOf(p)}'s faces are on screen together in shot {(s.bundle.shotNumber(a.shot) ?? 0) + 1} ({fmt(Math.max(a.start, b.start))}), so one of them is someone else, probably from a merge.
    <button class="link" onclick={() => s.select('face', a.id)}>track {a.id.slice(5)}</button> · <button class="link" onclick={() => s.select('face', b.id)}>track {b.id.slice(5)}</button>
  </div>
{/each}
{#if p === UNKNOWN}<div class="callout">Faces the clustering could not match to anyone. Open each track to assign it.</div>{/if}
{#if p === NOT_PERSON}<div class="callout">Detections that are not a person: false detections, or faces in pictures and on screens.</div>{/if}
{#if !s.special(p)}
  {#each sameName as q (q)}
    <div class="callout info">
      {s.machineLabel(q)} is also named {s.nameOf(p)}. <button class="link" onclick={() => (s.lightbox = { kind: 'compare', a: p, b: q })}>Compare</button> or
      <button class="link" onclick={async () => { await s.commit({ op: 'person.merge', from: q, into: p }); s.toast(`Merged ${s.machineLabel(q)} into ${s.nameOf(p)}`); }}>merge them</button>
    </div>
  {/each}
  <div class="row actions">
    <PersonSelect current={null} onpick={merge} allowSpecial={false} allowNew={false} placeholder="Same person as…" label="Same person as" />
    <button class="plain" onclick={notPerson} title="A false detection, or a face in a picture or on a screen">Not a person</button>
  </div>
  {#if suggestions.length}
    <div class="list">
      {#each suggestions as q (q.a + q.b)}
        {@const other = q.a === p ? q.b : q.a}
        {@const oc = s.cropOf(other)}
        <div class="item">
          {#if oc}<Crop path={oc} size="sm" label="Compare side by side" onclick={() => (s.lightbox = { kind: 'compare', a: p, b: other })} />{/if}
          <span class="grow" title={`ArcFace distance ${q.distance}`}>{s.nameOf(other)} looks similar</span>
          <button onclick={() => (s.lightbox = { kind: 'compare', a: p, b: other })}>Compare</button>
          <button onclick={() => s.commit({ op: 'person.distinct', a: p, b: other })}>Different</button>
        </div>
      {/each}
    </div>
  {/if}
{/if}
<h3>{plural(tracks.length, 'appearance')}</h3>
<!-- each track as its face, in time order: a face that is someone else stands out among the rest -->
<div class="strip">
  {#each tracks as t (t.id)}
    <button class="face" class:done={!s.includedFace(t)} onclick={() => s.select('face', t.id)} title={`${fmt(t.start)}–${fmt(t.end)} · shot ${(s.bundle.shotNumber(t.shot) ?? 0) + 1}`}>
      {#if t.crop}<Crop path={t.crop} size="sm" />{:else}<span class="time">{fmt(t.start)}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .named { display: flex; align-items: center; gap: 8px; }
  .actions { margin-top: 14px; }
  .strip { display: flex; flex-wrap: wrap; gap: 6px; }
  .face { padding: 0; border: 1px solid transparent; border-radius: 6px; background: none; line-height: 0; }
  .face:hover { border-color: var(--color-text-muted); }
  .face.done { opacity: .45; }
  .time { display: inline-block; line-height: 1; padding: 8px; font-size: 11px; color: var(--color-text-muted); background: var(--color-bg-elevated); border-radius: 6px; }
</style>
