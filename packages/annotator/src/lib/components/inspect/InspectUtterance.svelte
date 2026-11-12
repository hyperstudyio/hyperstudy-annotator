<script lang="ts">
  import { useSession } from '../../model/context';
  import { fmt } from '../../geometry';
  import type { Speaker, Utterance } from '../../types';
  import { NEUTRAL } from '../../model/session.svelte';
  import Crop from '../ui/Crop.svelte';
  import Swatch from '../ui/Swatch.svelte';
  import Prosody from './Prosody.svelte';
  import Details from './Details.svelte';
  import { ENDING } from '../../timeline/rows';

  let { u }: { u: Utterance } = $props();
  const s = useSession();
  const sp = $derived(s.speakerOf(u));
  const pred = $derived(s.bundle.prediction.get(u.id) ?? null);
  const text = $derived(s.uttText(u));
  const evidence = $derived.by(() => {
    const out: string[] = [];
    const p = s.predicted(u);
    if (p.kind === 'face') out.push(`predicted ${s.speakerName(p)} (gap to next face ${pred?.margin?.toFixed(2) ?? '–'})`);
    else if (p.kind === 'person') out.push(`no visible face scored as speaking; the voice ${s.voiceName(u.voice)} is linked to ${s.speakerName(p)}`);
    else out.push(`no visible face scored as speaking; diarized voice ${s.voiceName(u.voice)}`);
    if (pred?.second_opinion_agrees === false) out.push('TalkNet picks a different face');
    return out.join(' · ');
  });
  /** The Other… menu: not one person, an off-screen voice, or a known person off camera. */
  function other(v: string) {
    if (!v) return;
    if (v === 'multiple' || v === 'unsure' || v === 'not_speech') s.setSpeaker(u, { kind: v });
    else s.setSpeaker(u, v.startsWith('voice:') ? { kind: 'offscreen', voice: v } : { kind: 'person', person: v.slice('person='.length) });
  }
  const candidates = $derived((pred?.candidates ?? []).slice(0, 9));
  // a speaker none of the faces' chips shows: Other… shows it
  const byOther = $derived(sp.kind !== 'face' || !candidates.some((c) => c.face === sp.face));
  const p = $derived(s.bundle.prosodyOf.get(u.id));
  const glance = $derived.by(() => {
    const m = p?.measures;
    return [m?.final_movement && `${ENDING[m.final_movement]} ${m.final_movement}`, m?.speech_rate_syl_s != null && `${m.speech_rate_syl_s.toFixed(1)} syllables/s`]
      .filter(Boolean).join(', ');
  });
</script>

<div class="head">
  <Swatch colour={s.speakerColour(sp) ?? NEUTRAL} size={12} />
  <h2>{s.speakerName(sp)}</h2>
  {#if s.uncertain(u) && !s.reviewed(u)}<span class="flag">needs review</span>{/if}
</div>
<div class="meta">{fmt(u.start)}–{fmt(u.end)} · shot {(s.bundle.shotNumber(u.shot) ?? 0) + 1} · <button class="link" onclick={() => s.playback.playClip(u)} title="Play it (⇧Space)">play</button></div>
<textarea aria-label="Transcript" rows="3" value={text} onchange={(e) => { const v = e.currentTarget.value; if (v !== text) s.commit({ op: 'utterance.text', utt: u.id, text: v }); }}></textarea>

<!-- who speaks: the faces on screen, most likely first, each with its key; anyone else in Other… -->
<div class="speakers" role="group" aria-label="Who is speaking">
  {#each candidates as c, i (c.face)}
    {@const t = s.bundle.face.get(c.face)}
    {@const choice = { kind: 'face', face: c.face } as Speaker}
    {@const name = t ? s.nameOf(s.personOf(t)) : c.face}
    {@const is = sp.kind === 'face' && sp.face === c.face}
    <!-- the speaker: set by you (solid), or the prediction (dashed) -->
    <button class="chip" class:on={is && s.reviewed(u)} class:predicted={is && !s.reviewed(u)} aria-pressed={is}
      onclick={() => s.setSpeaker(u, choice)} title={`${name} · speaking score ${c.score.toFixed(1)}${is && !s.reviewed(u) ? ' · predicted' : ''} · key ${i + 1}`}>
      {#if t?.crop}<Crop path={t.crop} size="xs" />{:else}<Swatch colour={s.colourOf(t ? s.personOf(t) : null)} />{/if}
      <span class="name">{name}</span><kbd>{i + 1}</kbd>
    </button>
  {/each}
  <select class="other" class:on={byOther && s.reviewed(u)} aria-label="Someone else is speaking" onchange={(e) => { other(e.currentTarget.value); e.currentTarget.blur(); }}>
    <option value="" selected={!byOther}>Other…</option>
    <optgroup label="Not one person">
      <option value="multiple" selected={sp.kind === 'multiple'}>Several (m)</option>
      <option value="unsure" selected={sp.kind === 'unsure'}>Unsure (u)</option>
      <option value="not_speech" selected={sp.kind === 'not_speech'}>Not speech (x)</option>
    </optgroup>
    <optgroup label="Off-screen voice (o)">
      {#each s.bundle.voices as v (v)}<option value={v} selected={sp.kind === 'offscreen' && sp.voice === v}>{s.voiceName(v)}</option>{/each}
    </optgroup>
    <optgroup label="Someone off camera">
      {#each s.people.filter((q) => !s.special(q)) as q (q)}<option value={`person=${q}`} selected={sp.kind === 'person' && s.root(sp.person) === q}>{s.nameOf(q)}</option>{/each}
    </optgroup>
  </select>
</div>
{#if !candidates.length}<div class="meta">No face is on screen long enough to score.</div>{/if}
{#if s.reviewed(u)}<div class="meta">Set by you · <button class="link" onclick={() => s.commit({ op: 'utterance.speaker', utt: u.id, speaker: null })}>back to the prediction</button></div>{/if}

<Details kind="utt" summary={glance}>
  <div class="meta">{evidence}</div>
  <Prosody {u} />
</Details>

<style>
  .head { display: flex; align-items: center; gap: 8px; }
  .head h2 { margin: 0; }
  textarea { margin-top: 10px; width: 100%; }
  .speakers { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; align-items: center; }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px 3px 3px; border-radius: 6px; max-width: 100%;
          background: var(--color-bg-elevated); border: 1px solid var(--color-border-default); color: var(--color-text-primary); }
  .chip:hover { background: var(--color-bg-hover); }
  .chip.on { border-color: var(--color-primary); background: var(--color-primary-light); }
  .chip.predicted { border: 1px dashed var(--color-text-secondary); }
  .chip .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip kbd { font-size: 10px; color: var(--color-text-muted); }
  .other.on { border-color: var(--color-primary); }
</style>
