// The drag-range bug: one drag across 12.1–16.9 s of the timeline looped 23.7–33.2 s. The timeline's scale (pixels
// per second) is fitted to its width, and the viewer's grid column took the width of its widest unwrapped content: a
// shot caption, or the zoomed timeline itself. So the scale changed whenever the playhead entered a shot with a
// different caption (measured 10.5, 13.5 and 24.6 px/s at one window size), and the page grew past the window. A drag
// read on one scale was shown, or converted, on another.
import { expect, test, type Page } from '@playwright/test';

const URL = '/?bundle=/devdata/runs/ooo-genz-clip1/bundle&video=/devdata/data/ooo-genz-clip1.mp4';

async function open(page: Page) {
  const res = await page.request.get('/devdata/runs/ooo-genz-clip1/bundle/manifest.json');
  test.skip(!res.ok(), 'the bake-off data is not served at /devdata');
  await page.goto(URL);
  await page.locator('.tl-content').waitFor();
  await page.waitForFunction(() => (document.querySelector('video') as HTMLVideoElement | null)?.readyState! >= 1);
}

const layout = (page: Page) => page.evaluate(() => ({
  doc: document.documentElement.scrollWidth, inner: window.innerWidth,
  scroller: document.querySelector('.tl-scroll')!.clientWidth, content: document.querySelector<HTMLElement>('.tl-content')!.style.width,
}));

async function seek(page: Page, t: number) {
  await page.evaluate((t) => new Promise<void>((done) => {
    const v = document.querySelector('video')!;
    v.addEventListener('seeked', () => done(), { once: true });
    v.currentTime = t;
  }), t);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));   // two frames: layout and resize observers settle
}

test('the timeline keeps its scale and the page its width, whatever shot is on screen or how far it is zoomed', async ({ page }) => {
  await open(page);
  const first = await layout(page);
  expect(first.doc).toBe(first.inner);
  for (const t of [12.1, 22.5, 60, 100]) {   // shots whose captions are short, long, and longer than the window
    await seek(page, t);
    expect(await layout(page)).toEqual(first);
  }
  await page.locator('.zoom input').fill('12');
  const zoomed = await layout(page);
  expect(zoomed.doc).toBe(first.inner);
  expect(zoomed.scroller).toBe(first.scroller);
});

test('a drag across empty timeline loops the range under the pointer, and the shading stays where the drag was', async ({ page }) => {
  await open(page);
  // the ruler's own labels give the scale on screen
  const tickX = async (label: string) => (await page.locator('.tick', { hasText: new RegExp(`^${label}$`) }).boundingBox())!.x;
  const x10 = await tickX('0:10'), x20 = await tickX('0:20'), pxPerS = (x20 - x10) / 10;
  const xAt = (t: number) => x10 + (t - 10) * pxPerS;
  const lane = (await page.locator('[data-row="waveform"] .lane-body').boundingBox())!;
  const y = lane.y + lane.height / 2;
  await page.mouse.move(xAt(12.1), y);
  await page.mouse.down();
  await page.mouse.move(xAt(14.5), y, { steps: 5 });
  await page.mouse.move(xAt(16.9), y, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(() => { const v = document.querySelector('video')!; return v.currentTime > 12 && v.currentTime < 17.5; });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const shade = (await page.locator('.clip-span').boundingBox())!;
  expect(Math.abs(shade.x - xAt(12.1))).toBeLessThan(2);
  expect(Math.abs(shade.x + shade.width - xAt(16.9))).toBeLessThan(2);
  expect(await tickX('0:10')).toBeCloseTo(x10, 0);   // the scale did not change under the user
});
