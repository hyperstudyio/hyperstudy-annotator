// The Run pipeline dialog, against browser mode's scripted stand-in (?pipeline-demo): Tauri is absent here, and the
// real path is tested in Rust against the real CLI.
import { expect, test, type Page } from '@playwright/test';

async function planned(page: Page, url: string) {
  await page.goto(url);
  const dialog = page.getByRole('dialog', { name: 'Run the pipeline' });
  await dialog.getByRole('button', { name: 'Choose…' }).click();             // the pipeline folder
  await dialog.getByRole('button', { name: 'Choose…' }).click();             // the video
  await dialog.getByRole('radio').nth(1).check();                            // mvp-captions.yaml
  await expect(dialog.getByText(/^Plan · estimated/)).toBeVisible();
  return dialog;
}

test('allowing a download is for the plan on screen: changing the graph takes the permission back', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  const allow = dialog.getByRole('checkbox', { name: /^Download/ });
  await allow.check();
  await dialog.getByRole('radio').nth(0).check();                            // another graph: a new plan
  await dialog.getByRole('radio').nth(1).check();
  await expect(dialog.getByRole('checkbox', { name: /^Download/ })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
});

test('a run the app refuses to start leaves the dialog usable, with the reason', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=reject-run');
  for (const box of await dialog.getByRole('checkbox').all()) await box.check();
  await dialog.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(dialog.getByText('a pipeline run is already in progress')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
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
  await expect(dialog.getByRole('row', { name: /^Run captions/ })).toContainText('sends frames, faces, transcript off this machine');
  await expect(dialog.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();   // until it is allowed
  await dialog.getByRole('checkbox', { name: /^Send frames/ }).check();
  await dialog.getByRole('checkbox', { name: /^Download/ }).check();
  await expect(dialog.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
});

test('a run can be stopped before the pipeline has named it (a slow first environment sync)', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=slow-start');
  for (const box of await dialog.getByRole('checkbox').all()) await box.check();
  await dialog.getByRole('button', { name: 'Run', exact: true }).click();
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
  await expect(dialog.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
});

test('a node that can run in several places can be moved, and the plan says how long each step takes', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  const faces = dialog.getByRole('row', { name: /^Run faces/ });
  await expect(faces).toContainText('about 1 min 36 s');
  const menu = faces.getByRole('combobox', { name: 'Where faces runs' });
  await expect(menu.getByRole('option')).toHaveText(['native:mps · about 1 min 36 s', 'native:cpu · no estimate yet']);   // compare before moving
  await faces.getByRole('combobox', { name: 'Where faces runs' }).selectOption('native:cpu');
  await expect(dialog.getByRole('row', { name: /^Run faces/ })).toContainText('no estimate yet');
  await expect(dialog.getByText(/^Estimated time: about/)).toBeVisible();
});

test('unticking a step leaves out what needs it, and the time, cost and consent follow', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  await expect(dialog.getByRole('checkbox', { name: /^Send frames/ })).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Run faces' }).uncheck();
  await expect(dialog.getByRole('checkbox', { name: 'Run captions' })).not.toBeChecked();   // captions needs faces
  await expect(dialog.getByRole('checkbox', { name: /^Send frames/ })).toHaveCount(0);       // nothing uploads now
  await expect(dialog.getByText(/^Estimated time: about 2 s$/)).toBeVisible();              // asr only (decode is cached)
});

test('a pipeline that does not say what each step needs offers no choice of steps, and runs the whole graph', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=no-needs');
  await expect(dialog.getByRole('row', { name: /^faces/ })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /^Run / })).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: 'Where faces runs' })).toBeVisible();   // places can still be chosen
});
