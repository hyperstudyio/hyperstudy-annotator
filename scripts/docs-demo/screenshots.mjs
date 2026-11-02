// The docs' screenshots of the app, in browser mode: the Annotator on the demo bundle (make-demo.mjs), and Extract and
// Settings on the scripted stand-in (?pipeline-demo). Needs the dev server (npm run dev) and the demo served with CORS:
//   node scripts/docs-demo/make-demo.mjs
//   python3 scripts/docs-demo/serve.py &                     # out/, at http://127.0.0.1:8799
//   node scripts/docs-demo/screenshots.mjs [out]             (out: scripts/docs-demo/out/shots)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? join(here, 'out', 'shots');
const APP = process.env.APP ?? 'http://localhost:1420', DATA = process.env.DATA ?? 'http://127.0.0.1:8799';
const DEMO = `${APP}/?bundle=${DATA}/bundle&video=${DATA}/cafe.mp4`;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
/** A screenshot of the window, or of its left part (clip: width and height in CSS pixels) when the page uses only that. */
const shot = async (page, name, clip) => {
  // what is on screen is the page's last state: no toast over it, its fade (and any other transition) ended, and two
  // frames drawn since the last change (the overlay and timeline draw in requestAnimationFrame)
  await page.locator('.toast.show').waitFor({ state: 'detached' });
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished)));
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.screenshot({ path: join(out, `${name}.png`), ...(clip ? { clip: { x: 0, y: 0, ...clip } } : {}) });
  console.log(name);
};

/** The demo, opened fresh (its edits are kept in the page's storage), paused at t. */
async function demo(t = 0) {
  const page = await context.newPage();
  await page.goto(DEMO);
  await page.locator('.tl-content').waitFor();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('.tl-content').waitFor();
  await page.locator('video').evaluate((v, t) => new Promise((done) => { v.pause(); v.currentTime = t; v.addEventListener('seeked', done, { once: true }); }), t);
  return page;
}
const bar = (page, text) => page.locator('.tl-content .bar').filter({ hasText: text }).first();

// The Annotator: the laugh in the last shot, nothing selected
{
  const page = await demo(15.9);
  await shot(page, 'annotator');
  // who is speaking: "Deal." was given to the wrong face
  await bar(page, 'Deal.').click();
  await bar(page, 'Deal.').click();   // the second click stops the clip
  await page.locator('video').evaluate((v) => new Promise((done) => { v.pause(); v.currentTime = 14.8; v.addEventListener('seeked', done, { once: true }); }));
  await shot(page, 'who-is-speaking');
  await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: 'Panel' }).getByRole('button', { name: 'Review' }).click();
  await shot(page, 'review');
  await page.close();
}

// Annotating: a Tone type, and each shot given one
{
  const page = await demo(0);
  for (const g of ['objects', 'social', 'sounds']) await page.locator(`[data-group-header="${g}"] .group-label`).click();   // room for the type's row
  const header = page.locator('[data-group-header="annotations"]');
  await header.scrollIntoViewIfNeeded();
  await header.getByRole('button', { name: 'New annotation type', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New annotation type' });
  await form.getByLabel('Type name').fill('Tone');
  await form.getByLabel('Value kind').selectOption('category');
  for (const c of ['friendly', 'tense', 'playful']) { await form.getByLabel('Add a category').fill(c); await form.getByLabel('Add a category').press('Enter'); }
  await form.getByLabel('About').selectOption('scene');
  await form.getByRole('button', { name: 'Add type' }).click();
  for (const key of ['1', '1', '1', '3']) {
    await page.keyboard.press('a');
    await page.keyboard.press(key);
    await page.keyboard.press('Escape');
    await page.keyboard.press('.');
  }
  await page.locator('video').evaluate((v) => new Promise((done) => { v.pause(); v.currentTime = 16; v.addEventListener('seeked', done, { once: true }); }));
  await page.locator('[data-group="annotations"] .bar').last().click();
  await page.locator('[data-group="annotations"] .bar').last().click();
  await shot(page, 'annotations');
  await page.close();
}

// Extract: a video chosen, the plan on screen
async function extract(variant) {
  const page = await context.newPage();
  await page.goto(`${APP}/?pipeline-demo${variant ? `=${variant}` : ''}`);
  const region = page.getByRole('region', { name: 'Extract' });
  await region.getByRole('button', { name: 'Choose a video…' }).click();
  await region.getByRole('heading', { name: /steps? to run/ }).waitFor();
  return { page, region };
}
{
  const { page, region } = await extract('objects');
  await region.getByRole('checkbox', { name: 'Run Shot captions' }).check();
  await region.getByRole('heading', { name: /steps? to run/ }).waitFor();
  await shot(page, 'extract', { width: 1000, height: 900 });
  await page.close();
}
{
  const { page, region } = await extract('pod');
  await region.getByRole('radiogroup', { name: 'Run on' }).getByRole('radio', { name: 'RunPod' }).check();
  await region.getByText(/at most/).waitFor();
  await shot(page, 'extract-runpod', { width: 1000, height: 900 });
  await page.close();
}

// Settings
async function settings(variant, tab) {
  const page = await context.newPage();
  await page.goto(`${APP}/?pipeline-demo=${variant}`);
  await page.getByRole('navigation', { name: 'App' }).getByRole('button', { name: 'Settings' }).click();
  const region = page.getByRole('region', { name: 'Settings' });
  await region.getByRole('tab', { name: tab }).click();
  return { page, region };
}
{
  const { page } = await settings('pod', 'Compute');
  await shot(page, 'settings-compute', { width: 840, height: 740 });
  await page.close();
}
{
  const { page } = await settings('gated', 'Models');
  await shot(page, 'settings-models', { width: 840, height: 900 });
  await page.close();
}

await browser.close();
