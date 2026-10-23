<script lang="ts">
  // A crop from the bundle's assets (a face or object picture), optionally a button.
  import { useSession } from '../../model/context';
  let { path, size = 'md', label, onclick }: { path: string; size?: 'lg' | 'md' | 'sm' | 'xs' | 'row'; label?: string; onclick?: (e: MouseEvent) => void } = $props();
  const s = useSession();
</script>

{#if onclick}
  <button class="crop-button {size}" type="button" aria-label={label ?? 'Enlarge'} title={label} {onclick}><img class="crop {size}" src={s.asset(path)} alt="" loading="lazy" /></button>
{:else}
  <img class="crop {size}" src={s.asset(path)} alt="" loading="lazy" />
{/if}

<style>
  .crop-button { padding: 0; border: 0; background: none; border-radius: 8px; cursor: zoom-in; flex: none; line-height: 0; }
  .crop { object-fit: cover; background: var(--color-bg-card); flex: none; display: block; }
  .lg { width: 96px; height: 96px; border-radius: 8px; }
  .md { width: 64px; height: 64px; border-radius: 8px; }
  .sm { width: 36px; height: 36px; border-radius: 6px; }
  .xs { width: 24px; height: 24px; border-radius: 4px; }
  .row { width: 20px; height: 20px; border-radius: 4px; }
</style>
