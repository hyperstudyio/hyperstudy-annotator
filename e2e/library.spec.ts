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
/** The viewer, loaded: Inspect waiting for a selection, beside the video. */
const loaded = (page: Page) => expect(page.getByText('Select a face on the video, or anything on the timeline, to edit it here.')).toBeVisible();
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
  await loaded(page);
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

test('a timeline group says which models made it, each linked to its page, and what its licence allows', async ({ page }) => {
  await needsData(page);
  await page.goto('/?library-demo');
  await loaded(page);
  const info = page.getByRole('button', { name: 'The models behind Audio & speech', exact: true });
  await page.locator('[data-group-header="audio"] .lane-label').hover();
  await info.click();
  const models = page.getByRole('dialog', { name: 'The models behind Audio & speech' });
  await expect(models.getByRole('button', { name: 'nvidia/parakeet-tdt-0.6b-v3' })).toBeVisible();   // a link: its page is known
  await expect(models.getByText('mlx-community conversion')).toBeVisible();                         // the rest of its id, as a note
  await expect(models.getByText('Commercial use allowed').first()).toBeVisible();
  // drawn above the timeline's labels, not under them
  const box = (await models.boundingBox())!;
  const top = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[role=dialog]'), [box.x + 8, box.y + box.height / 2]);
  expect(top).toBe(true);
});

test('Inspect edits the one thing selected; Back returns to what was selected before', async ({ page }) => {
  await needsData(page);
  await page.goto('/?library-demo');
  await loaded(page);
  await expect(page.getByText(/agents/i)).toHaveCount(0);
  await page.locator('.bar.caption').nth(10).click();   // a shot's caption, on the timeline
  await expect(page.getByRole('textbox', { name: 'Shot caption' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'People in this shot' })).toHaveCount(0);   // the timeline shows them
  const shot = await page.getByRole('heading', { level: 2, name: /^Shot \d+ of / }).textContent();
  await page.locator('.bar.speech, .bar.vis').first().click();   // something else on the timeline
  await expect(page.getByRole('heading', { level: 2, name: /^Shot \d+ of / })).toHaveCount(0);
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.getByRole('heading', { level: 2, name: shot! })).toBeVisible();
});

test('People opens a person in place, and All people goes back to the list', async ({ page }) => {
  await needsData(page);
  await page.goto('/?library-demo');
  await loaded(page);
  await panel(page).getByRole('button', { name: 'People' }).click();
  await page.locator('.drawer-panel .item').first().click();
  await expect(panel(page).getByRole('button', { name: 'People' })).toHaveAttribute('aria-pressed', 'true');   // still People
  await expect(page.getByRole('heading', { name: 'Appearances' })).toBeVisible();
  await page.getByRole('button', { name: '← All people' }).click();
  await expect(page.getByText('Who face clustering found.', { exact: false })).toBeVisible();
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


test('an overlay is a row you click to turn on, lit when on, and its style (colour, opacity, width) is kept', async ({ page }) => {
  await needsData(page);
  await page.goto('/?library-demo');
  await loaded(page);
  await page.getByRole('button', { name: 'What the video shows' }).click();
  const menu = page.getByRole('dialog', { name: 'What the video shows' });
  await expect(menu.getByRole('checkbox')).toHaveCount(0);   // rows, not checkboxes
  const faces = menu.getByRole('button', { name: 'Faces', exact: true });
  const was = await faces.getAttribute('aria-pressed');
  await faces.click();
  await expect(faces).toHaveAttribute('aria-pressed', was === 'true' ? 'false' : 'true');
  await faces.click();   // back as it was
  await expect(faces).toHaveAttribute('aria-pressed', was ?? 'false');
  if (was !== 'true') await faces.click();   // on, to style it
  await expect(faces).toHaveAttribute('aria-pressed', 'true');
  await menu.getByRole('button', { name: 'How faces are drawn' }).click();
  await menu.getByLabel('Faces: opacity').fill('0.5');
  await expect(menu.getByText('50%')).toBeVisible();
  await menu.getByLabel('Faces: one colour').evaluate((el: HTMLInputElement) => { el.value = '#ff00ff'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(menu.getByRole('button', { name: 'By person' })).toHaveAttribute('aria-pressed', 'false');
  await page.reload();   // kept for this video, in this browser
  await loaded(page);
  await page.getByRole('button', { name: 'What the video shows' }).click();
  await menu.getByRole('button', { name: 'How faces are drawn' }).click();
  await expect(menu.getByText('50%')).toBeVisible();
  await menu.getByRole('button', { name: 'Reset' }).click();
  await expect(menu.getByText('100%')).toBeVisible();
  await expect(menu.getByRole('button', { name: 'By person' })).toHaveAttribute('aria-pressed', 'true');
});

test('a pop-up near the foot of the window opens upward, inside the window', async ({ page }) => {
  await needsData(page);
  await page.goto('/?library-demo');
  await loaded(page);
  // the lowest group name still on screen, with a list of models
  const key = await page.evaluate(() => {
    const heads = [...document.querySelectorAll<HTMLElement>('[data-group-header]')]
      .filter((h) => h.querySelector('button[aria-label^="The models behind"]') && h.getBoundingClientRect().bottom < window.innerHeight - 4);
    return heads.at(-1)?.dataset.groupHeader ?? null;
  });
  expect(key).not.toBeNull();
  const head = page.locator(`[data-group-header="${key}"] .lane-label`);
  await head.hover();
  await head.getByRole('button', { name: /^The models behind/ }).click();
  const panel = page.getByRole('dialog', { name: /^The models behind/ });
  const box = (await panel.boundingBox())!, vh = page.viewportSize()!.height;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(vh);
});

test('Tab past either end of a pop-up closes it and returns to its button', async ({ page }) => {
  await needsData(page);
  await page.goto('/?library-demo');
  await loaded(page);
  const button = page.getByRole('button', { name: 'Layers shown in the timeline' });
  const panel = page.getByRole('dialog', { name: 'Layers shown in the timeline' });
  await button.click();
  await expect(panel.getByRole('checkbox').first()).toBeFocused();   // it takes the keyboard
  await page.keyboard.press('Shift+Tab');
  await expect(panel).toHaveCount(0);
  await expect(button).toBeFocused();
  await button.click();
  const n = await panel.getByRole('checkbox').count();
  for (let i = 0; i < n; i++) await page.keyboard.press('Tab');
  await expect(panel).toHaveCount(0);
  await expect(button).toBeFocused();
});

test('⌫ outside a text field never takes the app off its page (WebKit goes back on it)', async ({ page }) => {
  await needsData(page);
  await page.goto('/?library-demo');
  await loaded(page);
  const here = page.url();
  await page.getByRole('button', { name: 'Layers shown in the timeline' }).click();
  await page.getByRole('dialog', { name: 'Layers shown in the timeline' }).getByRole('checkbox').first().focus();
  await page.keyboard.press('Backspace');
  await expect(page).toHaveURL(here);
  await expect(page.getByRole('dialog', { name: 'Layers shown in the timeline' })).toBeVisible();
});
