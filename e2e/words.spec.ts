// Speech on the synthetic bundle: the speaker the pipeline predicted is marked in Inspect, and the words of an
// utterance can be corrected on the timeline, one after another with Tab, past the edge of what is in view.
import { expect, test, type Page } from '@playwright/test';
import { openSynthetic } from './synthetic';

const word = (page: Page, utt: string, i: number) => page.locator(`.bar.word[data-key="${utt}#${i}"]`);
const editor = (page: Page) => page.getByRole('textbox', { name: 'Correct this word' });

test('the predicted speaker is marked, dashed, until a speaker is chosen; back to the prediction marks it again', async ({ page }) => {
  await openSynthetic(page, { speech: true });
  await page.locator('.lane-body .bar[data-key="utt:0"]').first().click();
  const who = page.getByRole('group', { name: 'Who is speaking' });
  const b = who.locator('.chip', { hasText: 'Person B' }), a = who.locator('.chip', { hasText: 'Person A' });
  // the prediction names face:1 with how it was made (`via`): the chip is still the one marked
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await expect(b).toHaveClass(/predicted/);
  await expect(a).toHaveAttribute('aria-pressed', 'false');
  await a.click();
  await expect(a).toHaveAttribute('aria-pressed', 'true');
  await expect(a).toHaveClass(/\bon\b/);
  await expect(b).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'back to the prediction' }).click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await expect(b).toHaveClass(/predicted/);
});

test('Tab goes on correcting word after word, past the edge of the timeline and into the next utterance', async ({ page }) => {
  await openSynthetic(page, { speech: true });
  await page.locator('.zoom input').fill('12');   // half a second a word is wider than a third of the timeline
  await word(page, 'utt:0', 0).dblclick();
  await expect(editor(page)).toHaveValue('one');
  const numbers = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  for (const [i, w] of numbers.entries()) {
    await page.keyboard.press('Tab');
    await expect(editor(page)).toHaveValue(w);
    await expect(editor(page)).toBeFocused();
    await expect(word(page, 'utt:0', i + 1)).toBeInViewport();
  }
  expect(await page.locator('.tl-scroll').evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);   // it did scroll
  await page.keyboard.type('dozen');
  await page.keyboard.press('Tab');   // kept, and on to the next utterance's first word, far to the right
  await expect(editor(page)).toHaveValue('and');
  await expect(editor(page)).toBeFocused();
  await expect(word(page, 'utt:1', 0)).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  await expect(word(page, 'utt:0', 11)).toHaveText(/dozen/);
  // only the word typed changed, and Inspect shows the same text
  await page.locator('.lane-body .bar[data-key="utt:0"]').first().click();
  await expect(page.locator('textarea')).toHaveValue(['one', ...numbers.slice(0, -1), 'dozen'].join(' '));
});

test('the word editor follows its word when the timeline scrolls, and closes once the word is out of sight', async ({ page }) => {
  await openSynthetic(page, { speech: true });
  await page.locator('.zoom input').fill('12');
  await word(page, 'utt:0', 1).dblclick();
  const at = async () => (await editor(page).boundingBox())!.x - (await word(page, 'utt:0', 1).boundingBox())!.x;
  const before = await at();
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft += 40; });
  await expect.poll(at).toBeCloseTo(before, 0);
  await expect(editor(page)).toBeVisible();
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft += 5000; });
  await expect(editor(page)).toHaveCount(0);
});
