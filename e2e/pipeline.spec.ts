// The Run pipeline dialog, against browser mode's scripted stand-in (?pipeline-demo): Tauri is absent here, and the
// real path is tested in Rust against the real CLI.
import { expect, test, type Page } from '@playwright/test';

async function planned(page: Page, url: string) {
  await page.goto(url);
  const dialog = page.getByRole('dialog', { name: 'Run the pipeline' });
  await dialog.getByRole('button', { name: 'Choose…' }).click();             // the pipeline folder
  await dialog.getByRole('button', { name: 'Choose…' }).click();             // the video
  await dialog.getByRole('radio').nth(1).check();                            // mvp-captions.yaml
  await expect(dialog.getByRole('heading', { name: /steps? to run/ })).toBeVisible();
  return dialog;
}

test('allowing a download is for the plan on screen: changing the graph takes the permission back', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  const allow = dialog.getByRole('checkbox', { name: /^Download/ });
  await allow.check();
  await dialog.getByRole('radio').nth(0).check();                            // another graph: a new plan
  await dialog.getByRole('radio').nth(1).check();
  await expect(dialog.getByRole('checkbox', { name: /^Download/ })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeDisabled();
});

test('a run the app refuses to start leaves the dialog usable, with the reason', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=reject-run');
  for (const box of await dialog.getByRole('checkbox').all()) await box.check();
  await dialog.getByRole('button', { name: 'Start run' }).click();
  await expect(dialog.getByText('a pipeline run is already in progress')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
});

test('the dialog takes the keyboard, and Escape closes it when no run is going', async ({ page }) => {
  await page.goto('/?pipeline-demo');
  const dialog = page.getByRole('dialog', { name: 'Run the pipeline' });
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('the plan says what each node sends off this machine', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  await expect(dialog.getByRole('listitem', { name: 'captions' })).toContainText('Sends frames, faces and transcript off this machine');
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeDisabled();   // until it is allowed
  await dialog.getByRole('checkbox', { name: /^Send frames/ }).check();
  await dialog.getByRole('checkbox', { name: /^Download/ }).check();
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
});

test('a run can be stopped before the pipeline has named it (a slow first environment sync)', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=slow-start');
  for (const box of await dialog.getByRole('checkbox').all()) await box.check();
  await dialog.getByRole('button', { name: 'Start run' }).click();
  await dialog.getByRole('button', { name: 'Cancel run' }).click();          // no run id yet
  await expect(dialog.getByText(/ended without finishing the run/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeEnabled();
});

test('choosing another pipeline folder takes back the graph, the plan and every permission', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  for (const box of await dialog.getByRole('checkbox').all()) await box.check();
  await dialog.getByRole('button', { name: 'Change…' }).first().click();     // the pipeline folder
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(dialog.getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Start run' })).toHaveCount(0);   // no plan: nothing to start
});

test('a node that can run in several places can be moved, and the plan says how long each step takes', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  const faces = dialog.getByRole('listitem', { name: 'faces' });
  await expect(faces).toContainText('1 min 36 s');
  const menu = faces.getByRole('combobox', { name: 'Where faces runs' });
  await expect(menu.getByRole('option')).toHaveText(['Apple GPU, about 1 min 36 s', 'CPU, no estimate yet']);   // compare before moving
  // a menu is as wide as its longest option: it stays inside its column, not over the estimate beside it
  const [box, cell] = await Promise.all([menu.boundingBox(), menu.locator('xpath=..').boundingBox()]);
  expect(box!.x + box!.width).toBeLessThanOrEqual(cell!.x + cell!.width);
  await faces.getByRole('combobox', { name: 'Where faces runs' }).selectOption('native:cpu');
  await expect(dialog.getByRole('listitem', { name: 'faces' })).toContainText('No estimate');
  await expect(dialog.getByText(/^Not counting faces/)).toBeVisible();   // no estimate on the CPU yet
});

test('unticking a step leaves out what needs it, and the time, cost and consent follow', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  await expect(dialog.getByRole('checkbox', { name: /^Send frames/ })).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Run faces' }).uncheck();
  await expect(dialog.getByRole('checkbox', { name: 'Run captions' })).not.toBeChecked();   // captions needs faces
  await expect(dialog.getByRole('checkbox', { name: /^Send frames/ })).toHaveCount(0);       // nothing uploads now
  await expect(dialog.getByRole('heading', { name: '1 step to run, about 2 s' })).toBeVisible();   // asr only (decode is cached)
});

test('a pipeline that does not say what each step needs offers no choice of steps, and runs the whole graph', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=no-needs');
  await expect(dialog.getByRole('listitem', { name: 'faces' })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /^Run / })).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: 'Where faces runs' })).toBeVisible();   // places can still be chosen
});

test('in a narrow window the plan fits without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  const dialog = await planned(page, '/?pipeline-demo');
  const [scroll, client] = await dialog.evaluate((d) => [d.scrollWidth, d.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
  await expect(dialog.getByRole('combobox', { name: 'Where faces runs' })).toBeVisible();
  await page.screenshot({ path: 'test-results/pipeline-narrow.png' });
});

test('a plan from a CLI that does not name places shows where each step runs, and can start', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=old-cli');
  await expect(dialog.getByText('Cannot run here')).toHaveCount(0);
  await expect(dialog.getByRole('listitem', { name: 'faces' })).toContainText('native (mps)');
  for (const box of await dialog.getByRole('checkbox').all()) await box.check();
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
});

test('a step already done fills its whole bar', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  const decode = dialog.getByRole('listitem', { name: 'decode' });
  const [bar, track] = await Promise.all([decode.locator('.bar').boundingBox(), decode.locator('.track').boundingBox()]);
  expect(bar!.width).toBeCloseTo(track!.width, 0);
});
