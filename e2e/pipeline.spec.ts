// The Run pipeline dialog, against browser mode's scripted stand-in (?pipeline-demo): Tauri is absent here, and the
// real path is tested in Rust against the real CLI.
import { expect, test, type Page } from '@playwright/test';

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

test('nothing to approve: what a step downloads or sends off is in its details, and the run can start', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  await expect(dialog.getByRole('group', { name: 'Before it runs' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();   // the speech model downloads as part of running
  const asr = dialog.getByRole('listitem', { name: 'asr' });
  await expect(asr).not.toContainText('Downloads');                               // not on the row
  await dialog.getByRole('button', { name: 'Speech transcript' }).click();
  await expect(asr).toContainText('Downloads first');
  await expect(asr).toContainText('mlx-community/parakeet-tdt-0.6b-v3 (2.3 GB)');
  await dialog.getByRole('checkbox', { name: 'Run Shot captions' }).check();           // turning it on is the choice to send
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
});

test('a step that runs on a cloud API says so, not this machine\'s CPU', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  const captions = dialog.getByRole('listitem', { name: 'captions' });
  await expect(captions).toContainText('Anthropic API (cloud)');
  await expect(captions).not.toContainText('CPU');
  await dialog.getByRole('button', { name: 'Shot captions' }).click();
  await expect(captions).toContainText('frames, faces and transcript, sent to the Anthropic API');
});

test('on a Mac a step runs on the Apple GPU with no CPU to choose instead', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  await expect(dialog.getByRole('listitem', { name: 'faces' })).toContainText('Apple GPU');
  await expect(dialog.getByRole('combobox', { name: /^Where / })).toHaveCount(0);
});

test('a run the app refuses to start leaves the dialog usable, with the reason', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=reject-run');
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

test('a step that sends data off and comes along for another feature says so on its row', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=summary');
  await expect(dialog.getByRole('checkbox', { name: 'Run Summary' })).not.toBeChecked();   // it would bring captions along
  await dialog.getByRole('checkbox', { name: 'Run Summary' }).check();
  const captions = dialog.getByRole('listitem', { name: 'captions' });
  await expect(captions).toContainText('Sends frames, faces and transcript to the Anthropic API, for Summary');
  await expect(dialog.getByRole('checkbox', { name: 'Run Shot captions' })).toBeDisabled();
});

test('a feature that sends data off this machine or costs money is off until turned on', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  await expect(dialog.getByRole('checkbox', { name: 'Run Shot captions' })).not.toBeChecked();
  await expect(dialog.getByRole('heading', { name: /^2 steps to run, about 1 min 38 s$/ })).toBeVisible();   // no cost
  await dialog.getByRole('checkbox', { name: 'Run Shot captions' }).check();
  await expect(dialog.getByRole('heading', { name: /\$0\.16$/ })).toBeVisible();
});

test('a run can be stopped before the pipeline has named it (a slow first environment sync)', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=slow-start');
  await dialog.getByRole('button', { name: 'Start run' }).click();
  await dialog.getByRole('button', { name: 'Cancel run' }).click();          // no run id yet
  await expect(dialog.getByText(/ended without finishing the run/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeEnabled();
});

test('choosing another pipeline folder takes back the features and the plan', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  await dialog.getByRole('checkbox', { name: 'Run Shot captions' }).check();
  await dialog.getByRole('button', { name: 'Change…' }).first().click();     // the pipeline folder
  await expect(dialog.getByRole('checkbox', { name: 'Run Shot captions' })).not.toBeChecked();   // back to the defaults
});

test('a node that can run in several places can be moved, and the plan says how long each step takes', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=two-places');
  const faces = dialog.getByRole('listitem', { name: 'faces' });
  await expect(faces).toContainText('1 min 36 s');
  const menu = faces.getByRole('combobox', { name: 'Where faces runs' });
  await expect(menu.getByRole('option')).toHaveText(['NVIDIA GPU, about 1 min 36 s', 'CPU, no estimate yet']);   // compare before moving
  // a menu is as wide as its longest option: it stays inside its column, not over the estimate beside it
  const [box, cell] = await Promise.all([menu.boundingBox(), menu.locator('xpath=..').boundingBox()]);
  expect(box!.x + box!.width).toBeLessThanOrEqual(cell!.x + cell!.width);
  await menu.selectOption('native:cpu');
  await expect(dialog.getByRole('listitem', { name: 'faces' })).toContainText('No estimate');
  await expect(dialog.getByText(/^Not counting faces/)).toBeVisible();   // no estimate on the CPU yet
});

test('turning a feature on brings what it needs, held on while it runs; turning it off lets them go', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  const faces = dialog.getByRole('checkbox', { name: 'Run Face tracks' });
  await expect(dialog.getByRole('heading', { name: /^2 steps to run/ })).toBeVisible();   // speech and faces (shots are done)
  await dialog.getByRole('checkbox', { name: 'Run Shot captions' }).check();
  await expect(faces).toBeChecked();
  await expect(faces).toBeDisabled();                                         // turned off, it would come straight back
  await expect(faces).toHaveAccessibleDescription('Needed by Shot captions');   // and says why to a screen reader too
  await expect(dialog.getByRole('listitem', { name: 'faces' })).toContainText('Needed by Shot captions');
  await dialog.getByRole('checkbox', { name: 'Run Shot captions' }).uncheck();
  await expect(faces).toBeEnabled();
  await faces.uncheck();
  await expect(dialog.getByRole('heading', { name: '1 step to run, about 2 s' })).toBeVisible();   // speech only
});

test('a step\'s details say what it makes, uses and sends, and its settings change the plan', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  await dialog.getByRole('checkbox', { name: 'Run Shot captions' }).check();
  await dialog.getByRole('button', { name: 'Shot captions' }).click();
  const captions = dialog.getByRole('listitem', { name: 'captions' });
  await expect(captions).toContainText('Leaves this machine');
  await expect(captions).toContainText('Runs on');
  await expect(captions).toContainText('The Anthropic API, in the cloud');
  const model = captions.getByRole('combobox', { name: 'Model' });
  await expect(model.getByRole('option')).toHaveText(['claude-haiku-5-5, $0.003 per shot', 'claude-opus-5-5, $0.12 per shot']);
  await expect(dialog.getByRole('heading', { name: /\$0\.16$/ })).toBeVisible();
  await model.focus();                                                        // as from the keyboard
  await model.selectOption('claude-opus-5-5');
  await expect(dialog.getByRole('heading', { name: /\$6\.24$/ })).toBeVisible();
  await expect(model).toBeFocused();                                          // the replan kept the control (and the keyboard)
  await expect(dialog.getByRole('button', { name: 'Shot captions' })).toHaveAttribute('aria-expanded', 'true');   // still open
});

test('a pipeline that does not say what each step needs offers no choice of steps, and sends nothing for a step nobody chose', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=no-needs');
  await expect(dialog.getByRole('listitem', { name: 'faces' })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /^Run / })).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: /^3 steps to run/ })).toBeVisible();          // it runs whole, captions too...
  await expect(dialog.getByText(/^Captions sends frames, faces, transcript off this machine and this pipeline cannot leave it out/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeDisabled();             // ...so it does not run
});

test('in a narrow window the plan fits without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  const dialog = await planned(page, '/?pipeline-demo');
  await dialog.getByRole('button', { name: 'Face tracks' }).click();
  const [scroll, client] = await dialog.evaluate((d) => [d.scrollWidth, d.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
  await page.screenshot({ path: 'test-results/pipeline-narrow.png' });
});

test('a pipeline from before plans named places or held a full graph offers its graphs and shows where each step runs', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=old-cli');
  await expect(dialog.getByRole('radio')).toHaveCount(2);
  await expect(dialog.getByText('Cannot run here')).toHaveCount(0);
  await expect(dialog.getByRole('listitem', { name: 'faces' })).toContainText('native (mps)');
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeDisabled();   // whole, with captions sending data off
});

test('a step already done fills its whole bar', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  const decode = dialog.getByRole('listitem', { name: 'decode' });
  const [bar, track] = await Promise.all([decode.locator('.bar').boundingBox(), decode.locator('.track').boundingBox()]);
  expect(bar!.width).toBeCloseTo(track!.width, 0);
});

test('progress is one colour: a running step fills against its estimate, and a finished one is a full bar', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  const faces = dialog.getByRole('listitem', { name: 'faces' });
  await expect(faces.locator('.bar')).toHaveCount(0);                          // nothing has run yet
  await dialog.getByRole('button', { name: 'Start run' }).click();
  await expect(faces).toContainText('Running');
  const [part, whole] = await Promise.all([faces.locator('.bar').boundingBox(), faces.locator('.track').boundingBox()]);
  expect(part!.width).toBeLessThan(whole!.width / 2);                          // a few seconds into a 96 s estimate
  await expect(dialog.getByRole('heading', { name: 'Finished all 3 steps' })).toBeVisible({ timeout: 10_000 });
  for (const id of ['decode', 'asr', 'faces']) {
    const item = dialog.getByRole('listitem', { name: id });
    await expect(item.locator('.bar')).toHaveCSS('background-color', 'rgb(76, 175, 80)');
    await expect.poll(async () => {
      const [bar, track] = await Promise.all([item.locator('.bar').boundingBox(), item.locator('.track').boundingBox()]);
      return Math.round(track!.width - bar!.width);
    }).toBe(0);
  }
  await expect(dialog.getByRole('listitem', { name: 'captions' })).toHaveCount(0);   // only the steps chosen run
});
