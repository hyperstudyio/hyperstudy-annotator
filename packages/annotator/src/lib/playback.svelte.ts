// One owner of the video's playback state, shared by the stage, the timeline and the keyboard.
// Two kinds of playback, never chosen by hidden state (settled in the prototype's review):
//   the whole video from the playhead (Space), and
//   a clip, from its start to its end, looping by default (a click on a segment, a dragged range, Shift+Space).
import type { Span } from './types';

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
  #video: HTMLVideoElement | null = null;

  attach(video: HTMLVideoElement) {
    this.#video = video;
    video.playbackRate = this.rate;
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
        else { v.pause(); this.clip = null; }
      }
      if (!v.paused) this.#tick();
    });
  }

  toggle() {   // whole video: always
    const v = this.#video;
    if (!v) return;
    this.clip = null;
    if (v.paused) play(v); else v.pause();
  }

  playClip(span: Span) {
    this.clip = { start: span.start, end: span.end };
    this.time = span.start;
    const v = this.#video;
    if (!v) return;
    v.currentTime = span.start;
    play(v);
  }

  /** A click on a segment: play it, or stop it if it is the clip already playing. */
  toggleClip(span: Span) {
    if (this.clip && !this.paused && Math.abs(this.clip.start - span.start) < 1e-3 && Math.abs(this.clip.end - span.end) < 1e-3) this.stop();
    else this.playClip(span);
  }

  stop() { this.clip = null; this.#video?.pause(); }

  /** Move the playhead. A seek ends the clip, except when selecting a segment moves the playhead to it
   *  (`keepClip`): a second click on the playing segment must still find it playing, to stop it. */
  seek(t: number, { keepClip = false } = {}) {
    if (!keepClip) this.clip = null;
    this.time = Math.max(0, Math.min(this.duration || t, t));
    if (this.#video) this.#video.currentTime = this.time;
  }

  nudge(seconds: number) { this.seek(this.time + seconds); }

  setRate(rate: number) { this.rate = rate; if (this.#video) this.#video.playbackRate = rate; }

  /** True while a clip (not the whole video) is playing. */
  get playingClip() { return !!this.clip && !this.paused; }
}
