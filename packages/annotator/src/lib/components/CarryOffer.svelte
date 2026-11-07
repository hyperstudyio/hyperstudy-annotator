<script lang="ts">
  // A re-run of a video opens with an empty log: offer the newest earlier version's corrections, re-anchored to this
  // version's ids (model/carryover.ts). What cannot be carried waits in the Review tab; the earlier log is only read.
  import { untrack } from 'svelte';
  import { Bundle } from '../model/bundle';
  import { carryOver } from '../model/carryover';
  import { useSession, useSource } from '../model/context';
  import { plural, stampAfter } from '../model/session.svelte';
  import type { EarlierVersion } from '../source';
  import { latestOnly } from '../latest';

  const s = useSession(), source = useSource();
  let offer = $state<EarlierVersion | null>(null);
  let busy = $state(false);
  let carryButton = $state<HTMLButtonElement>();
  $effect(() => { s.modal = !!offer; });
  $effect(() => { if (offer) carryButton?.focus(); });
  let error = $state<string | null>(null);

  // Checked on opening (which also loads what was not carried) and whenever the log becomes empty or stops being
  // empty: an undo that takes a carry-over back offers it again.
  const empty = $derived(s.ops.length === 0);
  const newest = latestOnly();   // an older check finishing later would show a stale offer
  $effect(() => {
    const lineage = source.lineage;
    void empty;
    if (!lineage) return;
    untrack(() => newest(s.checkCarry(lineage), (o) => (offer = o), (e) => (error = String(e))));
  });

  async function carry() {
    const from = offer!, lineage = source.lineage!;
    busy = true; error = null;
    try {
      const prev = await from.open();
      const [bundle, ops] = await Promise.all([Bundle.load(prev), prev.corrections.load()]);
      // provenance by manifest sha256, which means the same on every machine (from.id is this library's)
      const r = carryOver(ops, bundle, s.bundle, bundle.key ?? from.id, stampAfter(undefined));
      await lineage.carry(from.id, r.ops, r.unmatched);
      await s.load();
      s.carry = await lineage.record();
      offer = null;
      s.toast(`Carried over ${plural(r.ops.length, 'correction')}${r.unmatched.length ? `; ${r.unmatched.length} to review` : ''}`);
      if (r.unmatched.length) s.tab = 'review';
    } catch (e) { error = String(e); } finally { busy = false; }
  }

  async function decline() {
    busy = true; error = null;
    try { await source.lineage!.decline(offer!.id); s.carry = await source.lineage!.record(); offer = null; }
    catch (e) { error = String(e); } finally { busy = false; }
  }
</script>

{#if offer}
  <div class="backdrop"></div>
  <div class="offer" role="dialog" aria-modal="true" aria-label="Carry over corrections">
    <div class="title">This is a newer run of this video</div>
    <p>{offer.label} has {plural(offer.corrections, 'correction')}. Carry them over? Each is matched to this run’s faces,
      people, utterances and shots; any that cannot be matched are listed in the Review tab, not dropped.</p>
    {#if error}<p class="error">{error}</p>{/if}
    <div class="actions">
      <button onclick={decline} disabled={busy}>Start fresh</button>
      <button class="primary" bind:this={carryButton} onclick={carry} disabled={busy}>{busy ? 'Carrying over…' : 'Carry over'}</button>
    </div>
  </div>
{/if}

<style>
  /* A modal: the choice comes before any work on this version, and nothing on the page (a header banner of any
     height) can sit over it or under it half-hidden. */
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, .45); z-index: 44; }
  .offer { position: fixed; top: 30%; left: 50%; transform: translate(-50%, -30%); width: min(520px, calc(100vw - 32px)); z-index: 45;
           background: var(--color-bg-card); border: 1px solid var(--color-border-strong); border-radius: 8px; padding: 12px 14px;
           box-shadow: 0 8px 24px rgba(0, 0, 0, .4); }
  .title { font-weight: 600; margin-bottom: 4px; }
  p { margin: 0 0 10px; color: var(--color-text-secondary); }
  .actions { display: flex; gap: 8px; justify-content: flex-end; }
</style>
