// Updating the app, against browser mode's scripted stand-in for the releases (?update-demo): Tauri's updater is absent
// here. The launch check is quiet; an update is said on the page in front, on the rail and in Settings, downloads when
// asked, and the relaunch waits for a run in progress.
import { expect, test, type Page } from '@playwright/test';

const rail = (page: Page) => page.getByRole('navigation', { name: 'App' });
const updatesIn = (page: Page) => page.getByRole('region', { name: 'Updates' });
const notice = (page: Page) => page.getByRole('region', { name: 'Update', exact: true });

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
  await expect(updates.getByText(/^Version 0\.0\.1\./)).toBeVisible();
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
  await rail(page).getByRole('button', { name: 'Annotator' }).click();
  await expect(notice(page)).toHaveCount(0);
  await rail(page).getByRole('button', { name: 'Settings' }).click();
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
  await extract.getByRole('button', { name: 'Choose a video…' }).click();             // the video
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

// The pipeline's setup (first launch, or a new version: packages and model weights, GBs) is, like a run, something a
// relaunch would stop, on any page. The page's clock is paused before it loads (install() alone lets time flow as the
// page loads, which on a slow runner outlasted the stand-in's 1.5 s setup), so time passes only as the test runs it.
test('the relaunch waits while the pipeline is being set up, then is offered', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await page.goto('/?pipeline-demo=setup-running&update-demo=available');
  await page.clock.runFor(500);                                               // the launch check
  await rail(page).getByRole('button', { name: 'Update' }).click();
  const updates = updatesIn(page);
  await updates.getByRole('button', { name: 'Install update' }).click();
  await page.clock.runFor(800);                                               // the download; 1.3 s in, setup still going
  await expect(updates.getByText('Version 0.0.2 is installed.')).toBeVisible();
  await expect(updates.getByRole('button', { name: 'Relaunch now' })).toBeDisabled();
  await expect(updates.getByText(/^The pipeline is being set up .* Relaunch once it is done\.$/)).toBeVisible();
  await page.clock.runFor(1000);                                              // past the setup's 1.5 s
  await expect(updates.getByRole('button', { name: 'Relaunch now' })).toBeEnabled();
  await expect(updates.getByText(/being set up/)).toHaveCount(0);
});

test('an update found at launch is said on the page in front, without taking the focus, and installs and relaunches from there', async ({ page }) => {
  await page.goto('/?update-demo=available');
  const n = notice(page);
  await expect(n.getByText('Version 0.0.2 is available.')).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement?.closest('[aria-label="Update"]'))).toBe(false);
  await rail(page).getByRole('button', { name: 'Settings' }).click();
  await expect(n).toHaveCount(0);                                                             // Settings says it there
  await rail(page).getByRole('button', { name: 'Annotator' }).click();
  await n.getByRole('button', { name: 'Install update' }).click();
  await expect(n.getByRole('progressbar', { name: 'Download' })).toBeVisible();
  await expect(n.getByText('Version 0.0.2 is installed.')).toBeVisible();
  await n.getByRole('button', { name: 'Relaunch now' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __relaunched?: boolean }).__relaunched)).toBe(true);
});

test('Later puts the notice away until the update is installed; the rail keeps the reminder', async ({ page }) => {
  await page.goto('/?update-demo=available');
  await notice(page).getByRole('button', { name: 'Later' }).click();
  await expect(notice(page)).toHaveCount(0);
  await rail(page).getByRole('button', { name: 'Settings' }).click();
  await rail(page).getByRole('button', { name: 'Annotator' }).click();
  await expect(notice(page)).toHaveCount(0);                                                  // still put away
  await rail(page).getByRole('button', { name: 'Update' }).click();
  await updatesIn(page).getByRole('button', { name: 'Install update' }).click();
  await expect(updatesIn(page).getByText('Version 0.0.2 is installed.')).toBeVisible();
  await rail(page).getByRole('button', { name: 'Annotator' }).click();
  await expect(notice(page).getByRole('button', { name: 'Relaunch now' })).toBeVisible();   // its next step is said
});

test('an install from the notice that fails says why there, and can be tried again', async ({ page }) => {
  await page.goto('/?update-demo=bad-download');
  const n = notice(page);
  await n.getByRole('button', { name: 'Install update' }).click();
  await expect(n.getByText(/^The update did not install: the signature of the update does not match/)).toBeVisible();
  await n.getByRole('button', { name: 'Try again' }).click();
  await expect(n.getByText('Version 0.0.2 is available.')).toBeVisible();
});

test('the notice\'s relaunch waits while a run is going on Extract', async ({ page }) => {
  await page.goto('/?pipeline-demo=slow-start&update-demo=available');
  const extract = page.getByRole('region', { name: 'Extract' });
  await extract.getByRole('button', { name: 'Choose a video…' }).click();
  await extract.getByRole('button', { name: 'Start run' }).click();
  await expect(extract.getByRole('button', { name: 'Cancel run' })).toBeVisible();
  const n = notice(page);
  await n.getByRole('button', { name: 'Install update' }).click();
  await expect(n.getByText('A run is going on Extract, and a relaunch would stop it. Relaunch once it ends.')).toBeVisible();
  await expect(n.getByRole('button', { name: 'Relaunch now' })).toBeDisabled();
});
