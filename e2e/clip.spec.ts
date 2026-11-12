// Moving the clip by dragging with the move key held, from anywhere on the timeline (over a bar too): ⌘ on a Mac,
// Ctrl elsewhere, as ⌘←/→ is Ctrl+←/→ there (Linux's Super key is the window manager's).
import { expect, test, type Page } from '@playwright/test';
import { openSynthetic } from './synthetic';

/** The clip shown beside Play, in seconds: "Clip 0:01.0–0:07.0". */
async function clip(page: Page) {
  const text = (await page.locator('.clip').first().textContent()) ?? '';
  const secs = (m: string) => { const [a, b] = m.split(':'); return Number(a) * 60 + Number(b); };
  const [, a, b] = text.match(/(\d+:\d+(?:\.\d+)?)\s*–\s*(\d+:\d+(?:\.\d+)?)/) ?? [];
  return { start: secs(a), end: secs(b) };
}

for (const [platform, key] of [['MacIntel', 'Meta'], ['Linux x86_64', 'Control']] as const) {
  test(`on ${platform}, ${key}-drag over a bar moves the whole clip, and leaves the selection as it was`, async ({ page }) => {
    await page.addInitScript((p) => Object.defineProperty(Navigator.prototype, 'platform', { get: () => p }), platform);
    await openSynthetic(page, { speech: true });
    await page.locator('.lane-body .bar[data-key="utt:0"]').first().click();
    const from = await clip(page);
    expect(from).toEqual({ start: 1, end: 7 });
    const sound = page.locator('.lane-body .bar[data-key="sound:0"]');
    await sound.scrollIntoViewIfNeeded();
    const bar = (await sound.boundingBox())!;
    const pps = await page.locator('.tl-content').evaluate((el) => el.getBoundingClientRect().width / 20);
    await page.keyboard.down(key);
    await page.mouse.move(bar.x + 20, bar.y + bar.height / 2);
    await page.mouse.down();
    await page.mouse.move(bar.x + 20 + pps * 1.5, bar.y + bar.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up(key);
    const to = await clip(page);
    expect(to.start).toBeGreaterThan(from.start + 0.5);
    expect(to.end - to.start).toBeCloseTo(from.end - from.start, 1);
    await expect(page.locator('.bar.selected[data-key="utt:0"]').first()).toBeVisible();   // still the utterance
  });
}

test('after a ⇧-click on empty space changes the clip, Enter on a segment still selects it', async ({ page }) => {
  await openSynthetic(page, { speech: true });
  await page.locator('.lane-body .bar[data-key="utt:0"]').first().click();
  const lane = page.locator('.lane-body', { has: page.locator('.bar[data-key="sound:0"]') });
  await lane.scrollIntoViewIfNeeded();
  const box = (await lane.boundingBox())!;
  const pps = await page.locator('.tl-content').evaluate((el) => el.getBoundingClientRect().width / 20);
  await page.keyboard.down('Shift');
  await page.mouse.click(box.x + pps * 9, box.y + box.height / 2);   // 9 s: between the sounds, past the clip's end
  await page.keyboard.up('Shift');
  expect((await clip(page)).end).toBeGreaterThan(7.5);
  await page.locator('.lane-body .bar[data-key="sound:1"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.bar.selected[data-key="sound:1"]')).toBeVisible();
});

for (const [platform, move] of [['MacIntel', '⌘drag'], ['Linux x86_64', 'Ctrl+drag']] as const) {
  test(`on ${platform}, the key reminders name the key to hold: ${move}`, async ({ page }) => {
    await page.addInitScript((p) => Object.defineProperty(Navigator.prototype, 'platform', { get: () => p }), platform);
    await openSynthetic(page);
    await page.keyboard.press('?');
    await expect(page.locator('kbd', { hasText: move })).toBeVisible();
  });
}
