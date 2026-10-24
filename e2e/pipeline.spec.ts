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
  const allow = dialog.getByRole('checkbox');
  await allow.check();
  await dialog.getByRole('radio').nth(0).check();                            // another graph: a new plan
  await dialog.getByRole('radio').nth(1).check();
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
});

test('a run the app refuses to start leaves the dialog usable, with the reason', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=reject-run');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(dialog.getByText('a pipeline run is already in progress')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
});
