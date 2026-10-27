<script lang="ts">
  // A labelled on/off switch.
  let { label, checked, onchange, disabled = false }: { label: string; checked: boolean; onchange: (on: boolean) => void; disabled?: boolean } = $props();
</script>

<label class="toggle" class:disabled>
  <input type="checkbox" {checked} {disabled} onchange={(e) => onchange(e.currentTarget.checked)} />
  <span class="switch" aria-hidden="true"></span>
  <span>{label}</span>
</label>

<style>
  .toggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
  .toggle.disabled { opacity: .5; cursor: default; }
  input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .switch { width: 30px; height: 17px; border-radius: 9px; background: #5a5a5a; position: relative; transition: background .15s; flex: none; }
  .switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: #fff; transition: left .15s; }
  input:checked + .switch { background: var(--color-primary); }
  input:checked + .switch::after { left: 15px; }
  input:focus-visible + .switch { outline: 2px solid var(--color-info); outline-offset: 2px; }
</style>
