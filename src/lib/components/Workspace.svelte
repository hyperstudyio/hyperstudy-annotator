<script lang="ts">
  // An open bundle: header, the video with its overlay and transport, the timeline, and the drawer. This is the
  // piece HyperStudy embeds: give it a Session and the BundleSource it came from.
  // Keys (the prototype's settled scheme): Space play/pause the whole video · Shift+Space play the selection · L loop
  // on/off · ←/→ previous/next segment in the selected row · Shift+←/→ one second · , . shots · j k review queue ·
  // e include · [ ] annotate · 1-9 o m u x speaker · Esc stop and deselect · Cmd+Z undo · \ the panel.
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

  let { session: s, source, onback }: { session: Session; source: BundleSource; onback?: () => void } = $props();
  // svelte-ignore state_referenced_locally
  provideSession(s, source);
  const pb = $derived(s.playback);
  const TIMELINE_MIN_H = 120, VIDEO_MIN_H = 220;

  $effect(() => source.corrections.subscribe?.(() => { s.load(); }));   // another tab of this bundle saved

  function onkeydown(e: KeyboardEvent) {
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
    else if (k === 'Escape') { if (pb.clip) pb.stop(); s.selection = null; s.marking = null; }
    else if (k === '[') {
      if (!s.S.types.length) { s.tab = 'notes'; s.toast('Add an annotation type first'); return; }
      s.marking = pb.time; s.toast('Start marked; press ] at the end');
    }
    else if (k === ']') { if (s.marking !== null && s.activeType) { const a = s.marking, b = pb.time; s.addNote(s.activeType, Math.min(a, b), Math.max(a, b)); } }
    else if (k === 'e' && sel && sel.kind !== 'note') s.commit({ op: 'entity.include', id: sel.id, included: !s.included(sel) });
    else if (utt && /^[1-9]$/.test(k)) { const c = s.bundle.prediction.get(utt.id)?.candidates[Number(k) - 1]; if (c) s.setSpeaker(utt, { kind: 'face', face: c.face }); }
    else if (utt && k === 'o') s.setSpeaker(utt, { kind: 'offscreen', voice: utt.voice });
    else if (utt && k === 'm') s.setSpeaker(utt, { kind: 'multiple' });
    else if (utt && k === 'u') s.setSpeaker(utt, { kind: 'unsure' });
    else if (utt && k === 'x') s.setSpeaker(utt, { kind: 'not_speech' });
  }

  const drawerW = $derived(s.view.s.drawerClosed ? '28px' : `${s.view.s.drawerW ?? 400}px`);
</script>

<svelte:window {onkeydown} />

<div class="viewer">
  <Header {onback} />
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
