// The Extract page (run the pipeline), and the rail that reaches it, against browser mode's scripted stand-in (?pipeline-demo): Tauri is absent here, and the
// real path is tested in Rust against the real CLI.
import { expect, test, type Page } from '@playwright/test';

/** The Extract page with a video chosen, and its plan on screen: the full graph's features, or (a pipeline with no
 *  full graph) mvp-captions.yaml. */
async function planned(page: Page, url: string) {
  await page.goto(url);
  const dialog = page.getByRole('region', { name: 'Extract' });
  await dialog.getByRole('button', { name: 'Choose a video…' }).click();     // the video
  if (await dialog.getByRole('radio').count()) await dialog.getByRole('radio').nth(1).check();
  await expect(dialog.getByRole('heading', { name: /steps? to run/ })).toBeVisible();
  return dialog;
}

const rail = (page: Page) => page.getByRole('navigation', { name: 'App' });
/** Settings, at one of its tabs: where keys, remote servers and the cloud GPU are set (Extract only says what a run
 *  will use, and plans again when you go back to it). */
async function settingsAt(page: Page, tab: RegExp) {
  await rail(page).getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('region', { name: 'Settings' });
  await settings.getByRole('tab', { name: tab }).click();
  return settings;
}
const toExtract = (page: Page) => rail(page).getByRole('button', { name: 'Extract' }).click();
/** Open the form for another remote server, fill it in, and add it. */
async function addServer(settings: ReturnType<Page['getByRole']>, name: string, dest: string) {
  await settings.getByRole('button', { name: 'Add a remote server…' }).click();
  const form = settings.getByRole('form', { name: 'Add a remote server' });
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('SSH destination').fill(dest);
  await form.getByRole('button', { name: 'Add server' }).click();
  return form;
}

test('nothing to approve: what a step downloads or sends off is in its details, and the run can start', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  await expect(dialog.getByRole('group', { name: 'Before it runs' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();   // the speech model downloads as part of running
  const asr = dialog.getByRole('listitem', { name: 'asr' });
  await expect(asr).not.toContainText('Downloads');                               // not on the row
  await dialog.getByRole('button', { name: 'Speech transcript' }).click();
  await expect(asr).toContainText('Downloads first');
  await expect(asr).toContainText('mlx-community/parakeet-tdt-0.6b-v3 (2.3 GB, commercial use allowed)');
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

test('a run the app refuses to start leaves the page usable, with the reason', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=reject-run');
  await dialog.getByRole('button', { name: 'Start run' }).click();
  await expect(dialog.getByText('a pipeline run is already in progress')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
});

test('the rail opens each page, and a run goes on while another page is on screen', async ({ page }) => {
  const extract = await planned(page, '/?pipeline-demo');
  await expect(rail(page).getByRole('button', { name: 'Extract' })).toHaveAttribute('aria-current', 'page');
  await extract.getByRole('button', { name: 'Start run' }).click();
  await rail(page).getByRole('button', { name: 'Settings' }).click();
  await expect(extract).toBeHidden();
  const settings = page.getByRole('region', { name: 'Settings' });
  await expect(settings.getByRole('tab', { name: /^API keys/ })).toBeVisible();
  await expect(settings.getByRole('tab', { name: /^Remote servers/ })).toBeVisible();
  await rail(page).getByRole('button', { name: 'Annotator' }).click();
  await expect(page.getByRole('heading', { name: 'Annotator' })).toBeVisible();
  await toExtract(page);
  await expect(extract.getByRole('heading', { name: /^Finished all/ })).toBeVisible();   // it ran while hidden
  await expect(extract.getByRole('button', { name: 'Open in Annotator' })).toBeVisible();
  await extract.getByRole('button', { name: 'New run' }).click();
  await expect(extract.getByRole('heading', { name: 'Choose a video to start' })).toBeVisible();
});

test('a remote server added in Settings is offered on Extract when you go back to it', async ({ page }) => {
  const extract = await planned(page, '/?pipeline-demo');
  await expect(extract.getByText('This Mac', { exact: true })).toBeVisible();
  const settings = await settingsAt(page, /^Remote servers/);
  await addServer(settings, 'gpu9', 'you@gpu9.example.edu');
  await expect(settings.getByRole('listitem', { name: 'gpu9' })).toBeVisible();
  await toExtract(page);
  await expect(extract.getByText('This Mac and gpu9')).toBeVisible();
});

test('Extract sets nothing itself, and sends you to the part of Settings each thing is set in', async ({ page }) => {
  const extract = await planned(page, '/?pipeline-demo');
  await expect(extract.getByRole('textbox')).toHaveCount(0);
  await extract.getByRole('button', { name: 'Change where steps can run, in Settings' }).click();
  const settings = page.getByRole('region', { name: 'Settings' });
  await expect(settings.getByRole('tab', { name: /^Remote servers/ })).toHaveAttribute('aria-selected', 'true');
  await toExtract(page);
  await extract.getByRole('button', { name: 'Change the keys, in Settings' }).click();
  await expect(settings.getByRole('tab', { name: /^API keys/ })).toHaveAttribute('aria-selected', 'true');
});

test('a feature that would bring along a step that sends data off waits until that step is turned on', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=summary');
  const summary = dialog.getByRole('checkbox', { name: 'Run Summary' });
  await expect(summary).toBeDisabled();                                       // it would bring captions along
  await expect(summary).toHaveAccessibleDescription('Turn on Shot captions first: it sends data off this machine');
  await dialog.getByRole('checkbox', { name: 'Run Shot captions' }).check();   // sending is chosen here
  await expect(summary).toBeEnabled();
  await summary.check();
  await expect(dialog.getByRole('checkbox', { name: 'Run Shot captions' })).toBeDisabled();   // held on while Summary needs it
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
  await expect(dialog.getByRole('button', { name: 'New run' })).toBeEnabled();
});

test('another video takes back the features turned on: sending one video\'s data is not the choice to send the next\'s', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  await dialog.getByRole('checkbox', { name: 'Run Shot captions' }).check();
  await dialog.getByRole('button', { name: 'Change…' }).click();            // the video
  await expect(dialog.getByRole('heading', { name: /steps? to run/ })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Run Shot captions' })).not.toBeChecked();
});

test('the dialog runs the pipeline the app installed, with nothing to choose but the video', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  await expect(dialog.locator('.pipeline')).toHaveText(/^Pipeline 0\.1\.0\. All 4 steps can run on this Mac/);
  await expect(dialog.getByRole('button', { name: 'Change…' })).toHaveCount(1);   // the video's: no pipeline folder
});

test('while the pipeline is installed nothing asks it anything, then the dialog fills in', async ({ page }) => {
  await page.goto('/?pipeline-demo=installing');
  const dialog = page.getByRole('region', { name: 'Extract' });
  await expect(dialog.getByText(/^Installing the pipeline\./)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Choose a video…' })).toHaveCount(0);
  await expect(dialog.locator('.error')).toHaveCount(0);   // the doctor was not asked before it was there
  await expect(dialog.locator('.pipeline')).toHaveText(/^Pipeline 0\.1\.0/, { timeout: 5000 });
  await expect(dialog.getByRole('button', { name: 'Choose a video…' })).toBeVisible();
});

test('while a new version of the pipeline is set up, Start run waits, then starts', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=setup-running');
  await expect(dialog.getByText(/^Setting up this version of the pipeline/)).toContainText('Done: 1, last Shots and audio (environment).');
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled({ timeout: 5000 });   // the setup finished
  await expect(dialog.getByText(/^Setting up the pipeline/)).toHaveCount(0);
});

test('an install that failed (offline at first launch) fills the page in once Try again succeeds', async ({ page }) => {
  await page.goto('/?pipeline-demo=install-failed');
  const dialog = page.getByRole('region', { name: 'Extract' });
  await expect(dialog.getByText(/^Setting up the pipeline failed: uv could not install the pipeline/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Choose a video…' })).toHaveCount(0);   // nothing to run it with yet
  await expect(dialog.getByText(/not installed yet/)).toHaveCount(0);   // the install's failure says why, once
  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog.locator('.pipeline')).toHaveText(/^Pipeline 0\.1\.0/, { timeout: 5000 });
  await expect(dialog.getByRole('button', { name: 'Choose a video…' })).toBeVisible();
});

test('a setup that failed says what failed, and can be tried again without holding up a run', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=setup-failed');
  await expect(dialog.getByText('Setting up the pipeline failed: environment vision.face-track@1.0.0: could not fetch torch.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();   // a run fetches what it is missing itself
  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog.getByText(/^Setting up this version of the pipeline/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled({ timeout: 5000 });
  await expect(dialog.getByText(/Setting up the pipeline failed/)).toHaveCount(0);
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
  await expect(dialog.getByText(/^Not counting Face tracks/)).toBeVisible();   // no estimate on the CPU yet
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

// --- other machines (perception #15/#16) -----------------------------------------------------------------------------

const runs = (page: Page) => page.evaluate(() => (window as unknown as { __pipelineRuns: { allow: { uploads: Record<string, unknown> }; places: Record<string, string>; maxCostUsd: number | null }[] }).__pipelineRuns);

test('each place says where it is, how long the step would take and what it costs, before moving it', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const menu = dialog.getByRole('listitem', { name: 'faces' }).getByRole('combobox', { name: 'Where faces runs' });
  await expect(menu.getByRole('option')).toHaveText(['Apple GPU, about 1 min 36 s', 'NVIDIA GPU on lab (SSH), no estimate yet',
    'Cloud GPU (AWS L4), no estimate yet, up to $0.49']);
  const [box, cell] = await Promise.all([menu.boundingBox(), menu.locator('xpath=..').boundingBox()]);
  expect(box!.x + box!.width).toBeLessThanOrEqual(cell!.x + cell!.width);   // the longest option stays inside its column
});

test('moving a step to a lab server is the choice to send it its inputs: it stays on, and the run may send them there only', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const faces = dialog.getByRole('listitem', { name: 'faces' });
  await faces.getByRole('combobox', { name: 'Where faces runs' }).selectOption('ssh-lab:cuda');
  await expect(dialog.getByRole('checkbox', { name: 'Run Face tracks' })).toBeChecked();   // not turned off for sending
  await dialog.getByRole('button', { name: 'Face tracks' }).click();
  await expect(faces).toContainText('faces, transcript and video, sent to lab (SSH)');
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Start run' }).click();
  const [ran] = await runs(page);
  expect(ran.allow.uploads).toEqual({ faces: { kinds: ['faces', 'transcript', 'video'], service: 'lab (SSH)' } });
  expect(ran.places).toEqual({ faces: 'ssh-lab:cuda' });
  expect(ran.maxCostUsd).toBe(0.5);                                             // a lab server costs nothing
});

test('a cloud GPU shows its price, and the run\'s cap is raised by it', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  await dialog.getByRole('listitem', { name: 'faces' }).getByRole('combobox', { name: 'Where faces runs' }).selectOption('cloud:cuda');
  await expect(dialog.getByRole('heading', { name: /steps to run.*\$0\.49/ })).toBeVisible();
  await expect(dialog.getByRole('listitem', { name: 'faces' })).toContainText('Up to $0.49');   // the most the machine can cost
  await dialog.getByRole('button', { name: 'Start run' }).click();
  const [ran] = await runs(page);
  expect(ran.allow.uploads).toEqual({ faces: { kinds: ['faces', 'transcript', 'video'], service: 'Cloud GPU (AWS L4)' } });
  expect(ran.maxCostUsd).toBe(0.99);                                            // the graph's $0.50, and the machine's most
});

test('moving a step back to this machine sends nothing', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const menu = dialog.getByRole('listitem', { name: 'faces' }).getByRole('combobox', { name: 'Where faces runs' });
  await menu.selectOption('ssh-lab:cuda');
  await expect(menu).toHaveValue('ssh-lab:cuda');
  await menu.selectOption('native:mps');
  await expect(menu).toHaveValue('native:mps');
  await dialog.getByRole('button', { name: 'Start run' }).click();
  const [ran] = await runs(page);
  expect(ran.allow.uploads).toEqual({});
});

// --- the other machines, set in Settings: Extract plans again with them when you go back to it ------------------------

test('the machines steps can run on are listed, and a remote server added in Settings is a place in the step menus', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  await expect(dialog.getByText('This Mac, lab and the cloud GPU')).toBeVisible();
  const settings = await settingsAt(page, /^Remote servers 1$/);
  await expect(settings.getByRole('listitem', { name: 'lab' })).toContainText('Linux, 32 cores, 252 GB, NVIDIA GPU (48 GB)');
  await expect(settings.getByRole('form', { name: 'Add a remote server' })).toHaveCount(0);   // opened when asked for
  await addServer(settings, 'gpu2', 'you@gpu2.example.edu');
  await expect(settings.getByRole('listitem', { name: 'gpu2' })).toBeVisible();
  await expect(settings.getByRole('form', { name: 'Add a remote server' })).toHaveCount(0);   // closed once added
  await expect(settings.getByRole('tab', { name: /^Remote servers 2$/ })).toBeVisible();
  await toExtract(page);
  await expect(dialog.getByText('This Mac, lab, gpu2 and the cloud GPU')).toBeVisible();
  const menu = dialog.getByRole('listitem', { name: 'faces' }).getByRole('combobox', { name: 'Where faces runs' });
  await expect(menu.getByRole('option', { name: /NVIDIA GPU on gpu2 \(SSH\)/ })).toHaveCount(1);
});

test('removing a remote server or turning the cloud off takes its place out of the menus', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const menu = dialog.getByRole('listitem', { name: 'faces' }).getByRole('combobox', { name: 'Where faces runs' });
  await expect(menu.getByRole('option', { name: /on lab/ })).toHaveCount(1);
  const settings = await settingsAt(page, /^Remote servers/);
  await settings.getByRole('listitem', { name: 'lab' }).getByRole('button', { name: 'Remove lab' }).click();
  await expect(settings.getByRole('listitem', { name: 'lab' })).toHaveCount(0);
  await settings.getByRole('tab', { name: /^Cloud GPU On$/ }).click();
  const cloud = settings.getByRole('checkbox', { name: 'Use AWS g6.2xlarge, NVIDIA L4, at $0.98 an hour' });
  await expect(cloud).toBeChecked();
  await cloud.uncheck({ force: true });   // the switch draws over its checkbox
  await expect(settings.getByRole('tab', { name: /^Cloud GPU Off$/ })).toBeVisible();
  await toExtract(page);
  await expect(menu.getByRole('option', { name: /on lab/ })).toHaveCount(0);
  await expect(menu.getByRole('option', { name: /Cloud GPU/ })).toHaveCount(0);
  await expect(dialog.getByText('This Mac', { exact: true })).toBeVisible();
});

test('a step on a remote server that is then removed goes back to this machine, and nothing is agreed for it', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const menu = dialog.getByRole('listitem', { name: 'faces' }).getByRole('combobox', { name: 'Where faces runs' });
  await menu.selectOption('ssh-lab:cuda');
  await expect(menu).toHaveValue('ssh-lab:cuda');
  const settings = await settingsAt(page, /^Remote servers/);
  await settings.getByRole('listitem', { name: 'lab' }).getByRole('button', { name: 'Remove lab' }).click();
  await expect(settings.getByRole('listitem', { name: 'lab' })).toHaveCount(0);
  // added again under the same name (perhaps another machine): choosing it is a new choice, not the old one
  await addServer(settings, 'lab', 'you@another-lab.example.edu');
  await expect(settings.getByRole('listitem', { name: 'lab' })).toBeVisible();
  await toExtract(page);
  await expect(menu).toHaveValue('native:mps');
  await expect(menu.getByRole('option', { name: /on lab/ })).toHaveCount(1);   // offered again, not chosen
  await dialog.getByRole('button', { name: 'Start run' }).click();
  const [ran] = await runs(page);
  expect(ran.places).toEqual({});
  expect(ran.allow.uploads).toEqual({});
});

test('a remote server name already listed cannot be added over: another machine under that name is a new choice', async ({ page }) => {
  await planned(page, '/?pipeline-demo=remote');
  const settings = await settingsAt(page, /^Remote servers/);
  await settings.getByRole('button', { name: 'Add a remote server…' }).click();
  const form = settings.getByRole('form', { name: 'Add a remote server' });
  await form.getByLabel('Name').fill('lab');
  await form.getByLabel('SSH destination').fill('you@another-lab.example.edu');
  await expect(form.getByRole('button', { name: 'Add server' })).toBeDisabled();
  await expect(form.getByText(/lab is already a remote server here: remove it first/)).toBeVisible();
});

test('a step on a remote server whose name now leads to another machine goes back to this machine', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const menu = dialog.getByRole('listitem', { name: 'faces' }).getByRole('combobox', { name: 'Where faces runs' });
  await menu.selectOption('ssh-lab:cuda');
  await expect(menu).toHaveValue('ssh-lab:cuda');
  await page.evaluate(() => { (globalThis as { __readdedElsewhere?: boolean }).__readdedElsewhere = true; });   // re-added with the CLI
  const settings = await settingsAt(page, /^Remote servers/);
  await settings.getByRole('listitem', { name: 'lab' }).getByRole('button', { name: 'Check lab' }).click();
  await expect(settings.getByRole('listitem', { name: 'lab' })).toContainText('you@another-lab.example.edu');
  await toExtract(page);
  await expect(menu).toHaveValue('native:mps');                      // the name is the same; the machine is not
  await dialog.getByRole('button', { name: 'Start run' }).click();
  const [ran] = await runs(page);
  expect(ran.places).toEqual({});
  expect(ran.allow.uploads).toEqual({});
});

test('a run cannot start while a remote server is being cleared, even from Extract', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  await dialog.getByRole('listitem', { name: 'faces' }).getByRole('combobox', { name: 'Where faces runs' }).selectOption('ssh-lab:cuda');
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
  await page.evaluate(() => { const g = globalThis as { __holdHost?: Promise<void>; __release?: () => void };
    g.__holdHost = new Promise((r) => { g.__release = r; }); });
  const settings = await settingsAt(page, /^Remote servers/);
  await settings.getByRole('button', { name: 'Clear the cache on lab' }).click();
  await expect(settings.getByText('Clearing the cache on lab…')).toBeVisible();
  await toExtract(page);                                              // back before it is done
  await expect(dialog.getByText('Settings: Clearing the cache on lab… Start run waits for it.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeDisabled();
  await page.evaluate(() => (globalThis as { __release?: () => void }).__release!());
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
  await expect(dialog.getByRole('listitem', { name: 'faces' }).getByRole('combobox', { name: 'Where faces runs' })).toHaveValue('ssh-lab:cuda');
});

test('a step on a remote server found without its GPU goes back to this machine', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const menu = dialog.getByRole('listitem', { name: 'faces' }).getByRole('combobox', { name: 'Where faces runs' });
  await menu.selectOption('ssh-lab:cuda');
  await page.evaluate(() => { (globalThis as { __gpuGone?: boolean }).__gpuGone = true; });
  const settings = await settingsAt(page, /^Remote servers/);
  await settings.getByRole('button', { name: 'Check lab' }).click();
  await expect(settings.getByRole('listitem', { name: 'lab' })).toContainText('no GPU');
  await toExtract(page);
  await expect(menu).toHaveValue('native:mps');                      // the plan still stands, on this machine
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
});

test('a remote server that cannot be reached is not added, and says why', async ({ page }) => {
  await planned(page, '/?pipeline-demo=remote');
  const settings = await settingsAt(page, /^Remote servers/);
  const form = await addServer(settings, 'far', 'you@unreachable.example.edu');
  await expect(settings.getByText(/could not reach you@unreachable\.example\.edu/)).toBeVisible();
  await expect(settings.getByRole('listitem', { name: 'far' })).toHaveCount(0);
  await expect(form.getByLabel('Name')).toHaveValue('far');           // kept, to correct
});

test('a pipeline from before other machines says so and offers nothing to set', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=old-cli');
  await expect(dialog.getByText(/This Mac only \(this pipeline cannot run steps elsewhere/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Change where steps can run, in Settings' })).toHaveCount(0);
  const settings = await settingsAt(page, /^Remote servers/);
  await expect(settings.getByText(/This pipeline runs every step on this computer/)).toBeVisible();
});

test('a failure listing the machines is said as it is, not taken for an older pipeline', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=machines-error');
  await expect(dialog.getByText(/PermissionError: hosts\.json/)).toBeVisible();
  await expect(dialog.getByText(/cannot run steps elsewhere/)).toHaveCount(0);
});

test('remote servers are offered by a pipeline that cannot start cloud machines yet', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=no-cloud');
  await expect(dialog.getByText('This Mac', { exact: true })).toBeVisible();
  const settings = await settingsAt(page, /^Cloud GPU/);
  await expect(settings.getByText(/cannot start cloud machines yet/)).toBeVisible();
  await settings.getByRole('tab', { name: /^Remote servers/ }).click();
  await expect(settings.getByRole('button', { name: 'Add a remote server…' })).toBeVisible();
});

test('in a narrow window Settings fits without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await planned(page, '/?pipeline-demo=remote');
  const settings = await settingsAt(page, /^Remote servers/);
  await addServer(settings, 'gpu17', 'firstname.lastname@gpu-node-17.psych.example.edu');   // a long one
  await expect(settings.getByRole('listitem', { name: 'gpu17' })).toBeVisible();
  const page_ = page.locator('.page.on');
  expect(await page_.evaluate((d) => d.scrollWidth - d.clientWidth)).toBeLessThanOrEqual(0);
});

// --- keys, set in Settings ----------------------------------------------------------------------------------------------

test('a key is saved to the keychain in Settings, leaves the page at once, and can be removed', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  await expect(dialog.getByText('Set: Hugging Face. Not set: RunPod, Anthropic')).toBeVisible();   // HF from a file the CLI reads
  const settings = await settingsAt(page, /^API keys 1 of 3 set$/);
  const keys = settings.getByRole('region', { name: 'Keys' });
  await expect(keys.getByRole('listitem', { name: 'Hugging Face' })).toContainText('Found in ~/.config/hyperstudy/bakeoff.env');
  const runpod = keys.getByRole('listitem', { name: 'RunPod' });
  await expect(runpod).toContainText('Not set. Get one at console.runpod.io/user/settings');
  await expect(runpod.getByRole('textbox')).toHaveCount(0);                              // a field only when asked for
  await runpod.getByRole('button', { name: 'Add the RunPod key' }).click();
  const field = runpod.getByRole('textbox', { name: 'RunPod key' });
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('type', 'password');
  await field.fill('rp-test-0123456789');
  await runpod.getByRole('button', { name: 'Save' }).click();
  await expect(runpod).toContainText('In the keychain');
  await expect(runpod.getByRole('textbox')).toHaveCount(0);                              // not kept in the page
  expect(await page.content()).not.toContain('rp-test-0123456789');
  await expect(settings.getByRole('tab', { name: /^API keys 2 of 3 set$/ })).toBeVisible();
  await toExtract(page);
  await expect(dialog.getByText('Set: RunPod, Hugging Face. Not set: Anthropic')).toBeVisible();
  const again = await settingsAt(page, /^API keys/);
  await again.getByRole('button', { name: 'Remove the RunPod key' }).click();
  await expect(again.getByRole('listitem', { name: 'RunPod' })).toContainText('Not set');
});

test('a step missing a key says which, and leads to where it is set', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=missing-key');
  await dialog.getByRole('checkbox', { name: 'Run Shot captions' }).check();
  const captions = dialog.getByRole('listitem', { name: 'captions' });
  await expect(captions).toContainText('Needs the Anthropic key: add it in Settings');
  await captions.getByRole('button', { name: 'add it in Settings' }).click();
  await expect(page.getByRole('region', { name: 'Settings' }).getByRole('tab', { name: /^API keys/ })).toHaveAttribute('aria-selected', 'true');
});

test('a failure listing the pipeline\'s keys is said as it is, not taken for an older pipeline', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=keys-error');
  await expect(dialog.getByText(/the pipeline's keys: .*PermissionError: keys.json/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Change the keys, in Settings' })).toBeVisible();   // the app's own keys still work
});

test('a pipeline from before `perception keys` has the app\'s keys and says nothing is wrong', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=old-cli');
  await expect(dialog.getByText('Not set: RunPod, Anthropic, Hugging Face')).toBeVisible();
  await expect(dialog.getByText(/the pipeline's keys/)).toHaveCount(0);
});

test('a run cannot start while a key is being saved, even from Extract', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
  await page.evaluate(() => { const g = globalThis as { __holdKey?: Promise<void>; __releaseKey?: () => void };
    g.__holdKey = new Promise((r) => { g.__releaseKey = r; }); });
  const settings = await settingsAt(page, /^API keys/);
  const runpod = settings.getByRole('region', { name: 'Keys' }).getByRole('listitem', { name: 'RunPod' });
  await runpod.getByRole('button', { name: 'Add the RunPod key' }).click();
  await runpod.getByRole('textbox', { name: 'RunPod key' }).fill('rp-test-0123456789');
  await runpod.getByRole('button', { name: 'Save' }).click();
  await expect(settings.getByText('Saving the RunPod key…')).toBeVisible();
  await toExtract(page);                                              // back before it is saved
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeDisabled();   // a run now would race the key
  await expect(dialog.getByText('Settings: Saving the RunPod key… Start run waits for it.')).toBeVisible();
  await page.evaluate(() => (globalThis as { __releaseKey?: () => void }).__releaseKey!());
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
  await expect(dialog.getByText('Set: RunPod, Hugging Face. Not set: Anthropic')).toBeVisible();   // planned again with it
});
