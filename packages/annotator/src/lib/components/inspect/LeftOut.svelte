<script lang="ts">
  // What an earlier edit left out of what agents receive (the annotator no longer decides that; Review's "Not there"
  // still marks a sound), said where the thing is shown, with the edit that puts it back (Session.leftOut).
  import { useSession } from '../../model/context';
  import type { Selection } from '../../model/session.svelte';

  let { sel }: { sel: Selection } = $props();
  const s = useSession();
  const out = $derived(s.leftOut(sel));
</script>

{#if out}<p class="left-out">{out.why} <button class="link" onclick={() => s.commit(out.putBack)}>{out.action ?? 'Put back'}</button></p>{/if}

<style>
  .left-out { margin: 0 0 10px; padding: 6px 8px; border-radius: 6px; background: var(--color-caution-light); }
</style>
