// The annotator embedded in a page that is not the desktop app's (HyperStudy): its look is scoped to its root
// (`.hs-annotator`, annotator.css), so the page's own elements keep theirs, and the annotator keeps its look without the
// app's body class, including the panels it opens on the page's body. On the synthetic bundle, so this runs in CI.
import { expect, test } from '@playwright/test';
import { openSynthetic } from './synthetic';

test('the annotator styles only itself: the embedding page keeps its own buttons and text', async ({ page }) => {
  await openSynthetic(page);
  // the page around it, as HyperStudy's would be: no root class on the body, and elements of its own
  await page.evaluate(() => {
    document.body.classList.remove('hs-annotator');
    document.body.insertAdjacentHTML('afterbegin', '<button id="host-button">Host</button><p id="host-muted" class="muted">Host text</p>');
  });
  const style = (selector: string, prop: string) => page.locator(selector).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

  // the page's own: the browser's button and text, not the annotator's
  expect(await style('#host-button', 'background-color')).not.toBe('rgb(44, 44, 44)');   // --color-bg-card
  expect(await style('#host-button', 'border-radius')).not.toBe('6px');
  expect(await style('#host-muted', 'color')).not.toBe('rgb(153, 153, 153)');            // --color-text-muted

  // the annotator's own, from its root alone
  expect(await style('.viewer', 'font-size')).toBe('13px');
  expect(await style('.viewer', 'color')).toBe('rgb(224, 224, 224)');                    // --color-text-primary
  const trigger = page.getByRole('button', { name: 'What the video shows' });
  expect(await trigger.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');   // a plain button
  expect(await trigger.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(176, 176, 176)');

  // a panel it opens on the page's body carries the root too
  await trigger.click();
  const panel = page.getByRole('dialog', { name: 'What the video shows' });
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((el) => el.parentElement === document.body)).toBe(true);
  expect(await panel.evaluate((el) => getComputedStyle(el).getPropertyValue('--color-bg-card').trim())).toBe('#2c2c2c');
  expect(await panel.evaluate((el) => getComputedStyle(el).fontSize)).toBe('13px');
});
