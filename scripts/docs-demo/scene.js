// The docs' demo video: two people talking in a café, drawn (nothing in it comes from a study or a film, so its frames
// can be published). One function places everything at time t; the same placement draws the frame and writes the
// bundle's boxes (make-demo.mjs), so the overlays fall on what is drawn. Runs in the browser, on a 1280×720 canvas.

export const W = 1280, H = 720, DURATION = 20, FPS = 25;

export const SHOTS = [
  { start: 0, end: 6, view: 'wide' },
  { start: 6, end: 10, view: 'p1' },
  { start: 10, end: 14, view: 'p2' },
  { start: 14, end: 20, view: 'wide' },
];

// who says what, when (the transcript is written from this, and mouths move with it)
export const LINES = [
  { who: 1, start: 0.6, end: 2.6, text: 'So, did you finish the draft last night?' },
  { who: 2, start: 3.0, end: 5.4, text: 'Almost. The methods section took forever.' },
  { who: 1, start: 6.4, end: 9.6, text: 'I can read it over this afternoon if you send it.' },
  { who: 2, start: 10.4, end: 13.2, text: "That would be great. I'll send it right after this." },
  { who: 1, start: 14.4, end: 15.3, text: 'Deal.' },
  { who: 2, start: 17.0, end: 19.3, text: "And coffee's on me next time." },
];
export const LAUGH = { who: 2, start: 15.5, end: 16.8 };

const PEOPLE = {
  1: { skin: '#e9b48f', shade: '#d99a75', hair: '#3b2a24', shirt: '#2f7f86', shirtShade: '#266a70', style: 'bun', glasses: false },
  2: { skin: '#9a6648', shade: '#86553a', hair: '#1f1a17', shirt: '#d9a43b', shirtShade: '#bf8c2c', style: 'curls', glasses: true },
};

export const shotAt = (t) => SHOTS.findIndex((s) => t >= s.start && t < s.end) === -1 ? SHOTS.length - 1 : SHOTS.findIndex((s) => t >= s.start && t < s.end);
const speaking = (who, t) => LINES.some((l) => l.who === who && t >= l.start && t <= l.end);
const laughing = (who, t) => LAUGH.who === who && t >= LAUGH.start && t <= LAUGH.end;
const bob = (t, phase) => 3.5 * Math.sin(t * 1.3 + phase) + (speaking(phase < 1 ? 1 : 2, t) ? 1.5 * Math.sin(t * 7) : 0);

/** Where everything is at t: heads (centre, radius, which way they face), their face boxes, objects and the sign. */
export function layout(t) {
  const shot = shotAt(t), view = SHOTS[shot].view;
  const into = t - SHOTS[shot].start;
  const heads = [], objects = [], texts = [];
  if (view === 'wide') {
    heads.push({ who: 1, cx: 430, cy: 300 + bob(t, 0), r: 62, facing: 1 });
    heads.push({ who: 2, cx: 850 + (laughing(2, t) ? 6 * Math.sin(t * 20) : 0), cy: 292 + bob(t, 2), r: 62, facing: -1 });
    objects.push({ id: 'cup-1', label: 'cup', box: [522, 452, 50, 54] });
    objects.push({ id: 'cup-2', label: 'cup', box: [742, 450, 50, 56] });
    objects.push({ id: 'laptop', label: 'laptop', box: [236, 352, 178, 118] });
    texts.push({ text: 'CAFÉ LUMEN', box: [904, 66, 272, 64] });
  } else {
    const zoom = 1 + 0.012 * into;   // a slow push in
    const who = view === 'p1' ? 1 : 2;
    heads.push({ who, cx: (who === 1 ? 560 : 720) + (laughing(who, t) ? 8 * Math.sin(t * 20) : 0), cy: 360 + 2.5 * bob(t, who === 1 ? 0 : 2), r: 160 * zoom, facing: who === 1 ? 1 : -1 });
  }
  for (const h of heads) h.face = [h.cx - 0.9 * h.r, h.cy - 1.02 * h.r, 1.8 * h.r, 2.07 * h.r].map((v) => Math.round(v * 10) / 10);
  return { shot, view, heads, objects, texts };
}

// ---- drawing ----

function roundRect(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }

function background(c, view, t) {
  if (view === 'wide') {
    c.fillStyle = '#efe3d0'; c.fillRect(0, 0, W, H);                       // wall
    c.fillStyle = '#e4d4bc'; c.fillRect(0, 330, W, 140);                   // wainscot
    c.fillStyle = '#d8c5aa'; c.fillRect(0, 326, W, 6);
    // window, with a tree outside
    const g = c.createLinearGradient(0, 50, 0, 260); g.addColorStop(0, '#9fc7e3'); g.addColorStop(1, '#d6e8f0');
    c.fillStyle = '#b48a5e'; c.fillRect(52, 42, 316, 228);
    c.fillStyle = g; c.fillRect(62, 52, 296, 208);
    c.fillStyle = '#7fa66a'; c.beginPath(); c.arc(150, 230, 70, 0, Math.PI * 2); c.arc(230, 210, 60, 0, Math.PI * 2); c.arc(300, 240, 50, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#b48a5e'; c.fillRect(205, 52, 8, 208); c.fillRect(62, 150, 296, 8);
    // the sign
    roundRect(c, 904, 66, 272, 64, 10); c.fillStyle = '#2d3a3a'; c.fill();
    c.fillStyle = '#f3e6c8'; c.font = '600 34px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('CAFÉ LUMEN', 1040, 99);
    // pendant lamps
    for (const x of [640, 1060]) {
      c.strokeStyle = '#5b4a3a'; c.lineWidth = 2; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 150); c.stroke();
      c.fillStyle = '#3e5c58'; c.beginPath(); c.moveTo(x - 38, 186); c.lineTo(x - 14, 150); c.lineTo(x + 14, 150); c.lineTo(x + 38, 186); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,236,170,0.9)'; c.beginPath(); c.ellipse(x, 188, 26, 6, 0, 0, Math.PI * 2); c.fill();
    }
    // plant
    c.fillStyle = '#a0603e'; roundRect(c, 1150, 380, 90, 90, 8); c.fill();
    c.fillStyle = '#5f8f55';
    for (let k = 0; k < 7; k++) { c.beginPath(); c.ellipse(1195 + 30 * Math.cos(k), 330 + 12 * Math.sin(k * 2), 18, 58, -0.6 + k * 0.2, 0, Math.PI * 2); c.fill(); }
  } else {
    // a close-up: the room out of focus
    const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#e8dac4'); g.addColorStop(1, '#d9c6a8');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const bokeh = view === 'p1' ? [[1000, 160, 90, 'rgba(255,240,200,0.55)'], [1150, 420, 120, 'rgba(160,200,170,0.35)'], [880, 560, 70, 'rgba(255,220,160,0.4)']]
      : [[230, 170, 100, 'rgba(255,240,200,0.55)'], [120, 460, 130, 'rgba(160,190,220,0.35)'], [380, 600, 80, 'rgba(255,220,160,0.4)']];
    for (const [x, y, r, col] of bokeh) { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
  }
}

function person(c, h, t) {
  const p = PEOPLE[h.who], r = h.r, f = h.facing, { cx, cy } = h;
  const talk = speaking(h.who, t), laugh = laughing(h.who, t);
  const blink = (t + h.who * 1.7) % 3.7 < 0.13;
  // body
  c.fillStyle = p.shirt;
  c.beginPath(); c.moveTo(cx - 1.45 * r, H + 10); c.lineTo(cx - 1.25 * r, cy + 1.45 * r);
  c.quadraticCurveTo(cx, cy + 1.05 * r, cx + 1.25 * r, cy + 1.45 * r); c.lineTo(cx + 1.45 * r, H + 10); c.closePath(); c.fill();
  c.fillStyle = p.shirtShade; c.beginPath(); c.ellipse(cx + 0.05 * r * f, cy + 1.32 * r, 0.42 * r, 0.16 * r, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = p.shade; roundRect(c, cx - 0.26 * r, cy + 0.7 * r, 0.52 * r, 0.62 * r, 0.12 * r); c.fill();   // neck
  // hair behind
  c.fillStyle = p.hair;
  if (p.style === 'bun') { c.beginPath(); c.arc(cx - 0.2 * r * f, cy - 1.05 * r, 0.42 * r, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(cx - 0.08 * r * f, cy - 0.05 * r, 0.98 * r, 1.08 * r, 0, 0, Math.PI * 2); c.fill(); }
  // ear and head
  c.fillStyle = p.shade; c.beginPath(); c.ellipse(cx - 0.8 * r * f, cy + 0.08 * r, 0.16 * r, 0.22 * r, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = p.skin; c.beginPath(); c.ellipse(cx, cy, 0.86 * r, r, 0, 0, Math.PI * 2); c.fill();
  // hair in front
  c.fillStyle = p.hair;
  if (p.style === 'bun') {
    c.beginPath(); c.ellipse(cx - 0.1 * r * f, cy - 0.62 * r, 0.86 * r, 0.46 * r, -0.15 * f, Math.PI, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(cx - 0.86 * r, cy - 0.5 * r); c.quadraticCurveTo(cx + 0.3 * r * f, cy - 0.15 * r, cx + 0.86 * r, cy - 0.55 * r); c.lineTo(cx + 0.8 * r, cy - 0.8 * r); c.lineTo(cx - 0.8 * r, cy - 0.8 * r); c.fill();
  } else {
    for (let k = 0; k < 11; k++) { const a = Math.PI * (1.05 + 0.9 * k / 10); c.beginPath(); c.arc(cx + 0.78 * r * Math.cos(a), cy - 0.25 * r + 0.78 * r * Math.sin(a), 0.24 * r, 0, Math.PI * 2); c.fill(); }
  }
  // face
  const ex = 0.3 * r, ey = cy - 0.06 * r, sx = 0.16 * r * f;
  c.strokeStyle = p.hair; c.lineWidth = Math.max(2, 0.05 * r); c.lineCap = 'round';
  for (const s of [-1, 1]) { c.beginPath(); c.moveTo(cx + sx + s * ex - 0.13 * r, ey - 0.22 * r - (laugh ? 0.04 * r : 0)); c.quadraticCurveTo(cx + sx + s * ex, ey - 0.29 * r, cx + sx + s * ex + 0.13 * r, ey - 0.22 * r); c.stroke(); }
  c.fillStyle = '#2a211d'; c.strokeStyle = '#2a211d';
  for (const s of [-1, 1]) {
    const x = cx + sx + s * ex;
    if (blink || laugh) { c.lineWidth = Math.max(2, 0.04 * r); c.beginPath(); c.arc(x, ey + (laugh ? 0.03 * r : 0), 0.07 * r, laugh ? Math.PI * 1.1 : 0.1 * Math.PI, laugh ? Math.PI * 1.9 : 0.9 * Math.PI, false); c.stroke(); }
    else { c.beginPath(); c.ellipse(x + 0.02 * r * f, ey, 0.062 * r, 0.08 * r, 0, 0, Math.PI * 2); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(x + 0.04 * r * f, ey - 0.03 * r, 0.018 * r, 0, Math.PI * 2); c.fill(); c.fillStyle = '#2a211d'; }
  }
  if (p.glasses) {
    c.strokeStyle = '#2b2b2b'; c.lineWidth = Math.max(2, 0.035 * r);
    for (const s of [-1, 1]) { roundRect(c, cx + sx + s * ex - 0.16 * r, ey - 0.13 * r, 0.32 * r, 0.25 * r, 0.08 * r); c.stroke(); }
    c.beginPath(); c.moveTo(cx + sx - ex + 0.16 * r, ey - 0.02 * r); c.lineTo(cx + sx + ex - 0.16 * r, ey - 0.02 * r); c.stroke();
  }
  c.strokeStyle = p.shade; c.lineWidth = Math.max(2, 0.04 * r);   // nose
  c.beginPath(); c.moveTo(cx + sx + 0.02 * r * f, ey + 0.05 * r); c.quadraticCurveTo(cx + sx + 0.12 * r * f, ey + 0.26 * r, cx + sx - 0.02 * r * f, ey + 0.28 * r); c.stroke();
  c.fillStyle = 'rgba(214,110,100,0.18)';                        // cheeks
  for (const s of [-1, 1]) { c.beginPath(); c.arc(cx + sx + s * 0.42 * r, cy + 0.26 * r, 0.12 * r, 0, Math.PI * 2); c.fill(); }
  const mx = cx + sx * 0.8, my = cy + 0.48 * r, mw = (laugh ? 0.26 : 0.17) * r;
  const open = laugh ? 0.2 * r : talk ? 0.04 * r + 0.1 * r * Math.abs(Math.sin(t * 13 + h.who)) : 0;
  if (open > 0.01 * r) { c.fillStyle = '#7a2e2e'; c.beginPath(); c.ellipse(mx, my, mw, open, 0, 0, Math.PI * 2); c.fill(); if (laugh) { c.fillStyle = '#fff'; c.fillRect(mx - 0.8 * mw, my - open, 1.6 * mw, 0.35 * open); } }
  else { c.strokeStyle = '#8a3b36'; c.lineWidth = Math.max(2, 0.04 * r); c.beginPath(); c.moveTo(mx - mw, my - 0.02 * r); c.quadraticCurveTo(mx, my + 0.07 * r, mx + mw, my - 0.02 * r); c.stroke(); }
}

function table(c) {
  c.fillStyle = '#9b6b45'; c.fillRect(0, 470, W, 250);
  c.fillStyle = '#b27c51'; c.fillRect(0, 470, W, 14);
}

function cup(c, [x, y, w, h], col) {
  c.fillStyle = 'rgba(0,0,0,0.12)'; c.beginPath(); c.ellipse(x + w / 2, y + h, w * 0.7, 7, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = col; roundRect(c, x, y + 6, w - 10, h - 6, [2, 2, 12, 12]); c.fill();
  c.strokeStyle = col; c.lineWidth = 6; c.beginPath(); c.arc(x + w - 10, y + h / 2 + 2, 11, -Math.PI / 2, Math.PI / 2); c.stroke();
  c.fillStyle = '#5a3a26'; c.beginPath(); c.ellipse(x + (w - 10) / 2, y + 8, (w - 10) / 2, 5, 0, 0, Math.PI * 2); c.fill();
}

function laptop(c, [x, y, w, h]) {
  c.fillStyle = '#b9bec4'; c.beginPath(); c.moveTo(x + 10, y); c.lineTo(x + w - 10, y); c.lineTo(x + w, y + h - 10); c.lineTo(x, y + h - 10); c.closePath(); c.fill();
  c.fillStyle = '#9ea4ab'; c.fillRect(x - 6, y + h - 12, w + 12, 12);
  c.fillStyle = '#e7eaee'; c.beginPath(); c.arc(x + w / 2, y + h / 2 - 6, 12, 0, Math.PI * 2); c.fill();
}

export function draw(c, t) {
  const L = layout(t);
  c.save();
  background(c, L.view, t);
  if (L.view === 'wide') {
    for (const h of L.heads) person(c, h, t);
    table(c);
    cup(c, L.objects[0].box, '#f4f1ec'); cup(c, L.objects[1].box, '#2f5d8a'); laptop(c, L.objects[2].box);
  } else {
    person(c, L.heads[0], t);
  }
  c.restore();
  return L;
}
