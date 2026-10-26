// Updating the app, against browser mode's scripted stand-in for the releases (?update-demo): Tauri's updater is absent
// here. The launch check is quiet; an update shows on the rail and in Settings, downloads when asked, and the relaunch
// waits for a run in progress.
import { expect, test, type Page } from '@playwright/test';

const rail = (page: Page) => page.getByRole('navigation', { name: 'App' });
const updatesIn = (page: Page) => page.getByRole('region', { name: 'Updates' });

test('an update found at launch shows on the rail, installs when asked, then relaunches', async ({ page }) => {
  await page.goto('/?update-demo=available');
  await rail(page).getByRole('button', { name: 'Update' }).click();
  const updates = updatesIn(page);
  await expect(updates.getByText('Version 0.0.2 is available.')).toBeVisible();
  await expect(updates.getByText('The rail shows when one is ready.')).toBeVisible();        // its notes
  await updates.getByRole('button', { name: 'Install update' }).click();
  await expect(updates.getByRole('progressbar', { name: 'Download' })).toBeVisible();
  await expect(updates.getByText('Version 0.0.2 is installed.')).toBeVisible();
  await expect(rail(page).getByRole('button', { name: 'Relaunch' })).toBeVisible();
  await updates.getByRole('button', { name: 'Relaunch now' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __relaunched?: boolean }).__relaunched)).toBe(true);
});

test('with nothing newer the rail stays as it is, and asking says it is up to date', async ({ page }) => {
  await page.goto('/?update-demo=current');
  await rail(page).getByRole('button', { name: 'Settings' }).click();
  const updates = updatesIn(page);
  await expect(updates.getByText(/^HyperStudy Annotator 0\.0\.1\./)).toBeVisible();
  await expect(updates.getByText(/^Up to date, as of /)).toBeVisible();                       // the launch check's answer
  await expect(rail(page).getByRole('button', { name: 'Update' })).toHaveCount(0);
  await updates.getByRole('button', { name: 'Check for updates' }).click();
  await expect(updates.getByText(/^Up to date, as of /)).toBeVisible();
});

test('a launch check that cannot reach the releases interrupts nothing; asking says why', async ({ page }) => {
  await page.goto('/?update-demo=offline');
  await rail(page).getByRole('button', { name: 'Settings' }).click();
  const updates = updatesIn(page);
  await expect(updates.getByText(/The last check could not reach the releases/)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await updates.getByRole('button', { name: 'Check for updates' }).click();
  await expect(updates.getByText(/^Could not check for updates: Could not fetch a valid release JSON/)).toBeVisible();
  await expect(updates.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

test('a download that fails its signature check is not installed, says why, and can be tried again', async ({ page }) => {
  await page.goto('/?update-demo=bad-download');
  await rail(page).getByRole('button', { name: 'Update' }).click();
  const updates = updatesIn(page);
  await updates.getByRole('button', { name: 'Install update' }).click();
  await expect(updates.getByText(/^The update did not install: the signature of the update does not match/)).toBeVisible();
  await expect(rail(page).getByRole('button', { name: 'Relaunch' })).toHaveCount(0);
  await updates.getByRole('button', { name: 'Try again' }).click();
  await expect(updates.getByText('Version 0.0.2 is available.')).toBeVisible();
});

test('the relaunch waits while a run is going on Extract', async ({ page }) => {
  await page.goto('/?pipeline-demo=slow-start&update-demo=available');
  const extract = page.getByRole('region', { name: 'Extract' });
  await extract.getByRole('button', { name: 'Choose…' }).click();             // the video
  await extract.getByRole('button', { name: 'Start run' }).click();
  await expect(extract.getByRole('button', { name: 'Cancel run' })).toBeVisible();
  await rail(page).getByRole('button', { name: 'Update' }).click();
  const updates = updatesIn(page);
  await updates.getByRole('button', { name: 'Install update' }).click();      // downloading is fine meanwhile
  await expect(updates.getByRole('button', { name: 'Relaunch now' })).toBeDisabled();
  await expect(updates.getByText(/a relaunch would stop it/)).toBeVisible();
  await rail(page).getByRole('button', { name: 'Extract' }).click();
  await extract.getByRole('button', { name: 'Cancel run' }).click();
  await rail(page).getByRole('button', { name: 'Relaunch' }).click();
  await expect(updates.getByRole('button', { name: 'Relaunch now' })).toBeEnabled();
});
