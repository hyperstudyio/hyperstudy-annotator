// One owner of the video's playback state, shared by the stage, the timeline and the keyboard.
// Two kinds of playback, told apart by what is on screen, the clip's shading on the timeline:
//   a clip, from its start to its end, looping by default: a click on a segment or a dragged range selects it, paused
//   at its start (testers, 2026-11: playing on a click was unwanted), and Play (Space) plays it; and
//   the whole video from the playhead: Play with no clip (Esc, or a click elsewhere on the timeline, lets it go).
// Keys that step to a segment (arrows, j k) and a panel's "play" still play it straight away: they ask to.
import type { Span } from './types';
import { retime } from './timeline/retime';

const SOUND_KEY = 'hyperstudy-annotator:sound';

/** Start the video. A pause before playback has begun rejects play() with AbortError: that is the pause working (a
 *  second click on a segment that just started), not a failure. Anything else (no user gesture yet) is rethrown. */
function play(v: HTMLVideoElement) {
  v.play().catch((e: DOMException) => { if (e.name !== 'AbortError') throw e; });
}

export class Playback {
  time = $state(0);          // media time of the frame on screen
  paused = $state(true);
  clip = $state<Span | null>(null);
  loop = $state(true);
  duration = $state(0);
  rate = $state(1);
  /** 0-1, and muted apart from it (unmuting returns to the level): the viewer's, kept for every video */
  volume = $state(1);
  muted = $state(false);
  #video: HTMLVideoElement | null = null;
  #storage: Storage | null;

  constructor(storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage) {
    this.#storage = storage;
    try {
      const saved = JSON.parse(storage?.getItem(SOUND_KEY) ?? 'null') as { volume?: number; muted?: boolean } | null;
      if (typeof saved?.volume === 'number') this.volume = Math.max(0, Math.min(1, saved.volume));
      if (typeof saved?.muted === 'boolean') this.muted = saved.muted;
    } catch { /* none kept, or storage blocked: full volume */ }
  }

  attach(video: HTMLVideoElement) {
    this.#video = video;
    video.playbackRate = this.rate;
    video.volume = this.volume;
    video.muted = this.muted;
    const sync = () => { this.time = video.currentTime; this.paused = video.paused; this.duration = video.duration || this.duration; };
    for (const ev of ['loadedmetadata', 'seeked', 'pause', 'play', 'durationchange']) video.addEventListener(ev, sync);
    video.addEventListener('play', () => this.#tick());
    sync();
  }

  // One update per presented frame, at that frame's media time (requestVideoFrameCallback), so overlays and the
  // playhead never lag the picture.
  #tick() {
    const v = this.#video;
    if (!v) return;
    v.requestVideoFrameCallback((_now, meta) => {
      this.time = meta.mediaTime;
      if (this.clip && this.time >= this.clip.end) {
        if (this.loop) v.currentTime = this.clip.start;
        else { v.pause(); v.currentTime = this.time = this.clip.end; }   // once: it stays selected, Play plays it again
      }
      if (!v.paused) this.#tick();
    });
  }

  /** Play or pause (Space, Play): the clip when there is one, from the playhead if that is inside it (a pause in the
   *  middle resumes there), else from its start; the whole video from the playhead when there is none. */
  toggle() {
    const v = this.#video;
    if (!v) return;
    if (!v.paused) { v.pause(); return; }
    if (this.clip && !(this.time >= this.clip.start && this.time < this.clip.end - 1e-3)) this.#jump(this.clip.start);
    play(v);
  }

  /** Select a clip without playing it (a click on a segment, a dragged range): the playhead waits at its start. */
  setClip(span: Span | null) {
    this.#video?.pause();
    this.clip = span && { start: span.start, end: span.end };
    if (span) this.#jump(span.start);
  }

  /** The clip's window moved or changed length (dragged, ⇧-clicked, ⌘-arrowed), playing or not. Paused, with `shown`
   *  the end that moved, the playhead shows that end's frame (as an editor's trim does; Play then starts the clip from
   *  its start); else it joins the clip if the change left it outside. */
  reshapeClip(span: Span, shown?: 'start' | 'end') {
    this.clip = { start: span.start, end: span.end };
    if (shown && this.paused) this.#jump(span[shown]);
    else if (this.time < span.start || this.time >= span.end) this.#jump(span.start);
  }

  /** Move one end of the clip by dt seconds (⌘←/→): never past the other end. With no clip, one starts at the playhead. */
  moveEdge(edge: 'start' | 'end', dt: number) {
    const from = this.clip ?? { start: this.time, end: this.time };
    this.reshapeClip(retime(edge, from, dt, this.duration || from.end + Math.max(0, dt)), edge);
  }

  /** Select a clip and play it now (a key that steps to a segment, a panel's "play"). */
  playClip(span: Span) {
    this.clip = { start: span.start, end: span.end };
    this.#jump(span.start);
    if (this.#video) play(this.#video);
  }

  pause() { this.#video?.pause(); }
  /** Pause and let the clip go (Esc). */
  stop() { this.clip = null; this.#video?.pause(); }

  #jump(t: number) {
    this.time = t;
    if (this.#video) this.#video.currentTime = t;
  }

  /** Move the playhead. A seek lets the clip go (Play then plays the video from there), except when selecting a
   *  segment moves the playhead to it, or the playhead is moved within the clip (`keepClip`). */
  seek(t: number, { keepClip = false } = {}) {
    if (!keepClip) this.clip = null;
    this.time = Math.max(0, Math.min(this.duration || t, t));
    if (this.#video) this.#video.currentTime = this.time;
  }

  nudge(seconds: number) { this.seek(this.time + seconds); }

  setRate(rate: number) { this.rate = rate; if (this.#video) this.#video.playbackRate = rate; }

  /** Set the level; raising it from silence unmutes, as a slider dragged up should be heard. */
  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.volume > 0 && this.muted) this.muted = false;
    this.#applySound();
  }
  toggleMute() { this.muted = !this.muted; this.#applySound(); }
  #applySound() {
    if (this.#video) { this.#video.volume = this.volume; this.#video.muted = this.muted; }
    try { this.#storage?.setItem(SOUND_KEY, JSON.stringify({ volume: this.volume, muted: this.muted })); }
    catch { /* a convenience: the level is still set for now */ }
  }

  /** True while a clip (not the whole video) is playing. */
  get playingClip() { return !!this.clip && !this.paused; }
}
