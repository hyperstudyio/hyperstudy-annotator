<script lang="ts">
  // An update found (at launch, or asked for): said once on the page in front, beside the rail's Update item, which
  // stays as the lasting reminder. It installs and relaunches from here as Settings does, and the relaunch waits as
  // there. Later puts it away until the update's next step (installed, or failed). It never takes the focus.
  import type { Updates } from '../updates.svelte';

  let { updates, show = true, holdRelaunch = null, relaunchCaution = null }: {
    updates: Updates;
    /** false on Settings (which says the same) and under a dialog; what was put away is remembered */
    show?: boolean;
    /** why the relaunch waits (a run going, or the pipeline being set up), or null */
    holdRelaunch?: string | null;
    relaunchCaution?: string | null;
  } = $props();

  const u = $derived(updates.phase);
  // what this notice is about: an update's step, or an install that failed
  const step = $derived(u.kind === 'available' || u.kind === 'downloading' || u.kind === 'ready' ? `${u.kind === 'ready' ? 'ready' : 'offer'}:${u.version}`
    : u.kind === 'failed' ? `failed:${u.op}:${u.message}` : null);
  let later = $state<string[]>([]);
  const shown = $derived(show && !!step && !later.includes(step));
</script>

{#if shown}
  <div class="notice" role="region" aria-label="Update" aria-live="polite">
    {#if u.kind === 'available'}
      <p><strong>Version {u.version} is available.</strong></p>
      <div class="actions">
        <button onclick={() => (later = [...later, step!])}>Later</button>
        <button class="primary" onclick={() => updates.install()}>Install update</button>
      </div>
    {:else if u.kind === 'downloading'}
      <p>Downloading version {u.version}{#if u.fraction != null}, {Math.round(u.fraction * 100)}%{/if}…</p>
      <div class="track" role="progressbar" aria-label="Download" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={u.fraction == null ? undefined : Math.round(u.fraction * 100)}>
        <span class="bar" class:busy={u.fraction == null} style:width={u.fraction == null ? undefined : `${u.fraction * 100}%`}></span>
      </div>
    {:else if u.kind === 'ready'}
      <p><strong>Version {u.version} is installed.</strong> Relaunch to finish: your corrections are saved.</p>
      {#if holdRelaunch}<p class="muted">{holdRelaunch}</p>{:else if relaunchCaution}<p class="caution">{relaunchCaution}</p>{/if}
      <div class="actions">
        <button onclick={() => (later = [...later, step!])}>Later</button>
        <button class="primary" onclick={() => updates.relaunch()} disabled={!!holdRelaunch}>Relaunch now</button>
      </div>
    {:else if u.kind === 'failed'}
      <p class="error">{u.op === 'check' ? 'Could not check for updates' : 'The update did not install'}: {u.message}</p>
      <div class="actions">
        <button onclick={() => (later = [...later, step!])}>Dismiss</button>
        <button onclick={() => updates.check()}>Try again</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* beside the rail's Update item, over the page's corner: small enough to leave the page usable while it is there */
  .notice { position: absolute; left: 12px; bottom: 12px; z-index: 30; width: min(340px, calc(100% - 24px));
            padding: 12px 14px; display: grid; gap: 10px;
            background: var(--color-bg-card); border: 1px solid var(--color-primary); border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, .4); }
  p { margin: 0; }
  .muted { color: var(--color-text-muted); }
  .caution { color: var(--color-caution); }
  .actions { display: flex; gap: 8px; justify-content: flex-end; }
  .track { position: relative; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, .08); overflow: hidden; }
  .bar { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; background: var(--color-primary); transition: width .3s linear; }
  .bar.busy { width: 30%; animation: slide 1.4s ease-in-out infinite alternate; }
  @keyframes slide { from { left: 0; } to { left: 70%; } }
  @media (prefers-reduced-motion: reduce) { .bar { transition: none; } .bar.busy { animation: none; } }
</style>
