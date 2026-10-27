<script lang="ts">
  // The Inspect tab: where the one thing selected is edited (who a face is, who speaks and what was said, a caption,
  // a name, an annotation's value). What happens when is the timeline's; this is for what it cannot change. Back
  // returns to what was selected before (a person opened from a face, from a gesture…).
  import { useSession } from '../../model/context';
  import InspectShot from './InspectShot.svelte';
  import LeftOut from './LeftOut.svelte';
  import InspectUtterance from './InspectUtterance.svelte';
  import InspectFace from './InspectFace.svelte';
  import InspectPerson from './InspectPerson.svelte';
  import InspectObject from './InspectObject.svelte';
  import InspectIdentity from './InspectIdentity.svelte';
  import InspectSound from './InspectSound.svelte';
  import InspectText from './InspectText.svelte';
  import InspectEvent from './InspectEvent.svelte';
  import InspectNote from './InspectNote.svelte';

  const s = useSession();
  const sel = $derived(s.selection);
  const b = $derived(s.bundle);
  // Back: the selections before this one, kept by the session whichever tab made them (Session.back)
</script>

{#if s.history.length}<button class="link back" onclick={() => s.back()}>← Back</button>{/if}
{#if sel}<LeftOut {sel} />{/if}

{#if sel?.kind === 'shot' && b.shot.get(sel.id)}<InspectShot shot={b.shot.get(sel.id)!} />
{:else if sel?.kind === 'utt' && b.utt.get(sel.id)}<InspectUtterance u={b.utt.get(sel.id)!} />
{:else if sel?.kind === 'face' && b.face.get(sel.id)}<InspectFace track={b.face.get(sel.id)!} />
{:else if sel?.kind === 'person'}<InspectPerson person={sel.id} />
{:else if sel?.kind === 'object' && b.object.get(sel.id)}<InspectObject object={b.object.get(sel.id)!} />
{:else if sel?.kind === 'objid'}<InspectIdentity identity={sel.id} />
{:else if sel?.kind === 'sound' && b.sound.get(sel.id)}<InspectSound sound={b.sound.get(sel.id)!} />
{:else if sel?.kind === 'text' && b.text.get(sel.id)}<InspectText item={b.text.get(sel.id)!} />
{:else if (sel?.kind === 'gesture' || sel?.kind === 'facing' || sel?.kind === 'gaze')}<InspectEvent kind={sel.kind} id={sel.id} />
{:else if sel?.kind === 'note' && s.S.notes.get(sel.id)}<InspectNote note={s.S.notes.get(sel.id)!} />
{:else}
  <p class="empty">Select a face on the video, or anything on the timeline, to edit it here.</p>
{/if}

<style>
  .back { display: block; margin: -4px 0 10px; }
</style>
