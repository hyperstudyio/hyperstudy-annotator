<script lang="ts">
  // A checkbox shown as a pill (overlay layers, timeline groups).
  let { label, checked, onchange, disabled = false, title }: { label: string; checked: boolean; onchange: (on: boolean) => void; disabled?: boolean; title?: string } = $props();
</script>

<label class="chip" class:on={checked && !disabled} class:disabled {title}>
  <input type="checkbox" checked={checked && !disabled} {disabled} onchange={(e) => { onchange(e.currentTarget.checked); e.currentTarget.blur(); }} />
  {label}
</label>

<style>
  .chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border: 1px solid var(--color-border-strong); border-radius: 999px; cursor: pointer; user-select: none; font-size: 12px; white-space: nowrap; }
  .chip.on { border-color: var(--color-primary); background: var(--color-primary-light); color: var(--color-text-primary); }
  .chip.disabled { opacity: .45; cursor: default; }
  input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .chip:has(input:focus-visible) { outline: 2px solid var(--color-info); outline-offset: 1px; }
</style>
