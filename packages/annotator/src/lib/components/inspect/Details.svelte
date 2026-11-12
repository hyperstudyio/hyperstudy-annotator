<script lang="ts">
  // What the models measured about the selection, below what it asks you to decide: closed until opened, and kept open
  // or closed for every item of its kind (`kind`) while you work through them. `summary`: a glance at it, closed.
  import type { Snippet } from 'svelte';
  import { useSession } from '../../model/context';

  let { kind, summary, children }: { kind: string; summary?: string; children: Snippet } = $props();
  const s = useSession();
  const open = $derived(s.view.s.detailsOpen.includes(kind));
</script>

<details class="details" {open} ontoggle={(e) => s.view.setDetailsOpen(kind, e.currentTarget.open)}>
  <summary><span class="chev" aria-hidden="true"></span>Details{#if summary && !open}<span class="glance">{summary}</span>{/if}</summary>
  <div class="body">{@render children()}</div>
</details>

<style>
  .details { margin-top: 18px; border-top: 1px solid var(--color-border-default); padding-top: 10px; }
  summary { display: flex; align-items: baseline; gap: 8px; cursor: pointer; list-style: none; color: var(--color-text-secondary); font-weight: 600; font-size: 12.5px; }
  summary::-webkit-details-marker { display: none; }
  summary:hover { color: var(--color-text-primary); }
  .chev { width: 0; height: 0; border: 4px solid transparent; border-left: 5px solid currentColor; transform: translateY(1px); transition: transform .12s; }
  .details[open] .chev { transform: translateY(3px) rotate(90deg); }
  .glance { font-weight: 400; color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .body { margin-top: 4px; }
  .body > :global(h3:first-child) { margin-top: 8px; }
  @media (prefers-reduced-motion: reduce) { .chev { transition: none; } }
</style>
