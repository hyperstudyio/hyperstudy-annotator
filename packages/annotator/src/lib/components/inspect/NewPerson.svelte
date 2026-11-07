<script lang="ts">
  // Name a new person; the caller commits it with whatever it is for.
  let { oncreate }: { oncreate: (name: string) => void } = $props();
  let name = $state('');
  let input = $state<HTMLInputElement>();
  $effect(() => { input?.focus(); });
  const go = () => { const v = name.trim(); if (v) oncreate(v); };
</script>

<div class="row">
  <input bind:this={input} type="text" placeholder="Name for the new person" aria-label="Name for the new person" bind:value={name}
    onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') go(); }} />
  <button class="primary" onclick={go}>Create</button>
</div>
