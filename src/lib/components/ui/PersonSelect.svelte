<script lang="ts">
  // Choose a person (and optionally Unknown, Not a person, or a new person).
  import { useSession } from '../../model/context';
  let { current, onpick, allowSpecial = true, placeholder, allowNew = true, label = 'Person' }: {
    current: string | null; onpick: (p: string) => void; allowSpecial?: boolean; placeholder?: string; allowNew?: boolean; label?: string;
  } = $props();
  const s = useSession();
  const options = $derived(s.people.filter((p) => allowSpecial || !s.special(p)));
</script>

<select aria-label={label} onchange={(e) => { const v = e.currentTarget.value; if (v) onpick(v); }}>
  {#if placeholder}<option value="" selected={!current}>{placeholder}</option>{/if}
  {#each options as p (p)}<option value={p} selected={p === current}>{s.nameOf(p)}</option>{/each}
  {#if allowNew}<option value="__new">New person…</option>{/if}
</select>
