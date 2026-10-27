// Keys and focus where engines differ: WebKit, the desktop app's engine, takes ⌫ as Back and its Tab skips buttons
// and checkboxes. On the synthetic bundle (e2e/synthetic.ts), so these run in CI too, in both projects.
import { expect, test } from '@playwright/test';
import { openSynthetic } from './synthetic';

const LAYERS = 'Layers shown in the timeline';

test('Tab past either end of a pop-up closes it and returns to its button', async ({ page }) => {
  await openSynthetic(page);
  const button = page.getByRole('button', { name: LAYERS }), panel = page.getByRole('dialog', { name: LAYERS });
  await button.click();
  await expect(panel.getByRole('checkbox').first()).toBeFocused();   // it takes the keyboard
  await page.keyboard.press('Shift+Tab');
  await expect(panel).toHaveCount(0);
  await expect(button).toBeFocused();
  await button.click();
  const n = await panel.getByRole('checkbox').count();
  for (let i = 1; i < n; i++) await page.keyboard.press('Tab');
  await expect(panel.getByRole('checkbox').last()).toBeFocused();     // through every control, buttons and checkboxes too
  await page.keyboard.press('Tab');
  await expect(panel).toHaveCount(0);
  await expect(button).toBeFocused();
});

test('Tab from the pop-up itself (a click on it, not on a control) goes to its first control, Shift+Tab to its last', async ({ page }) => {
  await openSynthetic(page);
  const panel = page.getByRole('dialog', { name: LAYERS });
  await page.getByRole('button', { name: LAYERS }).click();
  await panel.focus();                                                  // as a click on its padding, or (WebKit) on a checkbox
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('checkbox').first()).toBeFocused();
  await panel.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(panel.getByRole('checkbox').last()).toBeFocused();
});

test('⌫ outside a text field never takes the app off its page (WebKit goes back on it)', async ({ page }) => {
  await openSynthetic(page);
  const here = page.url();
  await page.getByRole('button', { name: LAYERS }).click();
  await page.getByRole('dialog', { name: LAYERS }).getByRole('checkbox').first().focus();
  await page.keyboard.press('Backspace');
  await expect(page).toHaveURL(here);
  await expect(page.getByRole('dialog', { name: LAYERS })).toBeVisible();
});
