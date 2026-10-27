// The Annotator page's library, against browser mode's scripted stand-in (?library-demo): Tauri is absent here, and
// importing and locating a video are tested in Rust against real bundles. Also the rail around it.
import { expect, test, type Page } from '@playwright/test';

const library = (page: Page) => page.getByRole('list', { name: 'Bundles' });

test('with no bundles yet, the page offers the two ways to get one, once each', async ({ page }) => {
  await page.goto('/?library-demo=empty');
  const start = page.getByRole('region', { name: 'No bundles yet' });
  await expect(start.getByRole('heading', { name: 'Extract from a video' })).toBeVisible();
  await expect(start.getByRole('heading', { name: 'Import a bundle' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Extract from a video…' })).toHaveCount(1);   // not again in the header
  await expect(page.getByRole('button', { name: 'Import bundle…' })).toHaveCount(1);
  await start.getByRole('button', { name: 'Import bundle…' }).click();
  await expect(library(page).getByRole('listitem', { name: 'imported-clip' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'No bundles yet' })).toHaveCount(0);
});

test('each bundle says what it holds, its licence in words, and where its video is', async ({ page }) => {
  await page.goto('/?library-demo');
  const clip1 = library(page).getByRole('listitem', { name: 'ooo-genz-clip1' });
  await expect(clip1).toContainText('4 layers, 88 corrections. Academic use only');   // the strictest of its layers
  await expect(clip1).toContainText('~/Videos/ooo-genz-clip1.mp4');
  await expect(clip1).not.toContainText('academic-only');
  const clip2 = library(page).getByRole('listitem', { name: 'ooo-genz-clip2' });
  await expect(clip2).toContainText('Video not found yet: locate it to play the bundle');
  await clip2.getByRole('button', { name: 'Locate the video for ooo-genz-clip2' }).click();
  await expect(clip2).toContainText('~/Videos/ooo-genz-clip2.mp4');
  await expect(clip2.getByRole('button', { name: 'Change the video for ooo-genz-clip2' })).toBeVisible();
});

test('the whole bundle opens it', async ({ page }) => {
  await page.goto('/?library-demo');
  await library(page).getByRole('button', { name: 'Open nes-biking' }).click();
  await expect(page.getByText('would open b3')).toBeVisible();   // browser mode has no viewer to open into
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
