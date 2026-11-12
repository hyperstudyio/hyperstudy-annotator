import { describe, expect, test } from 'vitest';
import { Playback } from './playback.svelte';

/** Enough of a <video> for Playback: play and pause, the playhead, and the events it listens to. */
class FakeVideo {
  paused = true;
  currentTime = 0;
  duration = 60;
  playbackRate = 1;
  volume = 1;
  muted = false;
  #on = new Map<string, (() => void)[]>();
  addEventListener(ev: string, f: () => void) { this.#on.set(ev, [...(this.#on.get(ev) ?? []), f]); }
  #emit(ev: string) { for (const f of this.#on.get(ev) ?? []) f(); }
  play() { this.paused = false; this.#emit('play'); return Promise.resolve(); }
  pause() { this.paused = true; this.#emit('pause'); }
  requestVideoFrameCallback() { return 0; }   // frames are not presented here
}

function attached() {
  const pb = new Playback(), v = new FakeVideo();
  pb.attach(v as unknown as HTMLVideoElement);
  return { pb, v };
}

describe('clips', () => {
  test('selecting a clip does not play it: Play does, from its start', () => {
    const { pb, v } = attached();
    pb.setClip({ start: 10, end: 14 });
    expect(v.paused).toBe(true);
    expect(v.currentTime).toBe(10);
    pb.toggle();
    expect(v.paused).toBe(false);
    expect(pb.playingClip).toBe(true);
  });

  test('selecting a clip while the video plays pauses it at the clip', () => {
    const { pb, v } = attached();
    pb.toggle();   // the whole video
    expect(pb.clip).toBeNull();
    pb.setClip({ start: 20, end: 25 });
    expect(v.paused).toBe(true);
    expect(v.currentTime).toBe(20);
  });

  test('Play resumes inside the clip, and starts it over from outside', () => {
    const { pb, v } = attached();
    pb.setClip({ start: 10, end: 14 });
    pb.seek(12, { keepClip: true });
    pb.toggle();
    expect(v.currentTime).toBe(12);   // resumed where it was paused
    pb.toggle();
    pb.time = v.currentTime = 14;     // played to its end, once
    pb.toggle();
    expect(v.currentTime).toBe(10);
  });

  test('moving the window keeps the clip, and brings the playhead along when it was left outside', () => {
    const { pb, v } = attached();
    pb.setClip({ start: 10, end: 14 });
    pb.reshapeClip({ start: 11, end: 16 });
    expect(pb.clip).toEqual({ start: 11, end: 16 });
    expect(v.currentTime).toBe(11);
    pb.seek(15, { keepClip: true });
    pb.reshapeClip({ start: 12, end: 18 });   // the playhead is still inside
    expect(v.currentTime).toBe(15);
  });

  test('with no clip, or once it is let go, Play plays the video from the playhead', () => {
    const { pb, v } = attached();
    pb.setClip({ start: 10, end: 14 });
    pb.seek(30);   // a click elsewhere on the timeline lets it go
    expect(pb.clip).toBeNull();
    pb.toggle();
    expect(v.currentTime).toBe(30);
    expect(pb.playingClip).toBe(false);
  });
});

describe('clip ends from the keys', () => {
  test('an end moves by the step, never past the other; paused, the playhead shows the end that moved', () => {
    const { pb, v } = attached();
    pb.setClip({ start: 10, end: 14 });
    pb.moveEdge('end', 0.1);
    expect(pb.clip!.end).toBeCloseTo(14.1);
    expect(v.currentTime).toBeCloseTo(14.1);   // the frame at the new end
    pb.moveEdge('start', -1);
    expect(pb.clip!.start).toBeCloseTo(9);
    expect(v.currentTime).toBeCloseTo(9);
    pb.moveEdge('start', 10);                  // shrinking: stops short of the other end
    expect(pb.clip!.start).toBeLessThan(pb.clip!.end);
    pb.toggle();                               // Play: from the clip's start, not the end shown
    expect(v.currentTime).toBeCloseTo(pb.clip!.start);
  });

  test('with no clip, one grows from the playhead', () => {
    const { pb } = attached();
    pb.seek(20);
    pb.moveEdge('end', 1);
    expect(pb.clip).toEqual({ start: 20, end: 21 });
  });

  test('with no clip, shrinking makes none, nor does growing where there is no room', () => {
    const { pb } = attached();
    pb.seek(20);
    pb.moveEdge('start', 0.1);   // ⌥⌘→
    pb.moveEdge('end', -0.1);    // ⌥⌘←
    expect(pb.clip).toBeNull();
    pb.seek(0);
    pb.moveEdge('start', -0.1);  // ⌘← at 0:00
    expect(pb.clip).toBeNull();
    pb.moveEdge('start', -0.1);
    pb.moveEdge('end', 0.1);     // ⌘→ there does
    expect(pb.clip).toEqual({ start: 0, end: 0.1 });
  });

  test('a clip changed while it plays keeps playing where it was', () => {
    const { pb, v } = attached();
    pb.playClip({ start: 10, end: 14 });
    pb.time = v.currentTime = 12;
    pb.moveEdge('end', 1);
    expect([v.paused, v.currentTime, pb.clip!.end]).toEqual([false, 12, 15]);
  });
});

describe('sound', () => {
  test('volume and mute reach the video, are kept for every video, and dragging the level up unmutes', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as unknown as Storage;
    const pb = new Playback(storage), v = new FakeVideo() as unknown as HTMLVideoElement & { muted: boolean; volume: number };
    pb.attach(v);
    pb.setVolume(0.4);
    pb.toggleMute();
    expect([v.volume, v.muted]).toEqual([0.4, true]);
    const next = new Playback(storage), w = new FakeVideo() as unknown as HTMLVideoElement & { muted: boolean; volume: number };
    next.attach(w);   // another video, later
    expect([w.volume, w.muted]).toEqual([0.4, true]);
    next.setVolume(0.7);
    expect([w.volume, w.muted]).toEqual([0.7, false]);
  });
});
