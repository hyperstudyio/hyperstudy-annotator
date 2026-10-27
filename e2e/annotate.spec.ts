// Annotation types live on the timeline: + Type on the Annotations row makes one (or copies another video's), its row
// name opens it to edit, and A, [ ] and a drag across its row annotate; keys give the selected annotation its value.
import { expect, test, type Page } from '@playwright/test';

const URL = '/?bundle=/devdata/runs/ooo-genz-clip1/bundle&video=/devdata/data/ooo-genz-clip1.mp4';
const SHOTS = process.env.SHOTS;   // a folder to save screenshots in, when looking at the design

async function open(page: Page) {
  const res = await page.request.get('/devdata/runs/ooo-genz-clip1/bundle/manifest.json');
  test.skip(!res.ok(), 'the bake-off data is not served at /devdata');
  await page.goto(URL);
  await page.locator('.tl-content').waitFor();
}
const header = (page: Page) => page.locator('[data-group-header="annotations"]');
const typeRow = (page: Page, name: string) => page.locator('[data-group="annotations"]').filter({ hasText: name });

test('a type is added from the Annotations row, and A then a number key annotate what is selected', async ({ page }) => {
  await open(page);
  await header(page).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Annotate', exact: true })).toHaveCount(0);   // no Annotate tab
  await header(page).getByRole('button', { name: 'New annotation type', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New annotation type' });
  await form.getByLabel('Type name').fill('Mental state');
  await form.getByLabel('Value kind').selectOption('category');
  for (const c of ['happy', 'sad', 'neutral']) { await form.getByLabel('Add a category').fill(c); await form.getByLabel('Add a category').press('Enter'); }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/type-new.png` });
  await form.getByRole('button', { name: 'Add type' }).click();
  await expect(typeRow(page, 'Mental state')).toBeVisible();
  await page.keyboard.press('a');   // nothing selected: the shot under the playhead
  await expect(page.getByRole('heading', { name: /Mental state/ })).toBeVisible();
  await page.keyboard.press('2');
  await expect(typeRow(page, 'Mental state').locator('.bar')).toHaveText('sad');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/annotated.png` });
});

test("a type in use keeps what its annotations depend on, and is deleted once none use it", async ({ page }) => {
  await open(page);
  await header(page).scrollIntoViewIfNeeded();
  await header(page).getByRole('button', { name: 'New annotation type', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New annotation type' });
  await form.getByLabel('Type name').fill('Gaze aversion');
  await form.getByRole('button', { name: 'Add type' }).click();
  await page.keyboard.press('a');
  await page.keyboard.press('y');
  await expect(typeRow(page, 'Gaze aversion').locator('.bar')).toContainText('yes');

  await typeRow(page, 'Gaze aversion').getByRole('button', { name: 'Annotation type Gaze aversion', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Annotation type Gaze aversion' });
  await expect(edit.getByLabel('Value kind')).toBeDisabled();
  await expect(edit.getByRole('button', { name: 'Delete type' })).toBeDisabled();
  await expect(edit).toContainText('1 annotation uses it');
  await edit.getByLabel('Type name').fill('Looks away');
  await edit.getByLabel('Type name').press('Enter');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/type-edit.png` });
  await expect(typeRow(page, 'Looks away')).toBeVisible();
  await page.keyboard.press('Escape');

  await typeRow(page, 'Looks away').locator('.bar').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await typeRow(page, 'Looks away').getByRole('button', { name: 'Annotation type Looks away', exact: true }).click();
  await page.getByRole('dialog', { name: 'Annotation type Looks away' }).getByRole('button', { name: 'Delete type' }).click();
  await expect(typeRow(page, 'Looks away')).toHaveCount(0);
  await expect(page.locator('[data-group="annotations"]')).toContainText('No types yet');
});

test("another video's types are copied into this one", async ({ page }) => {
  await page.addInitScript(() => {
    const key = 'hyperstudy-annotator:corrections:' + 'f'.repeat(64);
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, JSON.stringify([
      { op: 'annotation.type', type: { id: 'type:mood', name: 'Mood', kind: 'category', target: 'scene', options: ['calm', 'tense'] } },
      { op: 'annotation.type', type: { id: 'type:laugh', name: 'Laughs', kind: 'binary', target: 'person', options: [] } },
    ]));
    localStorage.setItem('hyperstudy-annotator:title:' + 'f'.repeat(64), 'interview-02');
  });
  await open(page);
  await header(page).scrollIntoViewIfNeeded();
  await header(page).getByRole('button', { name: 'New annotation type', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New annotation type' });
  await expect(form).toContainText('interview-02');
  await expect(form).toContainText('Mood, Laughs');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/type-copy.png` });
  await form.getByRole('button', { name: 'Copy' }).click();
  await expect(typeRow(page, 'Mood')).toBeVisible();
  await expect(typeRow(page, 'Laughs')).toBeVisible();
});

test('a cleared range bound stays cleared after a reload', async ({ page }) => {
  await open(page);
  await header(page).scrollIntoViewIfNeeded();
  await header(page).getByRole('button', { name: 'New annotation type', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New annotation type' });
  await form.getByLabel('Type name').fill('Intensity');
  await form.getByLabel('Value kind').selectOption('number');
  await form.getByLabel('Minimum').fill('0');
  await form.getByLabel('Maximum').fill('10');
  await form.getByRole('button', { name: 'Add type' }).click();
  const editor = async () => {
    await header(page).scrollIntoViewIfNeeded();
    await typeRow(page, 'Intensity').getByRole('button', { name: 'Annotation type Intensity', exact: true }).click();
    return page.getByRole('dialog', { name: 'Annotation type Intensity' });
  };
  let edit = await editor();
  await expect(edit.getByLabel('Minimum')).toHaveValue('0');
  await edit.getByLabel('Minimum').fill('');
  await edit.getByLabel('Minimum').press('Tab');   // change fires as the field is left
  await page.reload();
  await page.locator('.tl-content').waitFor();
  edit = await editor();
  await expect(edit.getByLabel('Minimum')).toHaveValue('');
  await expect(edit.getByLabel('Maximum')).toHaveValue('10');
});

test("an annotation is moved by its middle and lengthened or shortened by its ends; ends snap to cuts unless ⌥ is held", async ({ page }) => {
  await open(page);
  await header(page).scrollIntoViewIfNeeded();
  await header(page).getByRole('button', { name: 'New annotation type', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New annotation type' });
  await form.getByLabel('Type name').fill('Engaged');
  await form.getByRole('button', { name: 'Add type' }).click();
  await page.keyboard.press('a');   // the first shot, 0:00.0–0:02.8
  const span = page.locator('.drawer-panel .meta').filter({ hasText: '–' }).first();
  await expect(span).toContainText('0:00.0–0:02.8');
  await page.locator('.zoom input').fill('12');
  const bar = typeRow(page, 'Engaged').locator('.bar');
  await bar.scrollIntoViewIfNeeded();
  const secs = (text: string) => text.match(/(\d+):(\d+\.\d)–(\d+):(\d+\.\d)/)!.slice(1).map(Number);
  const read = async () => { const [a, b, c, d] = secs(await span.innerText()); return { start: a * 60 + b, end: c * 60 + d }; };
  const drag = async (fromX: number, dx: number, alt = false) => {
    const box = (await bar.boundingBox())!, y = box.y + box.height / 2;
    await page.mouse.move(box.x + fromX(box.width), y);
    if (alt) await page.keyboard.down('Alt');
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) await page.mouse.move(box.x + fromX(box.width) + (dx * i) / 5, y);
    await page.mouse.up();
    if (alt) await page.keyboard.up('Alt');
  };
  const at = (w: number) => w / 2;
  const endOf = (w: number) => w - 2;

  await drag(at, 120, true);   // the middle: moved, its length kept
  let now = await read();
  expect(now.start).toBeGreaterThan(0.5);
  expect(now.end - now.start).toBeCloseTo(2.8, 1);
  const moved = now;

  await drag(endOf, -40, true);   // the end: shorter, the start stays
  now = await read();
  expect(now.start).toBe(moved.start);
  expect(now.end).toBeLessThan(moved.end);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/retimed.png` });

  await page.keyboard.press('Meta+z');   // one drag is one undo
  await expect.poll(read).toEqual(moved);

  // the end, to 3 px from the cut at 2.8 s: the snap line shows there while dragging, and not with ⌥ held
  const pps = ((await bar.boundingBox())!.width + 1) / (moved.end - moved.start);
  const box = (await bar.boundingBox())!, y = box.y + box.height / 2, x0 = box.x + box.width - 2, x1 = x0 - (moved.end - 2.8) * pps + 3;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, y);
  await page.mouse.move(x1, y);
  const line = page.locator('.snap-line');
  await expect(line).toHaveCount(1);
  const lineX = (await line.boundingBox())!.x;
  const cutX = (await page.locator('.tl-content').boundingBox())!.x + 168 + 2.8 * pps;
  expect(Math.abs(lineX - cutX)).toBeLessThan(2);
  await page.keyboard.down('Alt');
  await page.mouse.move(x1 + 1, y);
  await expect(line).toHaveCount(0);
  await page.keyboard.up('Alt');
  await page.mouse.move(x1, y);
  await page.mouse.up();
  await expect(span).toContainText('–0:02.8');
});

test('a dropped annotation goes straight to where it was dragged, never back to where it was first', async ({ page }) => {
  await open(page);
  await header(page).scrollIntoViewIfNeeded();
  await header(page).getByRole('button', { name: 'New annotation type', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New annotation type' });
  await form.getByLabel('Type name').fill('Engaged');
  await form.getByRole('button', { name: 'Add type' }).click();
  await page.keyboard.press('a');
  await page.locator('.zoom input').fill('12');
  const bar = typeRow(page, 'Engaged').locator('.bar');
  await bar.scrollIntoViewIfNeeded();
  const box = (await bar.boundingBox())!, y = box.y + box.height / 2;
  await page.keyboard.down('Alt');
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(box.x + box.width / 2 + i * 24, y);
  // every left the bar is given from the drop on (the DOM is written even where the screen is not painted)
  const first = await bar.evaluate((el) => {
    const w = window as unknown as { lefts: string[] };
    w.lefts = [];
    new MutationObserver(() => w.lefts.push((el as HTMLElement).style.left)).observe(el, { attributes: true, attributeFilter: ['style'] });
    return `${parseFloat((el as HTMLElement).style.left) - 120}px`;   // where it was before the drag
  });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(200);
  const lefts = await page.evaluate(() => (window as unknown as { lefts: string[] }).lefts);
  expect(lefts.map((l) => Math.round(parseFloat(l)))).not.toContain(Math.round(parseFloat(first)));
});
