<script lang="ts">
  // An open bundle: header, the video with its overlay and transport, the timeline, and the drawer. This is the
  // piece HyperStudy embeds: give it a Session and the BundleSource it came from.
  // Keys (the prototype's settled scheme): Space play/pause the whole video · Shift+Space play the selection · L loop
  // on/off · ←/→ previous/next segment in the selected row · Shift+←/→ one second · , . shots · j k review queue ·
  // [ ] annotate · 1-9 o m u x speaker · Esc stop and deselect · Cmd+Z undo · \ the panel.
  import type { Snippet } from 'svelte';
  import { provideSession } from '../model/context';
  import type { Session } from '../model/session.svelte';
  import type { BundleSource } from '../source';
  import { DRAWER_W } from '../model/view.svelte';
  import Header from './Header.svelte';
  import VideoStage from './VideoStage.svelte';
  import Transport from './Transport.svelte';
  import Timeline from './timeline/Timeline.svelte';
  import Drawer from './Drawer.svelte';
  import Lightbox from './Lightbox.svelte';
  import Toast from './Toast.svelte';
  import CarryOffer from './CarryOffer.svelte';

  // `active`: on screen. An app that hides the workspace and keeps it (the desktop app's other pages) sets it false:
  // the video stops, and the keys go to what is on screen instead. `onmodal`: a dialog here waits for its answer
  // (CarryOffer), so what the app shows around the workspace is out of reach too, as the workspace is.
  // `title`: what the header shows for the video's name (the desktop app's switcher between videos); its name else.
  let { session: s, source, onback, active = true, onmodal, title }: {
    session: Session; source: BundleSource; onback?: () => void; active?: boolean; onmodal?: (open: boolean) => void; title?: Snippet;
  } = $props();
  // svelte-ignore state_referenced_locally
  provideSession(s, source);
  const pb = $derived(s.playback);
  const TIMELINE_MIN_H = 120, VIDEO_MIN_H = 220;

  $effect(() => source.corrections.subscribe?.(() => { s.load(); }));   // another tab of this bundle saved
  $effect(() => { if (!active) s.playback.stop(); });
  $effect(() => { onmodal?.(s.modal); return () => onmodal?.(false); });

  function onkeydown(e: KeyboardEvent) {
    if (s.modal || !active) return;   // a dialog waits for its answer (CarryOffer); its buttons take the keyboard
    // Space means play/pause everywhere except while typing text. A focused dropdown, slider or checkbox gives it up
    // (after you touch a picker, Space would otherwise stop working), and so does a focused button, which would also
    // "click" on key-up so that one press did two things.
    const el = e.target as HTMLElement;
    const field = el.closest?.('input, textarea, select') as HTMLInputElement | null;
    if (field) {
      const typing = field.tagName === 'TEXTAREA' || (field.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(field.type));
      if (typing || e.key !== ' ') return;
      field.blur();
    }
    if (document.activeElement?.tagName === 'BUTTON' && e.key === ' ') (document.activeElement as HTMLElement).blur();
    const k = e.key, sel = s.selection, utt = sel?.kind === 'utt' ? s.bundle.utt.get(sel.id) ?? null : null;
    if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'z') { e.preventDefault(); s.undo(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (k === ' ') { e.preventDefault(); if (e.shiftKey) s.playSelection(); else pb.toggle(); }
    else if (k === '\\') s.view.toggleDrawer();
    else if (k === '?') s.help = !s.help;
    else if (k === 'l' || k === 'L') { pb.loop = !pb.loop; s.toast(pb.loop ? 'Clips loop' : 'Clips play once'); }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      const dir = k === 'ArrowLeft' ? -1 : 1;
      if (e.shiftKey) pb.nudge(dir); else s.step(dir);
    }
    else if (k === ',' || k === '.') {
      const cur = s.bundle.shotAt(pb.time), next = cur ? s.bundle.shots[cur.index + (k === ',' ? -1 : 1)] : null;
      if (next) pb.seek(next.start + 0.01);
    }
    else if (k === 'j' || k === 'k') { s.tab = 'review'; s.nextInQueue(k === 'j' ? 1 : -1); }
    else if (k === 'Escape') { if (pb.clip) pb.stop(); s.selection = null; s.marking = null; s.noteMenu = null; }
    // Enter on a focused control is that control's (a button, a menu's trigger)
    else if (sel?.kind === 'note' && k === 'Enter' && !document.activeElement?.closest?.('button, a, select, [role=button]')) { e.preventDefault(); s.noteMenu = sel.id; }
    // not from another menu's control (a category's × in a type's menu): ⌫ there is that control's
    else if (sel?.kind === 'note' && (k === 'Backspace' || k === 'Delete') && !document.activeElement?.closest?.('[role=dialog]:not(.note-menu)')) { e.preventDefault(); s.deleteNote(sel.id).then(() => s.toast('Annotation deleted · ⌘Z brings it back')); }
    else if (k === '[' || k === 'a' || k === 'A') {
      if (!s.currentType()) { s.toast('Add an annotation type first: + beside Annotations on the timeline'); return; }
      if (k !== '[') s.annotateHere();
      else { s.marking = pb.time; s.toast('Start marked; press ] at the end'); }
    }
    else if (k === ']') { const type = s.currentType(); if (s.marking !== null && type) { const a = s.marking, b = pb.time; s.addNote(type.id, Math.min(a, b), Math.max(a, b)); } }
    else if (sel?.kind === 'note' && s.valueFromKey(k) !== undefined) s.commit({ op: 'annotation.edit', id: sel.id, fields: { value: s.valueFromKey(k)! } });
    else if (utt && /^[1-9]$/.test(k)) { const c = s.bundle.prediction.get(utt.id)?.candidates[Number(k) - 1]; if (c) s.setSpeaker(utt, { kind: 'face', face: c.face }); }
    else if (utt && k === 'o') s.setSpeaker(utt, { kind: 'offscreen', voice: utt.voice });
    else if (utt && k === 'm') s.setSpeaker(utt, { kind: 'multiple' });
    else if (utt && k === 'u') s.setSpeaker(utt, { kind: 'unsure' });
    else if (utt && k === 'x') s.setSpeaker(utt, { kind: 'not_speech' });
  }

  const drawerW = $derived(s.view.s.drawerClosed ? '28px' : `${s.view.s.drawerW ?? 400}px`);
</script>

<svelte:window {onkeydown} />

<div class="viewer" inert={s.modal}>
  <Header {onback} {title} />
  <div class="workspace" style="--drawer-w:{drawerW}">
    <section class="stage">
      <VideoStage src={source.videoUrl} />
      <Transport />
    </section>
    <Drawer onresize={(dx, w0) => s.view.setDrawerW(w0 + dx)} onresizeend={() => s.view.save()} onresetwidth={() => { s.view.setDrawerW(null); s.view.save(); }} />
    <Timeline onresizeheight={(dy, h0) => s.view.setTimelineH(Math.max(TIMELINE_MIN_H, Math.min(window.innerHeight - VIDEO_MIN_H, h0 + dy)))}
      onresetheight={() => { s.view.setTimelineH(null); s.view.save(); }} />
  </div>
</div>
<Lightbox />
<Toast />
<CarryOffer />

<style>
  .viewer { height: 100%; display: flex; flex-direction: column; min-width: 0; }
  /* Both tracks are minmax(0, ...): a grid track sized by its content would grow with the widest unwrapped line in it
     (a shot caption, the timeline's own zoomed width) and the timeline's scale, which is fitted to its width, would
     change with whatever is on screen (the drag-range bug). */
  .workspace { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) var(--drawer-w); grid-template-rows: minmax(0, 1fr) auto; }
  .stage { display: flex; flex-direction: column; min-height: 0; min-width: 0; padding: 12px 12px 8px 16px; }
  .workspace > :global(.drawer) { grid-row: 1 / 3; grid-column: 2; }
</style>
