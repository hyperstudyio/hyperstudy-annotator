// The carry-over offer is a modal: while it is open, the workspace's keys must not act underneath it. Pressing `j`
// then `1` used to commit a speaker op, so the log stopped being empty and the offer vanished.
import { expect, test } from '@playwright/test';

const RUN = '/devdata/runs/ooo-genz-clip2';
const URL = `/?bundle=${RUN}/bundle-l4&video=/devdata/data/ooo-genz-clip2.mp4&previous=${RUN}/bundle-pipeline`;

test('while the carry-over offer is open, workspace keys do nothing and focus is in the offer', async ({ page }) => {
  for (const b of ['bundle-l4', 'bundle-pipeline']) {
    const res = await page.request.get(`${RUN}/${b}/manifest.json`);
    test.skip(!res.ok(), `the clip 2 bundles are not served at ${RUN}`);
  }
  const sha = (await (await page.request.get(`${RUN}/bundle-pipeline/manifest.json`)).json()).video.sha256;
  // the earlier run's log (browser mode keeps it under the video's sha256): one caption to offer
  await page.addInitScript((key) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify([{ op: 'shot.caption', shot: 'shot:0', caption: 'x', at: '2026-10-24T00:00:00.000Z' }]));
  }, `hyperstudy-annotator:corrections:${sha}`);
  await page.goto(URL);
  const offer = page.getByRole('dialog', { name: 'Carry over corrections' });
  await offer.waitFor();
  await expect(page.getByRole('button', { name: 'Carry over', exact: true })).toBeFocused();
  for (const key of ['j', '1', 'o', 'e']) await page.keyboard.press(key);
  await expect(page.getByText('0 corrections')).toBeVisible();
  await expect(offer).toBeVisible();
});
