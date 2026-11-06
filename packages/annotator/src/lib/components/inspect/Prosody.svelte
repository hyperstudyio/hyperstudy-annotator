<script lang="ts">
  // What the prosody stage measured for an utterance, every emotion model's reading, and the delivery captions.
  import { useSession } from '../../model/context';
  import { ENDING, captionModelName, captionTags, shortModel } from '../../timeline/rows';
  import type { Utterance } from '../../types';

  let { u }: { u: Utterance } = $props();
  const s = useSession();
  const PROMINENT = 1.0;   // a word this many SDs above its speaker's typical f0/intensity/duration mix is highlighted
  const P = $derived(s.bundle.layers.prosody);
  const p = $derived(s.bundle.prosodyOf.get(u.id));
  const num = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '–' : Number(v).toFixed(d));
  const rows = $derived.by(() => {
    if (!p || !P) return [];
    const m = p.measures;
    const out: [string, string][] = [
      ['Speaker (for pitch)', `${p.speaker ?? '–'} (${(p.speaker_source ?? '').replaceAll('_', ' ')})`],
      ['Ending', m.final_movement ? `${ENDING[m.final_movement]} ${m.final_movement}, ${num(m.final_delta_st)} st` : '–'],
      ['Pitch', `median ${num(m.f0_median_hz, 0)} Hz · range ${num(m.f0_range_st)} st`],
      ['Rate', `${num(m.speech_rate_syl_s)} syllables/s · ${m.internal_pauses ?? 0} pause(s) · ${num(m.pause_before_s, 2)} s before`],
      ['Voice', `${num(m.intensity_db, 0)} dB · HNR ${num(m.hnr_db)} dB · jitter ${num(m.jitter_local == null ? null : m.jitter_local * 100)}% · shimmer ${num(m.shimmer_local == null ? null : m.shimmer_local * 100)}%`],
    ];
    for (const [key, meta] of Object.entries(P.emotion_models)) {
      const e = p.emotion[key] as Record<string, unknown> | undefined;
      if (!e) continue;
      if (meta.kind === 'dimensional') out.push([shortModel(meta.model), `arousal ${num(e.arousal as number, 2)} · valence ${num(e.valence as number, 2)} · dominance ${num(e.dominance as number, 2)}`]);
      else if (typeof e.top === 'string') out.push([shortModel(meta.model), `${e.top} (${num(e.top_score as number, 2)})`]);
    }
    return out;
  });
</script>

{#if p && P}
  <h3>Prosody</h3>
  <table class="prosody-table">
    <tbody>{#each rows as [k, v] (k)}<tr><th>{k}</th><td>{v}</td></tr>{/each}</tbody>
  </table>
  {#if p.words.length}
    <div class="meta">Stressed words (highlighted, measured):</div>
    <div class="prosody-words">
      {#each p.words as w, i (i)}<span class:prominent={w.prominence != null && w.prominence >= PROMINENT} title={w.prominence == null ? 'no voiced frames' : `prominence ${w.prominence}`}>{w.word}</span>{' '}{/each}
    </div>
  {/if}
  {#each Object.entries(p.captions) as [key, c] (key)}
    <div class="prosody-caption">
      <div class="meta">{captionModelName(key)} · suggestion, not checked</div>
      <div>{c.description || '(no description)'}</div>
      <div class="tags">{#each captionTags(c) as t (t)}<span class="tag">{t}</span>{/each}</div>
    </div>
  {/each}
{/if}

<style>
  .prosody-table { border-collapse: collapse; width: 100%; margin: 4px 0 8px; }
  th { text-align: left; font-weight: 500; color: var(--color-text-muted); padding: 2px 8px 2px 0; white-space: nowrap; vertical-align: top; }
  td { padding: 2px 0; }
  .prosody-words { margin: 2px 0 8px; line-height: 1.7; }
  .prominent { background: var(--color-caution-light); color: var(--color-caution); border-radius: 3px; padding: 0 2px; }
  .prosody-caption { border: 1px solid var(--color-border-default); border-radius: 6px; padding: 6px 8px; margin: 6px 0; }
  .tags { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px; }
  .tag { background: var(--color-bg-card); border-radius: 4px; padding: 0 6px; font-size: 12px; color: var(--color-text-secondary); }
</style>
