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
  const span = page.locator('.drawer-panel .meta').filter({ hasText: '–' }).first();
  await expect(span).toContainText('0:00.0–0:02.8');
  await page.locator('.zoom input').fill('12');
  const bar = typeRow(page, 'Engaged').locator('.bar');
  await bar.scrollIntoViewIfNeeded();
  const box = (await bar.boundingBox())!, y = box.y + box.height / 2;
  await page.keyboard.down('Alt');
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(box.x + box.width / 2 + i * 24, y);
  // every left the bar is given from the drop on (the DOM is written even where the screen is not painted)
  const [first, dropped] = await bar.evaluate((el) => {
    const w = window as unknown as { lefts: string[] };
    w.lefts = [];
    new MutationObserver(() => w.lefts.push((el as HTMLElement).style.left)).observe(el, { attributes: true, attributeFilter: ['style'] });
    const now = parseFloat((el as HTMLElement).style.left);
    return [now - 120, now];   // where it was before the drag, and where it is dropped
  });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const lefts = () => page.evaluate(() => (window as unknown as { lefts: string[] }).lefts.map((l) => Math.round(parseFloat(l))));
  await expect(span).not.toContainText('0:00.0–');   // the edit is in the log: any flash came before this
  expect(Math.round(parseFloat(await bar.evaluate((el) => (el as HTMLElement).style.left)))).toBe(Math.round(dropped));
  expect(await lefts()).not.toContain(Math.round(first));
});

test("double-clicking an annotation opens its menu at the bar: a value and who it is about, then it closes; ⌫ deletes", async ({ page }) => {
  await open(page);
  await header(page).scrollIntoViewIfNeeded();
  await header(page).getByRole('button', { name: 'New annotation type', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New annotation type' });
  await form.getByLabel('Type name').fill('Mood');
  await form.getByLabel('Value kind').selectOption('category');
  for (const c of ['happy', 'sad']) { await form.getByLabel('Add a category').fill(c); await form.getByLabel('Add a category').press('Enter'); }
  await form.getByRole('button', { name: 'Add type' }).click();
  await page.keyboard.press('a');   // the first shot, with three people on screen
  const bar = typeRow(page, 'Mood').locator('.bar');
  await bar.dblclick();
  const menu = page.getByRole('dialog', { name: 'Mood annotation' });
  await expect(menu).toBeVisible();
  const people = menu.getByRole('group', { name: 'On screen during it' }).getByRole('button');
  await expect(people.first()).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/note-menu.png` });
  await page.keyboard.press('2');   // a value; it stays open, as no one is chosen yet
  await expect(menu.getByRole('button', { name: 'sad' })).toHaveClass(/on/);
  await expect(menu).toBeVisible();
  const name = (await people.first().innerText()).trim();
  await people.first().click();   // now it says all it needs to
  await expect(menu).toHaveCount(0);
  await expect(bar).toHaveText(`sad · ${name}`);

  await page.keyboard.press('Enter');   // the selected annotation's menu again
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await bar.click();
  await page.keyboard.press('Backspace');
  await expect(bar).toHaveCount(0);
  await page.keyboard.press('Meta+z');
  await expect(bar).toHaveText(`sad · ${name}`);
});

test('a yes/no about the scene closes its menu as soon as it is answered', async ({ page }) => {
  await open(page);
  await header(page).scrollIntoViewIfNeeded();
  await header(page).getByRole('button', { name: 'New annotation type', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New annotation type' });
  await form.getByLabel('Type name').fill('Laughter');
  await form.getByLabel('About').selectOption('scene');
  await form.getByRole('button', { name: 'Add type' }).click();
  await page.keyboard.press('a');
  const bar = typeRow(page, 'Laughter').locator('.bar');
  await bar.dblclick();
  const menu = page.getByRole('dialog', { name: 'Laughter annotation' });
  await menu.getByRole('button', { name: 'Yes' }).click();
  await expect(menu).toHaveCount(0);
  await expect(bar).toHaveText('yes');
});

test("Enter on a focused button does what the button does, without opening the selected annotation's menu", async ({ page }) => {
  await open(page);
  await header(page).scrollIntoViewIfNeeded();
  await header(page).getByRole('button', { name: 'New annotation type', exact: true }).click();
  await page.getByRole('dialog', { name: 'New annotation type' }).getByLabel('Type name').fill('Laughter');
  await page.getByRole('button', { name: 'Add type' }).click();
  await page.keyboard.press('a');   // selected
  await page.getByRole('button', { name: 'Layers shown in the timeline' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Layers shown in the timeline' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Laughter annotation' })).toHaveCount(0);
});

test('the menu follows the selection: it closes when another annotation is selected, and opens fresh for it', async ({ page }) => {
  await open(page);
  await header(page).scrollIntoViewIfNeeded();
  await header(page).getByRole('button', { name: 'New annotation type', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New annotation type' });
  await form.getByLabel('Type name').fill('Laughter');
  await form.getByLabel('About').selectOption('scene');
  await form.getByRole('button', { name: 'Add type' }).click();
  await page.keyboard.press('a');   // the first shot
  await page.keyboard.press('y');   // complete
  await page.keyboard.press('.');   // the next shot
  await page.keyboard.press('Escape');
  await page.keyboard.press('a');   // the second shot: selected, no value yet
  const menu = page.getByRole('dialog', { name: 'Laughter annotation' });
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowLeft');   // the first one is selected
  await expect(menu).toHaveCount(0);
  await page.keyboard.press('Enter');   // its menu, though it is complete
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Yes' })).toHaveClass(/on/);
});

test('a second drag of an annotation whose first drop is still saving starts from where it was dropped', async ({ page }) => {
  const res = await page.request.get('/devdata/runs/ooo-genz-clip1/bundle/manifest.json');
  test.skip(!res.ok(), 'the bake-off data is not served at /devdata');
  await page.goto('/?library-demo');   // its edits save after 300 ms, as the app's do after a round trip
  await page.locator('.tl-content').waitFor();
  await header(page).scrollIntoViewIfNeeded();
  await header(page).getByRole('button', { name: 'New annotation type', exact: true }).click();
  await page.getByRole('dialog', { name: 'New annotation type' }).getByLabel('Type name').fill('Engaged');
  await page.getByRole('button', { name: 'Add type' }).click();
  await expect(typeRow(page, 'Engaged')).toBeVisible();   // saved
  await page.keyboard.press('a');   // the first shot, 0:00.0–0:02.8
  const span = page.locator('.drawer-panel .meta').filter({ hasText: '–' }).first();
  await expect(span).toContainText('0:00.0–0:02.8');
  await page.locator('.zoom input').fill('12');
  const bar = typeRow(page, 'Engaged').locator('.bar');
  await bar.scrollIntoViewIfNeeded();
  const pps = ((await bar.boundingBox())!.width + 1) / 2.8;
  const drag = async (dx: number) => {
    const b = (await bar.boundingBox())!, y = b.y + b.height / 2, x = b.x + b.width / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 4; i++) await page.mouse.move(x + (dx * i) / 4, y);
    await page.mouse.up();
  };
  await page.keyboard.down('Alt');   // no snapping
  await drag(120);
  await drag(60);   // at once: the first is still saving
  await page.keyboard.up('Alt');
  await expect(span).not.toContainText('0:00.0–');
  await expect.poll(async () => {
    const m = (await span.innerText()).match(/(\d+):(\d+\.\d)–/)!;
    return Number(m[1]) * 60 + Number(m[2]);
  }).toBeCloseTo(180 / pps, 0);
});

test('a value typed into the menu is kept when the menu is closed by Escape or a click elsewhere', async ({ page }) => {
  await open(page);
  await header(page).scrollIntoViewIfNeeded();
  await header(page).getByRole('button', { name: 'New annotation type', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New annotation type' });
  await form.getByLabel('Type name').fill('Notes');
  await form.getByLabel('Value kind').selectOption('text');
  await form.getByLabel('About').selectOption('scene');
  await form.getByRole('button', { name: 'Add type' }).click();
  await page.keyboard.press('a');
  const bar = typeRow(page, 'Notes').locator('.bar');
  const menu = page.getByRole('dialog', { name: 'Notes annotation' });
  await bar.dblclick();
  await menu.getByLabel('Value').fill('laughs at the joke');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(bar).toHaveText('laughs at the joke');
  await bar.dblclick();
  await menu.getByLabel('Value').fill('looks away');
  await page.mouse.click(5, 300);   // somewhere else
  await expect(menu).toHaveCount(0);
  await expect(bar).toHaveText('looks away');
});

test("⌫ on a focused button in a menu is that button's, never a delete of the selected annotation", async ({ page }) => {
  await open(page);
  await header(page).scrollIntoViewIfNeeded();
  await header(page).getByRole('button', { name: 'New annotation type', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New annotation type' });
  await form.getByLabel('Type name').fill('Mood');
  await form.getByLabel('Value kind').selectOption('category');
  for (const c of ['happy', 'sad', 'calm']) { await form.getByLabel('Add a category').fill(c); await form.getByLabel('Add a category').press('Enter'); }
  await form.getByRole('button', { name: 'Add type' }).click();
  await page.keyboard.press('a');   // selected, and no category used yet
  const bar = typeRow(page, 'Mood').locator('.bar');
  await expect(bar).toHaveCount(1);
  await typeRow(page, 'Mood').getByRole('button', { name: 'Annotation type Mood', exact: true }).click();
  await page.getByRole('dialog', { name: 'Annotation type Mood' }).getByRole('button', { name: 'Remove calm' }).focus();
  await page.keyboard.press('Backspace');
  await expect(bar).toHaveCount(1);
});

test('Escape closes the menu from a number field too', async ({ page }) => {
  await open(page);
  await header(page).scrollIntoViewIfNeeded();
  await header(page).getByRole('button', { name: 'New annotation type', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New annotation type' });
  await form.getByLabel('Type name').fill('Intensity');
  await form.getByLabel('Value kind').selectOption('number');
  await form.getByLabel('About').selectOption('scene');
  await form.getByRole('button', { name: 'Add type' }).click();
  await page.keyboard.press('a');
  await typeRow(page, 'Intensity').locator('.bar').dblclick();
  const menu = page.getByRole('dialog', { name: 'Intensity annotation' });
  await menu.getByLabel('Value').fill('4');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(typeRow(page, 'Intensity').locator('.bar')).toHaveText('4');
});
