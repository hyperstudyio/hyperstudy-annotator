// The Run pipeline dialog, against browser mode's scripted stand-in (?pipeline-demo): Tauri is absent here, and the
// real path is tested in Rust against the real CLI.
import { expect, test, type Locator, type Page } from '@playwright/test';

/** The dialog with a pipeline folder and a video chosen, and its plan on screen: the full graph's features, or (a
 *  pipeline folder with no full graph) mvp-captions.yaml. */
async function planned(page: Page, url: string) {
  await page.goto(url);
  const dialog = page.getByRole('dialog', { name: 'Run the pipeline' });
  await dialog.getByRole('button', { name: 'Choose…' }).click();             // the pipeline folder
  await dialog.getByRole('button', { name: 'Choose…' }).click();             // the video
  if (await dialog.getByRole('radio').count()) await dialog.getByRole('radio').nth(1).check();
  await expect(dialog.getByRole('heading', { name: /steps? to run/ })).toBeVisible();
  return dialog;
}

/** Tick everything in "Before it runs". */
async function allowAll(dialog: Locator) {
  for (const box of await dialog.getByRole('group', { name: 'Before it runs' }).getByRole('checkbox').all()) await box.check();
}

test('allowing a download is for the plan on screen: moving a step takes the permission back', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  await dialog.getByRole('checkbox', { name: /^Download/ }).check();
  await dialog.getByRole('combobox', { name: 'Where faces runs' }).selectOption('native:cpu');   // a new plan
  await expect(dialog.getByRole('checkbox', { name: /^Download/ })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeDisabled();
});

test('a run the app refuses to start leaves the dialog usable, with the reason', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=reject-run');
  await allowAll(dialog);
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

test('a feature that sends data off this machine or costs money is off until turned on, and then needs its own permission', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  const captions = () => dialog.getByRole('listitem', { name: 'captions' });
  await expect(captions()).toContainText('Off: it sends frames, faces and transcript off this machine and costs money');
  await expect(dialog.getByRole('checkbox', { name: /^Send frames/ })).toHaveCount(0);
  await dialog.getByRole('checkbox', { name: 'Run captions' }).check();
  await expect(captions()).toContainText('Sends frames, faces and transcript off this machine');
  await dialog.getByRole('checkbox', { name: /^Download/ }).check();
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeDisabled();   // until the upload is allowed too
  await dialog.getByRole('checkbox', { name: /^Send frames/ }).check();
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
});

test('a run can be stopped before the pipeline has named it (a slow first environment sync)', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=slow-start');
  await allowAll(dialog);
  await dialog.getByRole('button', { name: 'Start run' }).click();
  await dialog.getByRole('button', { name: 'Cancel run' }).click();          // no run id yet
  await expect(dialog.getByText(/ended without finishing the run/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeEnabled();
});

test('choosing another pipeline folder takes back the features, the plan and every permission', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  await dialog.getByRole('checkbox', { name: 'Run captions' }).check();
  await allowAll(dialog);
  await dialog.getByRole('button', { name: 'Change…' }).first().click();     // the pipeline folder
  await expect(dialog.getByRole('checkbox', { name: 'Run captions' })).not.toBeChecked();   // back to the defaults
  await expect(dialog.getByRole('checkbox', { name: /^Download/ })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeDisabled();
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
  await menu.selectOption('native:cpu');
  await expect(dialog.getByRole('listitem', { name: 'faces' })).toContainText('No estimate');
  await expect(dialog.getByText(/^Not counting faces/)).toBeVisible();   // no estimate on the CPU yet
});

test('turning a feature on brings what it needs, held on while it runs; turning it off lets them go', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  const faces = dialog.getByRole('checkbox', { name: 'Run faces' });
  await expect(dialog.getByRole('heading', { name: /^2 steps to run/ })).toBeVisible();   // speech and faces (shots are done)
  await dialog.getByRole('checkbox', { name: 'Run captions' }).check();
  await expect(faces).toBeChecked();
  await expect(faces).toBeDisabled();                                         // turned off, it would come straight back
  await expect(dialog.getByRole('listitem', { name: 'faces' })).toContainText('Needed by Shot captions');
  await dialog.getByRole('checkbox', { name: 'Run captions' }).uncheck();
  await expect(faces).toBeEnabled();
  await faces.uncheck();
  await expect(dialog.getByRole('heading', { name: '1 step to run, about 2 s' })).toBeVisible();   // speech only
});

test('a step\'s details say what it makes, uses and sends, and its settings change the plan', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  await dialog.getByRole('checkbox', { name: 'Run captions' }).check();
  await dialog.getByRole('button', { name: 'Shot captions' }).click();
  const captions = dialog.getByRole('listitem', { name: 'captions' });
  await expect(captions).toContainText('Leaves this machine');
  await expect(captions).toContainText('frames, faces and transcript');
  const model = captions.getByRole('combobox', { name: 'Model' });
  await expect(model.getByRole('option')).toHaveText(['claude-haiku-5-5, $0.003 per shot', 'claude-opus-5-5, $0.12 per shot']);
  await expect(dialog.getByRole('heading', { name: /\$0\.16$/ })).toBeVisible();
  await model.selectOption('claude-opus-5-5');
  await expect(dialog.getByRole('heading', { name: /\$6\.24$/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Shot captions' })).toHaveAttribute('aria-expanded', 'true');   // still open
});

test('a pipeline that does not say what each step needs offers no choice of steps, and runs the whole graph', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=no-needs');
  await expect(dialog.getByRole('listitem', { name: 'faces' })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /^Run / })).toHaveCount(0);
  await expect(dialog.getByRole('checkbox', { name: /^Send frames/ })).toBeVisible();          // captions runs too
  await expect(dialog.getByRole('combobox', { name: 'Where faces runs' })).toBeVisible();   // places can still be chosen
});

test('in a narrow window the plan fits without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  const dialog = await planned(page, '/?pipeline-demo');
  await dialog.getByRole('button', { name: 'Face tracks' }).click();
  const [scroll, client] = await dialog.evaluate((d) => [d.scrollWidth, d.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
  await expect(dialog.getByRole('combobox', { name: 'Where faces runs' })).toBeVisible();
  await page.screenshot({ path: 'test-results/pipeline-narrow.png' });
});

test('a pipeline from before plans named places or held a full graph offers its graphs and shows where each step runs', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=old-cli');
  await expect(dialog.getByRole('radio')).toHaveCount(2);
  await expect(dialog.getByText('Cannot run here')).toHaveCount(0);
  await expect(dialog.getByRole('listitem', { name: 'faces' })).toContainText('native (mps)');
  await allowAll(dialog);
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
});

test('a step already done fills its whole bar', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  const decode = dialog.getByRole('listitem', { name: 'decode' });
  const [bar, track] = await Promise.all([decode.locator('.bar').boundingBox(), decode.locator('.track').boundingBox()]);
  expect(bar!.width).toBeCloseTo(track!.width, 0);
});

test('a run\'s progress is green: every step that finished has a green bar, and only the steps chosen run', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  await allowAll(dialog);
  await dialog.getByRole('button', { name: 'Start run' }).click();
  await expect(dialog.getByRole('heading', { name: 'Finished all 3 steps' })).toBeVisible({ timeout: 10_000 });
  for (const id of ['decode', 'asr', 'faces']) {
    await expect(dialog.getByRole('listitem', { name: id }).locator('.bar')).toHaveCSS('background-color', 'rgb(76, 175, 80)');
  }
  await expect(dialog.getByRole('listitem', { name: 'captions' })).toHaveCount(0);
});
