<script lang="ts">
  import { useSession } from '../../model/context';
  import { fmt } from '../../geometry';
  import type { Speaker, Utterance } from '../../types';
  import Toggle from '../ui/Toggle.svelte';
  import Crop from '../ui/Crop.svelte';
  import Swatch from '../ui/Swatch.svelte';
  import Prosody from './Prosody.svelte';

  let { u }: { u: Utterance } = $props();
  const s = useSession();
  const sp = $derived(s.speakerOf(u));
  const pred = $derived(s.bundle.prediction.get(u.id) ?? null);
  const text = $derived(s.uttText(u));
  const same = (c: Speaker) => JSON.stringify(c) === JSON.stringify(sp);
  const evidence = $derived.by(() => {
    const out: string[] = [];
    const p = s.predicted(u);
    if (p.kind === 'face') out.push(`predicted ${s.speakerName(p)} (gap to next face ${pred?.margin?.toFixed(2) ?? '–'})`);
    else if (p.kind === 'person') out.push(`no visible face scored as speaking; the voice ${s.voiceName(u.voice)} is linked to ${s.speakerName(p)}`);
    else out.push(`no visible face scored as speaking; diarized voice ${s.voiceName(u.voice)}`);
    if (pred?.second_opinion_agrees === false) out.push('TalkNet picks a different face');
    return out.join(' · ');
  });
  function offscreen(v: string) {
    if (!v) return;
    s.setSpeaker(u, v.startsWith('voice:') ? { kind: 'offscreen', voice: v } : { kind: 'person', person: v.slice('person='.length) });
  }
</script>

<h2>Utterance {#if s.uncertain(u) && !s.reviewed(u)}<span class="flag">needs review</span>{/if}</h2>
<div class="meta">{fmt(u.start)}–{fmt(u.end)} · shot {(s.bundle.shotNumber(u.shot) ?? 0) + 1} · <button class="link" onclick={() => s.playback.playClip(u)}>play clip (⇧space)</button></div>
<h3>Transcript</h3>
<textarea aria-label="Transcript" value={text} onchange={(e) => { const v = e.currentTarget.value; if (v !== text) s.commit({ op: 'utterance.text', utt: u.id, text: v }); }}></textarea>
<h3>Who is speaking?</h3>
<div class="meta">{evidence}</div>
<div class="list" style="margin-top:6px">
  {#each (pred?.candidates ?? []).slice(0, 9) as c, i (c.face)}
    {@const t = s.bundle.face.get(c.face)}
    {@const choice = { kind: 'face', face: c.face } as Speaker}
    <button class="item" class:selected={same(choice)} onclick={() => s.setSpeaker(u, choice)}>
      <kbd>{i + 1}</kbd>
      {#if t?.crop}<Crop path={t.crop} size="xs" />{:else}<Swatch colour={s.colourOf(t ? s.personOf(t) : null)} />{/if}
      <span class="grow">{t ? s.nameOf(s.personOf(t)) : c.face}</span>
      <span class="meta">score {c.score.toFixed(1)}</span>
    </button>
  {:else}
    <div class="empty">No face is on screen long enough to score.</div>
  {/each}
</div>
<div class="row">
  <select aria-label="Someone not on screen" onchange={(e) => { offscreen(e.currentTarget.value); e.currentTarget.blur(); }}>
    <option value="">Someone not on screen…</option>
    <optgroup label="Off-screen voices">
      {#each s.bundle.voices as v (v)}<option value={v} selected={sp.kind === 'offscreen' && sp.voice === v}>{s.voiceName(v)}</option>{/each}
    </optgroup>
    <optgroup label="A known person, off camera">
      {#each s.people.filter((p) => !s.special(p)) as p (p)}<option value={`person=${p}`} selected={sp.kind === 'person' && s.root(sp.person) === p}>{s.nameOf(p)}</option>{/each}
    </optgroup>
  </select>
  <span class="meta"><kbd>o</kbd> diarized voice</span>
</div>
<div class="choice">
  <button class:on={sp.kind === 'multiple'} onclick={() => s.setSpeaker(u, { kind: 'multiple' })}><kbd>m</kbd> Several</button>
  <button class:on={sp.kind === 'unsure'} onclick={() => s.setSpeaker(u, { kind: 'unsure' })}><kbd>u</kbd> Unsure</button>
  <button class:on={sp.kind === 'not_speech'} onclick={() => s.setSpeaker(u, { kind: 'not_speech' })}><kbd>x</kbd> Not speech</button>
</div>
{#if s.reviewed(u)}
  <div class="row"><span class="meta">Set by you: {s.speakerName(sp)}</span><button onclick={() => s.commit({ op: 'utterance.speaker', utt: u.id, speaker: null })}>Back to prediction</button></div>
{/if}
<label class="row"><input type="checkbox" bind:checked={s.autoAdvance} /> After choosing, go to the next uncertain utterance</label>
<div class="row"><Toggle label="Send this utterance to agents" checked={s.includedId(u.id)} onchange={(v) => s.commit({ op: 'entity.include', id: u.id, included: v })} /></div>
<Prosody {u} />
