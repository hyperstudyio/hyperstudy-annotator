<script lang="ts">
  // Short confirmations ("Undone", "Merged A into B"), shown for a moment at the bottom of the window.
  import { useSession } from '../model/context';
  const s = useSession();
  let shown = $state(false);
  $effect(() => {
    if (!s.message) return;
    void s.message.n;
    shown = true;
    const id = setTimeout(() => (shown = false), 2400);   // a display duration, not a synchronisation delay
    return () => clearTimeout(id);
  });
</script>

<div class="toast" class:show={shown} role="status" aria-live="polite">{s.message?.text ?? ''}</div>

<style>
  .toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: var(--color-bg-card); border: 1px solid var(--color-border-strong);
           padding: 8px 14px; border-radius: 8px; opacity: 0; transition: opacity .2s; pointer-events: none; z-index: 40; }
  .show { opacity: 1; }
</style>
