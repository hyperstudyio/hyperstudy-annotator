<script lang="ts">
  // The Inspect tab: the selection's view, or (with nothing selected) the shot at the playhead.
  import { useSession } from '../../model/context';
  import InspectShot from './InspectShot.svelte';
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
  const shotHere = $derived(b.shotAt(s.playback.time));
</script>

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
  <p class="meta hint">Select a face or anything on the timeline to see it here. This is the shot at the playhead.</p>
  {#if shotHere}<InspectShot shot={shotHere} />{/if}
{/if}
