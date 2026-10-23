// The overlay over the video: faces (by person, dashed when not sent to agents, numbered as speaker candidates),
// objects, skeletons, hands, py-feat landmarks, gaze. Drawn at the media time of the frame on screen, blending the
// samples around it (smooth.ts), so nothing lags or jumps against the picture.
import type { Session } from '../model/session.svelte';
import type { OverlayLayers, GazeSource } from '../model/view.svelte';
import type { Box, FaceDetailSample, FaceTrack, FacesDetail, HandsLayer, Kpt, ObjectSample, ObjectTrack, PoseSample } from '../types';
import { bracket, lerpKpts, lerpNums, smoothKpts, smoothNums } from './smooth';

export interface Mapping { scale: number; ox: number; oy: number }
const X = (m: Mapping, x: number) => m.ox + x * m.scale;
const Y = (m: Mapping, y: number) => m.oy + y * m.scale;

// Hand files carry no threshold yet; these are the hand bake-off's (hands/hands.py report, 2026-10-22): RTMW's
// fingers need >= 5 to agree with MediaPipe as well as RTMPose-hand does at 0.3.
const HAND_THRESHOLD: Record<string, number> = { rtmw: 5.0, rtmpose_hand: 0.3, mediapipe: 0.3 };
export function handThreshold(hands: HandsLayer): number | null {
  return hands.score_threshold ?? HAND_THRESHOLD[hands.producer.models[0]?.id ?? ''] ?? null;
}

const LMK_PATHS: [number, number, boolean?][] = [[0, 16], [17, 21], [22, 26], [27, 30], [31, 35], [36, 41, true], [42, 47, true], [48, 59, true], [60, 67, true]];

/** Smoothed copies of every sampled series, computed once per bundle (display only). */
export class Smoothed {
  #kpts = new WeakMap<object, Kpt[][]>();
  #detail = new WeakMap<object, { lmk: number[][]; gaze: number[][] }>();
  kpts(samples: PoseSample[], fps: number, threshold: number): Kpt[][] {
    let s = this.#kpts.get(samples);
    if (!s) { s = smoothKpts(samples, fps, threshold); this.#kpts.set(samples, s); }
    return s;
  }
  detail(samples: FaceDetailSample[], fps: number) {
    let s = this.#detail.get(samples);
    if (!s) { s = { lmk: smoothNums(samples, (x) => x.lmk, fps), gaze: smoothNums(samples, (x) => x.gaze, fps) }; this.#detail.set(samples, s); }
    return s;
  }
}

/** py-feat geometry of a face at t (landmarks, gaze angles), blended and optionally smoothed. */
export function faceDetailAt(detail: FacesDetail | null, face: string, t: number, fps: number, smooth: boolean, sm: Smoothed) {
  const samples = detail?.tracks[face];
  if (!samples?.length) return null;
  const br = bracket(samples, t, fps);
  if (!br) return null;
  const ia = samples.indexOf(br.a), ib = samples.indexOf(br.b), S = smooth ? sm.detail(samples, fps) : null;
  return { lmk: lerpNums(S ? S.lmk[ia] : br.a.lmk, S ? S.lmk[ib] : br.b.lmk, br.f), gaze: lerpNums(S ? S.gaze[ia] : br.a.gaze, S ? S.gaze[ib] : br.b.gaze, br.f) };
}

/** A face's box at t: linear between the samples around t (boxes are drawn across short missed detections, as the
 *  track says the face is there), held at the ends for half a sample gap. */
export function faceBoxAt(f: FaceTrack, t: number, fps: number): Box | null {
  const edge = 0.5 / fps, S = f.samples;
  if (!S.length || t < f.start - edge || t > f.end + edge) return null;
  if (t <= S[0].t) return S[0].box;
  if (t >= S[S.length - 1].t) return S[S.length - 1].box;
  let lo = 0, hi = S.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (S[mid].t <= t) lo = mid; else hi = mid; }
  return lerpNums(S[lo].box, S[hi].box, (t - S[lo].t) / (S[hi].t - S[lo].t)) as Box;
}

/** The nearest object sample within one sample gap. */
export function objectSampleAt(o: ObjectTrack, t: number, fps: number): ObjectSample | null {
  let best: ObjectSample | null = null, bd = Infinity;
  for (const x of o.samples) { const d = Math.abs(x.t - t); if (d < bd) { bd = d; best = x; } }
  return bd <= 1 / fps ? best : null;
}

export function insidePoly(px: number, py: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface OverlayInput {
  s: Session; t: number; m: Mapping; layers: OverlayLayers; gazeSource: GazeSource; detail: FacesDetail | null; sm: Smoothed;
}

export function visibleObjects(s: Session, t: number) {
  const shot = s.bundle.shotAt(t), fps = s.bundle.layers.objects?.fps ?? 6;
  return (shot ? s.bundle.objectsByShot.get(shot.id) ?? [] : [])
    .map((o) => ({ o, x: objectSampleAt(o, t, fps) })).filter((v): v is { o: ObjectTrack; x: ObjectSample } => !!v.x);
}

export function visibleFaces(s: Session, t: number) {
  const fps = s.bundle.layers.faces?.sample_fps ?? 8;
  return s.facesAt(t).map((f) => ({ f, box: faceBoxAt(f, t, fps) })).filter((v): v is { f: FaceTrack; box: Box } => !!v.box);
}

/** What a click on the video at source pixel (px, py) hits: the smallest face box (or its label), else the smallest
 *  object outline. */
export function hitTest(s: Session, t: number, px: number, py: number, scale: number, objects: boolean) {
  const face = visibleFaces(s, t).filter(({ box: [x, y, w, h] }) => px >= x && px <= x + w && py >= y - 19 / scale && py <= y + h)
    .sort((a, b) => a.box[2] - b.box[2])[0];
  if (face) return { kind: 'face' as const, id: face.f.id };
  const obj = objects ? visibleObjects(s, t).filter((v) => insidePoly(px, py, v.x.poly)).sort((a, b) => a.x.box[2] * a.x.box[3] - b.x.box[2] * b.x.box[3])[0] : null;
  return obj ? { kind: 'object' as const, id: obj.o.id } : null;
}

export function drawOverlay(g: CanvasRenderingContext2D, inp: OverlayInput) {
  const { s, t, m, layers: L } = inp;
  const sel = s.selection;
  const numbers = new Map<string, number>();
  if (sel?.kind === 'utt') (s.bundle.prediction.get(sel.id)?.candidates ?? []).slice(0, 9).forEach((c, i) => numbers.set(c.face, i + 1));
  if (L.objects) drawObjects(g, inp);
  if (L.skeleton) drawSkeletons(g, inp);
  if (L.hands) drawHands(g, inp);
  const faces = visibleFaces(s, t), fps = s.bundle.layers.faces?.sample_fps ?? 8;
  for (const { f, box: [x, y, w, h] } of faces) {
    const p = s.personOf(f), inc = s.includedFace(f), col = inc ? s.colourOf(p) : 'rgba(200,200,200,.6)';
    const selected = (sel?.kind === 'face' && sel.id === f.id) || (sel?.kind === 'person' && sel.id === p);
    const d = L.landmarks || L.gaze ? faceDetailAt(inp.detail, f.id, t, fps, L.smooth, inp.sm) : null;
    if (L.landmarks && d) {
      g.strokeStyle = col; g.lineWidth = 1.2; g.setLineDash([]);
      for (const [a, b, closed] of LMK_PATHS) {
        g.beginPath();
        for (let i = a; i <= b; i++) { const px = X(m, d.lmk[i]), py = Y(m, d.lmk[68 + i]); if (i === a) g.moveTo(px, py); else g.lineTo(px, py); }
        if (closed) g.closePath();
        g.stroke();
      }
    }
    if (L.gaze) {
      if (inp.gazeSource === 'gaze_lle' && s.bundle.layers.gaze) drawGazeLLE(g, inp, f, [x, y, w, h], d?.lmk ?? null, col);
      else if (inp.gazeSource === 'pyfeat' && d) drawGazeRay(g, inp, [x, y, w, h], d, col);
    }
    if (!L.boxes && !selected) continue;
    g.lineWidth = selected ? 3 : 2;
    g.setLineDash(inc ? [] : [5, 4]);
    g.strokeStyle = col;
    g.strokeRect(X(m, x), Y(m, y), w * m.scale, h * m.scale);
    g.setLineDash([]);
    const n = numbers.get(f.id), label = `${n ? `${n} · ` : ''}${s.nameOf(p)}`;
    g.font = '600 12px system-ui, sans-serif';
    const tw = g.measureText(label).width + 10, lx = X(m, x), ly = Math.max(0, Y(m, y) - 19);
    g.fillStyle = inc ? s.colourOf(p) : 'rgba(80,80,80,.85)';
    g.fillRect(lx, ly, tw, 18);
    g.fillStyle = inc ? '#111' : '#ddd';
    g.fillText(label, lx + 5, ly + 13);
  }
}

function drawObjects(g: CanvasRenderingContext2D, { s, t, m }: OverlayInput) {
  const sel = s.selection;
  for (const { o, x } of visibleObjects(s, t)) {
    const i = s.identityOf(o), inc = s.includedObject(o), col = s.objColour(i);
    const selected = (sel?.kind === 'object' && sel.id === o.id) || (sel?.kind === 'objid' && sel.id === i);
    g.beginPath();
    x.poly.forEach(([px, py], k) => (k ? g.lineTo(X(m, px), Y(m, py)) : g.moveTo(X(m, px), Y(m, py))));
    g.closePath();
    g.setLineDash(inc ? [] : [5, 4]);
    g.fillStyle = inc ? `${col}${selected ? '55' : '26'}` : 'rgba(150,150,150,.08)';
    g.fill();
    g.lineWidth = selected ? 2.5 : 1.5; g.strokeStyle = inc ? col : 'rgba(200,200,200,.5)'; g.stroke();
    g.setLineDash([]);
    g.font = '600 11px system-ui, sans-serif';
    const label = s.objName(i), tw = g.measureText(label).width + 8, lx = X(m, x.box[0]), ly = Math.max(0, Y(m, x.box[1]) - 16);
    g.fillStyle = inc ? col : 'rgba(80,80,80,.85)'; g.fillRect(lx, ly, tw, 15);
    g.fillStyle = '#111'; g.fillText(label, lx + 4, ly + 11);
  }
}

// Keypoint scores are each model's own scale (RTMW's raw SimCC peaks run 0-12; ViTPose and Sapiens2 are 0-1), so a
// joint is drawn only above the threshold its stage wrote into the layer.
function drawSkeletons(g: CanvasRenderingContext2D, { s, t, m, layers, sm }: OverlayInput) {
  const B = s.bundle.layers.bodies, shot = s.bundle.shotAt(t);
  if (!B || !shot) return;
  const groups = (B.producer.config.groups ?? {}) as Record<string, number[]>;
  const handIdx = new Set([...(groups.left_hand ?? []), ...(groups.right_hand ?? [])]), faceIdx = new Set(groups.face ?? []);
  const th = B.score_threshold;
  for (const tr of s.bundle.bodiesByShot.get(shot.id) ?? []) {
    const br = bracket(tr.samples, t, B.fps);
    if (!br) continue;
    const S = layers.smooth ? sm.kpts(tr.samples, B.fps, th) : null;
    const kpts = lerpKpts(S ? S[tr.samples.indexOf(br.a)] : br.a.kpts, S ? S[tr.samples.indexOf(br.b)] : br.b.kpts, br.f);
    const p = s.personOfFace(tr.face), col = p ? s.colourOf(p) : '#ffffff';
    g.strokeStyle = col; g.fillStyle = col; g.setLineDash([]);
    for (const [a, b] of B.skeleton) {
      const ka = kpts[a], kb = kpts[b];
      if (!ka || !kb || ka[2] < th || kb[2] < th || faceIdx.has(a) || faceIdx.has(b)) continue;
      g.lineWidth = handIdx.has(a) || handIdx.has(b) ? 1 : 2.5;
      g.beginPath(); g.moveTo(X(m, ka[0]), Y(m, ka[1])); g.lineTo(X(m, kb[0]), Y(m, kb[1])); g.stroke();
    }
    kpts.forEach((k, i) => { if (k[2] >= th && !faceIdx.has(i)) g.fillRect(X(m, k[0]) - 1.5, Y(m, k[1]) - 1.5, 3, 3); });
    const facing = (br.f < 0.5 ? br.a : br.b).facing;
    if (facing) drawFacing(g, m, B.keypoint_names, kpts, facing[0], th, col);
  }
}

// Torso facing from 3D pose (yaw + = subject's right = image left, py-feat's convention): an arrow from the
// mid-shoulder point, its length the sideways component, so a body square to the camera shows a short stub.
function drawFacing(g: CanvasRenderingContext2D, m: Mapping, names: string[], kpts: Kpt[], yaw: number, th: number, col: string) {
  const ls = kpts[names.indexOf('left_shoulder')], rs = kpts[names.indexOf('right_shoulder')];
  if (!ls || !rs || ls[2] < th || rs[2] < th) return;
  const mx = (ls[0] + rs[0]) / 2, my = (ls[1] + rs[1]) / 2, span = Math.hypot(ls[0] - rs[0], ls[1] - rs[1]);
  const x2 = mx - Math.sin((yaw * Math.PI) / 180) * span * 1.2;
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 3; g.setLineDash([]);
  g.beginPath(); g.moveTo(X(m, mx), Y(m, my)); g.lineTo(X(m, x2), Y(m, my)); g.stroke();
  const dir = Math.sign(x2 - mx) || 1;
  g.beginPath(); g.moveTo(X(m, x2) + dir * 8, Y(m, my)); g.lineTo(X(m, x2) - dir * 2, Y(m, my) - 6); g.lineTo(X(m, x2) - dir * 2, Y(m, my) + 6); g.fill();
  g.font = '600 11px system-ui, sans-serif'; g.fillText(`${Math.round(yaw)}°`, X(m, mx) + 6, Y(m, my) - 8);
}

function drawHands(g: CanvasRenderingContext2D, { s, t, m, layers, sm }: OverlayInput) {
  const H = s.bundle.layers.hands, shot = s.bundle.shotAt(t);
  if (!H || !shot) return;
  const th = handThreshold(H) ?? 0;
  for (const hd of s.bundle.handsByShot.get(shot.id) ?? []) {
    // Hands found only by the hand detector, with no body, include faces, logos and bokeh (hand bake-off); hidden unless asked for.
    if (!hd.body && !hd.face && !layers.unlinkedHands) continue;
    const br = bracket(hd.samples, t, H.fps);
    if (!br) continue;
    const S = layers.smooth ? sm.kpts(hd.samples, H.fps, th) : null;
    const kpts = lerpKpts(S ? S[hd.samples.indexOf(br.a)] : br.a.kpts, S ? S[hd.samples.indexOf(br.b)] : br.b.kpts, br.f);
    const p = s.personOfFace(hd.face), col = p ? s.colourOf(p) : '#ffffff';
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.5; g.setLineDash(hd.box_source === 'detector' ? [3, 3] : []);
    let drawn = 0;
    for (const [a, b] of H.skeleton) {
      const ka = kpts[a], kb = kpts[b];
      if (ka[2] < th || kb[2] < th) continue;
      g.beginPath(); g.moveTo(X(m, ka[0]), Y(m, ka[1])); g.lineTo(X(m, kb[0]), Y(m, kb[1])); g.stroke(); drawn++;
    }
    g.setLineDash([]);
    // label only hands that were drawn: a lone L/R with no fingers marked hands too uncertain to show
    if (hd.side && drawn) {
      const box = lerpNums(br.a.box, br.b.box, br.f);
      g.font = '600 10px system-ui, sans-serif'; g.fillText(hd.side[0].toUpperCase(), X(m, box[0]), Y(m, box[1]) - 2);
    }
  }
}

const eyes = (lmk: number[] | null, box: Box): [number, number] => lmk
  ? [lmk.slice(36, 48).reduce((a, b) => a + b, 0) / 12, lmk.slice(68 + 36, 68 + 48).reduce((a, b) => a + b, 0) / 12]
  : [box[0] + box[2] / 2, box[1] + box[3] * 0.4];

/** Eyes (or the face box's upper centre) to the Gaze-LLE heatmap peak, fainter when the model thinks the target is
 *  out of frame, with the target it resolved. */
function drawGazeLLE(g: CanvasRenderingContext2D, { s, t, m }: OverlayInput, f: FaceTrack, box: Box, lmk: number[] | null, col: string) {
  const G = s.bundle.layers.gaze!, samples = s.bundle.gazeOf.get(f.id);
  if (!samples) return;
  const br = bracket(samples, t, G.fps);
  if (!br) return;
  const near = br.f < 0.5 ? br.a : br.b;
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2; g.setLineDash([]);
  if (near.target === 'out' || !br.a.peak || !br.b.peak) {
    g.font = '600 11px system-ui, sans-serif'; g.fillText('looking out of frame', X(m, box[0]), Y(m, box[1] + box[3]) + 14);
    return;
  }
  const [ex, ey] = eyes(lmk, box), [px, py] = lerpNums(br.a.peak, br.b.peak, br.f);
  g.globalAlpha = Math.max(0.35, Math.min(1, near.in_frame ?? 1));
  g.beginPath(); g.moveTo(X(m, ex), Y(m, ey)); g.lineTo(X(m, px), Y(m, py)); g.stroke();
  g.beginPath(); g.arc(X(m, px), Y(m, py), 6, 0, 2 * Math.PI); g.stroke();
  g.globalAlpha = 1;
  if (near.target) { g.font = '600 11px system-ui, sans-serif'; g.fillText(`→ ${s.lookName(near.target)}`, X(m, px) + 8, Y(m, py) - 6); }
}

/** py-feat's 2D gaze angles as a ray from the eyes. */
function drawGazeRay(g: CanvasRenderingContext2D, { m }: OverlayInput, box: Box, d: { lmk: number[]; gaze: number[] }, col: string) {
  const [yaw, pitch] = d.gaze, [ex, ey] = eyes(d.lmk, box), len = box[2] * 1.6;
  const x2 = ex - Math.sin(yaw) * Math.cos(pitch) * len, y2 = ey - Math.sin(pitch) * len;
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2; g.setLineDash([]);
  g.beginPath(); g.moveTo(X(m, ex), Y(m, ey)); g.lineTo(X(m, x2), Y(m, y2)); g.stroke();
  const a = Math.atan2(Y(m, y2) - Y(m, ey), X(m, x2) - X(m, ex));
  g.beginPath(); g.moveTo(X(m, x2), Y(m, y2));
  g.lineTo(X(m, x2) - 9 * Math.cos(a - 0.4), Y(m, y2) - 9 * Math.sin(a - 0.4)); g.lineTo(X(m, x2) - 9 * Math.cos(a + 0.4), Y(m, y2) - 9 * Math.sin(a + 0.4)); g.fill();
}
