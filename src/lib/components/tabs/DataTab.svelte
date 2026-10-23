<script lang="ts">
  // Everything extracted for this video, including features the timeline does not draw: per layer, the stage, its
  // models and licences, the file, when it ran.
  import { useSession } from '../../model/context';
  import { fmt } from '../../geometry';
  import type { LayerBase } from '../../types';

  const s = useSession();
  const m = $derived(s.bundle.manifest);
  const size = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`);
  const layers = $derived(Object.entries(m.layers).map(([name, entry]) => ({ name, entry, doc: (s.bundle.layers as unknown as Record<string, LayerBase | null>)[name] ?? null })));
  const badge = (mode: string) => (mode === 'academic-only' ? 'academic' : mode === 'commercial-ok' ? 'commercial' : '');
</script>

<div class="meta">Everything extracted for this video, including features the timeline does not draw. Each layer is one stage's output; its licence mode is the most restrictive of its models and the layers it refers to.</div>
<div class="row meta">Video {m.video.filename ?? ''} · sha256 {m.video.sha256.slice(0, 12)}… · {m.video.width}×{m.video.height} · {fmt(m.video.duration)} · schema {m.schema_version} · {m.pipeline.name} {m.pipeline.version}{m.pipeline.git_commit ? ` (${m.pipeline.git_commit})` : ''}</div>
{#each layers as { name, entry, doc } (name)}
  <div class="stage-card">
    <div class="row" style="margin:0"><b>{name}</b> <span class="badge {badge(entry.licence_mode)}">{entry.licence_mode}</span> <span class="meta">{entry.stage}</span></div>
    <div class="meta">{entry.file} · {size(entry.bytes + (entry.side_files ?? []).reduce((a, f) => a + f.bytes, 0))}{doc?.producer.run_at ? ` · run ${doc.producer.run_at}` : ''}{doc?.producer.device ? ` · ${doc.producer.device}` : ''}</div>
    {#if doc}
      <table>
        <tbody>
          {#each doc.producer.models as model (model.id)}
            <tr><td title={model.licence ?? ''}>{model.id}{model.revision ? ` · ${model.revision}` : ''}</td><td><span class="badge {badge(model.licence_mode)}" title={model.licence ?? ''}>{model.licence_mode}</span></td></tr>
          {/each}
        </tbody>
      </table>
    {:else}<div class="meta">Not loaded by the viewer.</div>{/if}
  </div>
{/each}

<style>
  .stage-card { border: 1px solid var(--color-border-default); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 6px; }
  td { padding: 2px 0; vertical-align: top; overflow-wrap: anywhere; }
  td:last-child { text-align: right; white-space: nowrap; padding-left: 8px; }
  .badge { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--color-border-strong); color: var(--color-text-secondary); }
  .badge.academic { border-color: var(--color-caution); color: var(--color-caution); }
  .badge.commercial { border-color: var(--color-primary); color: var(--color-primary); }
</style>
