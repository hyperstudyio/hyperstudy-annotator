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
  expect(await style('.viewer', 'background-color')).toBe('rgb(18, 18, 18)');            // its own, not the page's
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

// HyperStudy's global rules (frontend/src/app.css) that match elements the annotator has, loaded after annotator.css
// (the worst order: a rule of equal weight wins by coming last). A page's own rules for bare elements such as
// `button {}` are not defended against: the annotator's base rules weigh what bare element rules do, so that
// components' own styles always win (the package README says so).
test("HyperStudy's global rules do not reach into the annotator, whichever stylesheet comes last", async ({ page }) => {
  await openSynthetic(page);
  await page.getByRole('button', { name: 'What the video shows' }).click();
  await page.getByRole('dialog', { name: 'What the video shows' }).waitFor();
  const look = () => page.evaluate(() => {
    const at = (sel: string, ...props: string[]) => {
      const cs = getComputedStyle(document.querySelector(sel)!);
      return props.map((p) => `${sel} ${p}: ${cs.getPropertyValue(p)}`);
    };
    return [
      ...at('.viewer', 'box-sizing'),
      ...at('.viewer h1', 'font-size', 'line-height'),
      ...at('[aria-label="What the video shows"].trigger, button[aria-label="What the video shows"]', 'box-sizing', 'border-radius', 'padding', 'background-color'),
      ...at('.viewer select', 'box-sizing', 'border-radius', 'padding'),
      ...at('[role="dialog"][aria-label="What the video shows"]', 'box-sizing'),
    ];
  });
  const before = await look();
  await page.addStyleTag({ content: `
    *, *:before, *:after { box-sizing: inherit; }
    h1 { font-size: 3.2em; line-height: 1.1; }
  ` });
  expect(await look()).toEqual(before);
});
