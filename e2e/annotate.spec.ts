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
