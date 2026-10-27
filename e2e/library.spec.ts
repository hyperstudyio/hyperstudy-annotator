// The Annotator page: the viewer, with the bundles in a drawer beside it, against browser mode's scripted library
// (?library-demo): Tauri is absent here, and importing and locating a video are tested in Rust against real bundles. The
// demo's bundles are the bake-off's at /devdata; tests that open one skip themselves when it is not served (CI). Also the
// rail around it.
import { expect, test, type Page } from '@playwright/test';

const drawer = (page: Page) => page.getByRole('complementary', { name: 'Bundles' });
const bundle = (page: Page, title: string) => drawer(page).getByRole('listitem', { name: title });
async function needsData(page: Page) {
  const res = await page.request.get('/devdata/runs/ooo-genz-clip1/bundle/manifest.json');
  test.skip(!res.ok(), 'the bake-off data is not served at /devdata');
}

test('the page is the annotator: it opens the newest bundle, not a list to get through first', async ({ page }) => {
  await needsData(page);
  await page.goto('/?library-demo');
  await expect(page.getByRole('heading', { level: 1, name: 'ooo-genz-clip1' })).toBeVisible();   // the viewer's header
  await expect(bundle(page, 'ooo-genz-clip1').getByRole('button')).toHaveAttribute('aria-current', 'true');
});

test('it opens the bundle last opened here again', async ({ page }) => {
  await needsData(page);
  await page.goto('/?library-demo');
  await bundle(page, 'nes-biking').getByRole('button', { name: 'Open nes-biking' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'nes-biking' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'nes-biking' })).toBeVisible();
});

test('each bundle in the drawer says what it holds, and what needs care', async ({ page }) => {
  await page.goto('/?library-demo');
  await expect(bundle(page, 'ooo-genz-clip1')).toContainText('3 layers, 88 corrected');
  await expect(bundle(page, 'ooo-genz-clip1')).toContainText('Academic use only');   // the strictest of its layers
  await expect(bundle(page, 'ooo-genz-clip2')).toContainText('No video');
  await expect(drawer(page)).not.toContainText('academic-only');
});

test('a bundle without its video asks for it, then opens', async ({ page }) => {
  await needsData(page);
  await page.goto('/?library-demo');
  await bundle(page, 'ooo-genz-clip2').getByRole('button').click();
  await expect(page.getByText('ooo-genz-clip2 needs its video.')).toBeVisible();
  await page.getByRole('button', { name: 'Locate video…' }).click();
  await expect(page.getByText('ooo-genz-clip2 needs its video.')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: /^Shot 1 of / })).toBeVisible();   // the viewer, loaded
  await expect(bundle(page, 'ooo-genz-clip2')).not.toContainText('No video');
});

test('the drawer hides, leaving the viewer the width, and comes back', async ({ page }) => {
  await page.goto('/?library-demo');
  await drawer(page).getByRole('button', { name: 'Hide the bundles' }).click();
  await expect(drawer(page).getByRole('list')).toHaveCount(0);
  expect((await drawer(page).boundingBox())!.width).toBeLessThan(40);
  await drawer(page).getByRole('button', { name: 'Show the bundles' }).click();
  await expect(bundle(page, 'nes-biking')).toBeVisible();
});

test('with no bundles yet, the page offers the two ways to get one; an imported one opens', async ({ page }) => {
  await page.goto('/?library-demo=empty');
  await expect(page.getByText('No bundles yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Extract from a video…' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import bundle…' })).toHaveCount(1);   // offered once
  await page.getByRole('button', { name: 'Import bundle…' }).click();
  await expect(bundle(page, 'imported-clip').getByRole('button')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByText('imported-clip needs its video.')).toBeVisible();      // the demo's import has none
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
