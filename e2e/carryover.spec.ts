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
  // nor can Tab reach the page behind it (it is inert): Import or Undo there would also end the offer
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('.viewer')).toHaveAttribute('inert', '');
  await expect(offer).toBeVisible();                                   // the log is still empty: the offer stands
  await offer.getByRole('button', { name: 'Start fresh' }).click();
  // nothing was committed under it: this run's log, as browser mode keeps it, is still empty
  const log = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]'), `hyperstudy-annotator:corrections:${sha}:${RUN}/bundle-l4`);
  expect(log).toEqual([]);
});

test('what could not be carried over is listed with a Dismiss button that says which correction it removes', async ({ page }) => {
  for (const b of ['bundle-l4', 'bundle-pipeline']) {
    const res = await page.request.get(`${RUN}/${b}/manifest.json`);
    test.skip(!res.ok(), `the clip 2 bundles are not served at ${RUN}`);
  }
  const sha = (await (await page.request.get(`${RUN}/bundle-pipeline/manifest.json`)).json()).video.sha256;
  // face:58 of the Mac run has no counterpart in the L4 run
  await page.addInitScript((key) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify([{ op: 'entity.include', id: 'face:58', included: false, at: '2026-10-24T00:00:00.000Z' }]));
  }, `hyperstudy-annotator:corrections:${sha}`);
  await page.goto(URL);
  await page.getByRole('button', { name: 'Carry over', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dismiss: 58 excluded (face)' })).toBeVisible();
});

test('the "which run?" question for a file found next to the bundle is asked only while the log is empty', async ({ page }) => {
  for (const b of ['bundle-l4', 'bundle-pipeline']) {
    const res = await page.request.get(`${RUN}/${b}/manifest.json`);
    test.skip(!res.ok(), `the clip 2 bundles are not served at ${RUN}`);
  }
  const sha = (await (await page.request.get(`${RUN}/bundle-l4/manifest.json`)).json()).video.sha256;
  // a corrections file next to the bundle that does not name its run (served by the test, nothing on disk)
  let served!: () => void;
  const fileServed = new Promise<void>((r) => (served = r));
  await page.route(`**${RUN}/perception_corrections.json`, async (route) => {
    await route.fulfill({ json: { format: 'perception-corrections/2', sha256: sha,
      ops: [{ op: 'person.rename', person: 'person:Person A', name: 'x', at: '2026-10-24T00:00:00.000Z' }] } });
    served();
  });
  // this run (the L4 one) already has a correction of its own, and was started fresh
  await page.addInitScript(([log, record]) => {
    localStorage.setItem(log, JSON.stringify([{ op: 'shot.caption', shot: 'shot:0', caption: 'mine', at: '2026-10-24T00:00:00.000Z' }]));
    localStorage.setItem(record, JSON.stringify({ from_bundle_id: 'x', status: 'declined', carried: 0, unmatched: [], created_at: '' }));
  }, [`hyperstudy-annotator:corrections:${sha}:${RUN}/bundle-l4`, `hyperstudy-annotator:carryover:${RUN}/bundle-l4`]);
  await page.goto(URL);
  await expect(page.locator('.bar.caption[title="mine"]')).toHaveCount(1);   // this run's own edit is loaded: the log is not empty
  await fileServed;   // the found-file check has the file; two frames for it to finish and render
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(page.getByText(/do not say which of this video's \d+ runs/)).toHaveCount(0);
});
