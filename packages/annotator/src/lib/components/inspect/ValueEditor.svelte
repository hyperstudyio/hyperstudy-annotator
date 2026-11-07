<script lang="ts">
  import type { AnnotationType, Note } from '../../model/corrections';
  let { type, value, onchange }: { type: AnnotationType; value: Note['value']; onchange: (v: Note['value']) => void } = $props();
</script>

{#if type.kind === 'binary'}
  <div class="choice"><button class:on={value === true} onclick={() => onchange(true)}>Yes</button><button class:on={value === false} onclick={() => onchange(false)}>No</button></div>
{:else if type.kind === 'category'}
  <div class="choice">{#each type.options as o (o)}<button class:on={value === o} onclick={() => onchange(o)}>{o}</button>{/each}</div>
{:else if type.kind === 'number'}
  <div class="row">
    <input type="number" aria-label="Value" style="width:120px" step="any" value={value ?? ''} min={type.min} max={type.max}
      onkeydown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }} onchange={(e) => onchange(e.currentTarget.value === '' ? null : Number(e.currentTarget.value))} />
    {#if type.min !== undefined || type.max !== undefined}<span class="meta">range {type.min ?? '…'} to {type.max ?? '…'}</span>{/if}
  </div>
{:else}
  <textarea aria-label="Value" value={(value as string | null) ?? ''} onchange={(e) => onchange(e.currentTarget.value)}></textarea>
{/if}
