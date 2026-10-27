// The Annotator page: the viewer, the whole width, with the video's name in its header the switcher between videos,
// against browser mode's scripted library (?library-demo): Tauri is absent here, and importing and locating a video are
// tested in Rust against real bundles. The demo's bundles are the bake-off's at /devdata; tests that open one skip
// themselves when it is not served (CI). Also the rail around it, and the viewer's header, panel and timeline toolbar.
import { expect, test, type Page } from '@playwright/test';

/** The switcher's button: the open video's name. */
const switcher = (page: Page) => page.getByRole('button', { name: /^Switch video, now / });
/** The switcher, opened: the list of videos. */
async function videos(page: Page) {
  await switcher(page).click();
  return page.getByRole('dialog', { name: /^Switch video, now / }).getByRole('list', { name: 'Videos' });
}
const video = async (page: Page, title: string) => (await videos(page)).getByRole('button', { name: new RegExp(`^${title}`) });
async function needsData(page: Page) {
  const res = await page.request.get('/devdata/runs/ooo-genz-clip1/bundle/manifest.json');
  test.skip(!res.ok(), 'the bake-off data is not served at /devdata');
}
/** The viewer, loaded: its shot, under the video. */
const loaded = (page: Page) => expect(page.getByRole('heading', { level: 2, name: /^Shot 1 of / })).toBeVisible();
const panel = (page: Page) => page.getByRole('navigation', { name: 'Panel' });

test('the page is the annotator: it opens the newest bundle, not a list to get through first', async ({ page }) => {
  await needsData(page);
  await page.goto('/?library-demo');
  await expect(page.getByRole('button', { name: 'Switch video, now ooo-genz-clip1' })).toBeVisible();   // the viewer's header
  await loaded(page);
  await expect(await video(page, 'ooo-genz-clip1')).toHaveAttribute('aria-current', 'true');
});

test('it opens the bundle last opened here again', async ({ page }) => {
  await needsData(page);
  await page.goto('/?library-demo');
  await (await video(page, 'nes-biking')).click();
  await expect(page.getByRole('button', { name: 'Switch video, now nes-biking' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Switch video, now nes-biking' })).toBeVisible();
});

test('the switcher lists the videos, marks the open one, and opens another', async ({ page }) => {
  await needsData(page);
  await page.goto('/?library-demo');
  await loaded(page);
  const list = await videos(page);
  await expect(list.getByRole('button')).toHaveText([/ooo-genz-clip1/, /ooo-genz-clip2/, /nes-biking/]);
  await expect(list.getByRole('button', { name: /^nes-biking/ })).not.toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('searchbox', { name: 'Find a video' })).toHaveCount(0);   // only for more than 6
  const menu = page.getByRole('dialog', { name: /^Switch video, now / });
  await expect(menu.getByRole('button', { name: 'Import…' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Extract from a video…' })).toBeVisible();
  await list.getByRole('button', { name: /^nes-biking/ }).click();
  await expect(menu).toHaveCount(0);                                                    // closed by choosing
  await expect(page.getByRole('button', { name: 'Switch video, now nes-biking' })).toBeVisible();
  await loaded(page);
  await expect(await video(page, 'nes-biking')).toHaveAttribute('aria-current', 'true');
  await expect(list.getByRole('button', { name: /^ooo-genz-clip1/ })).not.toHaveAttribute('aria-current', 'true');
});

test('each video in the switcher says what needs care', async ({ page }) => {
  await page.goto('/?library-demo');
  const list = await videos(page);
  await expect(list.getByRole('button', { name: /^ooo-genz-clip1/ })).toContainText('Academic use only');   // the strictest of its layers
  await expect(list.getByRole('button', { name: /^nes-biking/ })).toContainText('Licence under review');
  await expect(list.getByRole('button', { name: /^ooo-genz-clip2/ })).toContainText('No video');
  await expect(list).not.toContainText('academic-only');
});

test('a bundle without its video asks for it, then opens', async ({ page }) => {
  await needsData(page);
  await page.goto('/?library-demo');
  await (await video(page, 'ooo-genz-clip2')).click();
  await expect(page.getByText('ooo-genz-clip2 needs its video.')).toBeVisible();
  await page.getByRole('button', { name: 'Locate video…' }).click();
  await expect(page.getByText('ooo-genz-clip2 needs its video.')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: /^Shot 1 of / })).toBeVisible();   // the viewer, loaded
  await expect(await video(page, 'ooo-genz-clip2')).not.toContainText('No video');
});

test('with no bundles yet, the page offers the two ways to get one; an imported one opens', async ({ page }) => {
  await page.goto('/?library-demo=empty');
  await expect(page.getByText('Nothing to annotate yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Extract from a video…' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import…' })).toHaveCount(1);   // offered once
  await page.getByRole('button', { name: 'Import…' }).click();
  await expect(page.getByText('imported-clip needs its video.')).toBeVisible();      // the demo's import has none
  await expect(await video(page, 'imported-clip')).toHaveAttribute('aria-current', 'true');
});

test('the rail is as wide as its labels, however large the system draws them', async ({ page }) => {
  await page.goto('/?library-demo');
  // the app's web view drew the labels larger than a browser does, and a fixed-width rail cut "Annotator" off
  await page.addStyleTag({ content: '.rail .label { font-size: 15px !important; }' });
  const rail = page.getByRole('navigation', { name: 'App' });
  for (const name of ['Extract', 'Annotator', 'Settings']) {
    const [label, item, nav] = await Promise.all([rail.getByRole('button', { name }).locator('.label').boundingBox(),
      rail.getByRole('button', { name }).boundingBox(), rail.boundingBox()]);
    expect(label!.x).toBeGreaterThanOrEqual(item!.x);
    expect(label!.x + label!.width).toBeLessThanOrEqual(item!.x + item!.width);
    expect(item!.x).toBeGreaterThanOrEqual(nav!.x);
  }
});

// --- the viewer: its panel, its timeline's layers, and the export ------------------------------------------------------

test('the Details tab says what the video is, what may be done with it, and its layers', async ({ page }) => {
  await needsData(page);
  await page.goto('/?library-demo');
  await loaded(page);
  await panel(page).getByRole('button', { name: 'Details' }).click();
  await expect(panel(page).getByRole('button', { name: 'Details' })).toHaveAttribute('aria-pressed', 'true');
  const manifest = await (await page.request.get('/devdata/runs/ooo-genz-clip1/bundle/manifest.json')).json();
  await expect(page.getByRole('heading', { level: 2, name: manifest.video.filename ?? 'This video' })).toBeVisible();
  await expect(page.locator('p.licence')).toHaveText('Academic use only');          // the strictest of its layers
  await expect(page.getByRole('heading', { name: 'Layers' })).toBeVisible();
  for (const name of Object.keys(manifest.layers))
    await expect(page.locator('.layers').getByText(name.charAt(0).toUpperCase() + name.slice(1), { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import edits from a file…' })).toBeVisible();
});

test('the keyboard keys show only when asked for, by ? or its button', async ({ page }) => {
  await needsData(page);
  await page.goto('/?library-demo');
  await loaded(page);
  const keys = page.locator('.help');
  await expect(keys).toHaveCount(0);
  await page.keyboard.press('?');
  await expect(keys).toContainText('play');
  await expect(panel(page).getByRole('button', { name: 'Keyboard keys' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('?');
  await expect(keys).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Keyboard keys' }).click();
  await expect(keys).toContainText('hide these');
  await panel(page).getByRole('button', { name: 'Keyboard keys' }).click();
  await expect(keys).toHaveCount(0);
});

test('the Layers menu hides a group from the timeline and shows it again', async ({ page }) => {
  await needsData(page);
  await page.goto('/?library-demo');
  await loaded(page);
  const audio = page.locator('[data-group-header="audio"]');
  await expect(audio).toBeVisible();
  await page.getByRole('button', { name: 'Layers shown in the timeline' }).click();
  const menu = page.getByRole('dialog', { name: 'Layers shown in the timeline' });
  const box = menu.getByRole('checkbox', { name: 'Audio' });
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect(audio).toHaveCount(0);
  await expect(page.locator('[data-group-header="people"]')).toBeVisible();          // only that group
  await box.check();
  await expect(audio).toBeVisible();
});

test('Export saves the annotated result, with the edits, as <title>.annotated.json', async ({ page }) => {
  await needsData(page);
  await page.goto('/?library-demo');
  await loaded(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export…' }).click()]);
  expect(download.suggestedFilename()).toBe('ooo-genz-clip1.annotated.json');
  const saved = JSON.parse(await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8')));
  expect(saved.format).toBe('perception-annotated/1');
  expect(Array.isArray(saved.edits)).toBe(true);
});

test('an on/off switch in the panel looks on when on and off when off (the switcher\'s style is its own)', async ({ page }) => {
  await page.goto('/?library-demo');
  await needsData(page);
  await loaded(page);
  const toggle = page.locator('.toggle', { hasText: 'Send this caption to agents' });
  const track = toggle.locator('.switch');
  const colour = () => track.evaluate((el) => getComputedStyle(el).backgroundColor);
  const before = await colour();
  const was = await toggle.locator('input').isChecked();
  await toggle.click();
  await expect(toggle.locator('input')).toBeChecked({ checked: !was });
  await expect.poll(colour).not.toBe(before);   // after its 0.15 s transition
  expect(before).not.toBe('rgba(0, 0, 0, 0)');   // drawn either way, not see-through
});
