<script lang="ts">
  // Details: what this video's annotation is. The video, what may be done with it (the strictest licence among its
  // layers), what it holds, your edits (kept as you make them; a file of edits can be imported), and each layer: the
  // stage that made it, its models and their licences. What a layer's file is and when it ran are its tooltip.
  import { useSession } from '../../model/context';
  import { fmt } from '../../geometry';
  import { plural } from '../../model/session.svelte';
  import { LICENCE_TEXT } from '../../library';
  import type { LayerBase, LicenceMode } from '../../types';

  const s = useSession();
  const b = $derived(s.bundle);
  const m = $derived(b.manifest);
  const ORDER: LicenceMode[] = ['commercial-ok', 'api-terms', 'needs-review', 'academic-only'];
  const strictest = $derived(Object.values(m.layers).map((l) => l.licence_mode).reduce<LicenceMode | null>((a, x) => (!a || ORDER.indexOf(x) > ORDER.indexOf(a) ? x : a), null));
  const caution = (mode: string) => mode === 'academic-only' || mode === 'needs-review';
  const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);
  const layers = $derived(Object.entries(m.layers).map(([name, entry]) => ({ name, entry, doc: (b.layers as unknown as Record<string, LayerBase | null>)[name] ?? null })));
  const capital = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const holds = $derived([plural(b.shots.length, 'shot'), plural(b.utterances.length, 'utterance'), plural(b.faces.length, 'face track'), plural(b.sounds.length, 'sound event')]
    .filter((x) => !x.startsWith('0 ')).join(', '));
</script>

<h2>{m.video.filename ?? 'This video'}</h2>
<div class="meta">{fmt(m.video.duration)}, {m.video.width}×{m.video.height}</div>
{#if strictest}<p class="licence" class:caution={caution(strictest)}>{LICENCE_TEXT[strictest]}</p>{/if}
{#if holds}<p>{holds}.</p>{/if}

<h3>Your edits</h3>
<p>{s.ops.length ? `${plural(s.ops.length, 'edit')}, saved as you make them.` : 'None yet. Edits are saved as you make them.'}</p>
<div class="row"><button class="link" onclick={() => s.importEdits?.()}>Import edits from a file…</button></div>

<h3>Layers</h3>
<ul class="layers">
  {#each layers as { name, entry, doc } (name)}
    <li title={`${entry.file}, ${size(entry.bytes + (entry.side_files ?? []).reduce((a, f) => a + f.bytes, 0))}${doc?.producer.run_at ? `, run ${doc.producer.run_at}` : ''}${doc?.producer.device ? ` on ${doc.producer.device}` : ''}`}>
      <div class="top"><span class="name">{capital(name)}</span><span class="mode" class:caution={caution(entry.licence_mode)}>{LICENCE_TEXT[entry.licence_mode as LicenceMode] ?? entry.licence_mode}</span></div>
      {#if doc?.producer.models.length}<div class="meta">{doc.producer.models.map((x) => x.id).join(', ')}</div>
      {:else}<div class="meta">{entry.stage}</div>{/if}
    </li>
  {/each}
</ul>

<p class="meta foot">{m.pipeline.name} {m.pipeline.version}{m.pipeline.git_commit ? ` (${m.pipeline.git_commit.slice(0, 7)})` : ''}, schema {m.schema_version}. Video sha256 {m.video.sha256.slice(0, 12)}…</p>

<style>
  p { margin: 6px 0; }
  .licence { color: var(--color-text-secondary); }
  .caution { color: var(--color-caution); }
  .layers { list-style: none; margin: 0; padding: 0; }
  .layers li { padding: 7px 0; border-top: 1px solid var(--color-border-default); }
  .layers li:first-child { border-top: 0; }
  .top { display: flex; justify-content: space-between; gap: 10px; }
  .name { font-weight: 500; }
  .mode { font-size: 12px; color: var(--color-text-muted); white-space: nowrap; }
  .layers .meta { font-size: 12px; overflow-wrap: anywhere; }
  .foot { margin-top: 18px; font-size: 11.5px; }
</style>
