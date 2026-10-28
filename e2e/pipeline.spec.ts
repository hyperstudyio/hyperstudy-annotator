// The Extract page (run the pipeline), and the rail that reaches it, against browser mode's scripted stand-in (?pipeline-demo): Tauri is absent here, and the
// real path is tested in Rust against the real CLI.
import { expect, test, type Locator, type Page } from '@playwright/test';

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
/** Settings, at one of its tabs (Models: the keys the steps' models need; Compute: this computer, remote servers and
 *  cloud GPU providers; App): where they are set (Extract only says what a run will use, and plans again when you go
 *  back to it). */
async function settingsAt(page: Page, tab: RegExp) {
  await rail(page).getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('region', { name: 'Settings' });
  await settings.getByRole('tab', { name: tab }).click();
  return settings;
}
const toExtract = (page: Page) => rail(page).getByRole('button', { name: 'Extract' }).click();
/** Open the form for another remote server, fill it in, and add it. */
async function addServer(settings: ReturnType<Page['getByRole']>, name: string, dest: string) {
  await settings.getByRole('button', { name: 'Add server…' }).click();
  const form = settings.getByRole('form', { name: 'Add a remote server' });
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Host').fill(dest);
  await form.getByRole('button', { name: 'Add server' }).click();
  return form;
}
/** A step's menu of where it runs, on its row: there when the step can run in more than one place (and is on). */
const placeMenu = (dialog: Locator, id: string, title: string) =>
  dialog.getByRole('listitem', { name: id }).getByRole('combobox', { name: `Where ${title} runs` });

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
  await expect(captions).toContainText('Anthropic API');
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
  await expect(settings.getByRole('tab', { name: 'Models' })).toBeVisible();
  await expect(settings.getByRole('tab', { name: 'Compute' })).toBeVisible();
  await rail(page).getByRole('button', { name: 'Annotator' }).click();
  await expect(page.getByRole('heading', { name: 'Annotator' })).toBeVisible();
  await toExtract(page);
  await expect(extract.getByRole('heading', { name: /^Finished all/ })).toBeVisible({ timeout: 10_000 });   // it ran while hidden (the stand-in's run takes 4.4 s)
  await expect(extract.getByRole('button', { name: 'Open in Annotator' })).toBeVisible();
  await extract.getByRole('button', { name: 'New run' }).click();
  await expect(extract.getByRole('button', { name: 'Choose a video…' })).toBeVisible();
});

test('a remote server added in Settings is offered on Extract when you go back to it', async ({ page }) => {
  const extract = await planned(page, '/?pipeline-demo');
  await expect(extract.getByText('Steps run on this Mac.')).toBeVisible();          // nowhere else set up
  const settings = await settingsAt(page, /^Compute$/);
  await addServer(settings, 'gpu9', 'you@gpu9.example.edu');
  await expect(settings.getByRole('listitem', { name: 'gpu9' })).toBeVisible();
  await toExtract(page);
  await expect(extract.getByRole('button', { name: 'Add a remote server or cloud GPU' })).toHaveCount(0);   // now somewhere else is
});

test('Extract asks only for a video; with nowhere else set up the plan says steps run here, and leads to Settings', async ({ page }) => {
  const extract = await planned(page, '/?pipeline-demo');
  await expect(extract.getByRole('textbox')).toHaveCount(0);
  await expect(extract.getByRole('combobox')).toHaveCount(0);                      // no runtime to choose, no step to move
  await expect(extract.getByText('Steps run on this Mac.')).toBeVisible();
  await extract.getByRole('button', { name: 'Add a remote server or cloud GPU' }).click();
  await expect(page.getByRole('region', { name: 'Settings' }).getByRole('tab', { name: 'Compute' })).toHaveAttribute('aria-selected', 'true');
});

test('moving one step to a remote server sends only its inputs there; a step that cannot run there stays here', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const menu = placeMenu(dialog, 'faces', 'Face tracks');
  await menu.selectOption('ssh-lab:cuda');
  await expect(menu).toHaveValue('ssh-lab:cuda');
  await expect(dialog.getByRole('listitem', { name: 'asr' })).toContainText('Apple GPU');   // it cannot run there: stays here
  await expect(placeMenu(dialog, 'asr', 'Speech transcript')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Start run' }).click();
  const [ran] = await runs(page);
  expect(ran.places).toEqual({ faces: 'ssh-lab:cuda' });
  expect(ran.allow.uploads).toEqual({ faces: { kinds: ['faces', 'transcript', 'video'], service: 'lab (SSH)' } });
});

test('a step moved to the cloud GPU and back to this computer sends nothing anywhere', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const menu = placeMenu(dialog, 'faces', 'Face tracks');
  await menu.selectOption('cloud:cuda');
  await expect(menu).toHaveValue('cloud:cuda');
  await menu.selectOption('native:mps');
  await expect(menu).toHaveValue('native:mps');
  await dialog.getByRole('button', { name: 'Start run' }).click();
  const [ran] = await runs(page);
  expect(Object.values(ran.places).filter((p) => !p.startsWith('native:'))).toEqual([]);   // nowhere but here
  expect(ran.allow.uploads).toEqual({});
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
  const settings = await settingsAt(page, /^App$/);
  await expect(settings.getByText('Pipeline 0.1.0.', { exact: true })).toBeVisible();
  await settings.getByRole('tab', { name: 'Compute' }).click();
  await expect(settings.getByText('All 4 steps can run here.', { exact: true })).toBeVisible();
  await toExtract(page);
  await expect(dialog.getByRole('button', { name: 'Change…' })).toHaveCount(1);   // the video's: no pipeline folder
});

test('while the pipeline is installed nothing asks it anything, then the dialog fills in', async ({ page }) => {
  await page.goto('/?pipeline-demo=installing');
  const dialog = page.getByRole('region', { name: 'Extract' });
  await expect(dialog.getByText(/^Installing the pipeline\./)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Choose a video…' })).toHaveCount(0);
  await expect(dialog.locator('.error')).toHaveCount(0);   // the doctor was not asked before it was there
  await expect(dialog.getByRole('button', { name: 'Choose a video…' })).toBeVisible({ timeout: 5000 });
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
  await expect(dialog.getByRole('button', { name: 'Choose a video…' })).toBeVisible({ timeout: 5000 });
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
  await expect(faces.locator('.time')).toHaveText('1 min 36 s');               // the estimate beside the menu, not an option in it
  const menu = placeMenu(dialog, 'faces', 'Face tracks');
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
  await expect(model.getByRole('option')).toHaveText(['Claude Haiku 5.5, $0.003 per shot', 'Claude Opus 5.5, $0.12 per shot']);
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
  const menu = placeMenu(dialog, 'faces', 'Face tracks');
  await expect(menu.getByRole('option')).toHaveText(['Apple GPU, about 1 min 36 s', 'NVIDIA GPU on lab (SSH), no estimate yet',
    'Cloud GPU (AWS L4), no estimate yet, up to $0.49']);
  const [box, cell] = await Promise.all([menu.boundingBox(), menu.locator('xpath=..').boundingBox()]);
  expect(box!.x + box!.width).toBeLessThanOrEqual(cell!.x + cell!.width);   // the longest option stays inside its column
});

test('a place that cannot be planned is said why: the steps stay, Start run waits, and choosing again plans again', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const menu = placeMenu(dialog, 'faces', 'Face tracks');
  await expect(menu).toHaveValue('native:mps');
  await page.evaluate(() => { (window as unknown as { __refusePlace?: string }).__refusePlace = 'ssh-lab:cuda'; });
  await menu.selectOption('ssh-lab:cuda');
  await expect(dialog.getByText('not a node and a place: "faces" = "ssh-lab:cuda"')).toBeVisible();
  await expect(menu).toHaveValue('ssh-lab:cuda');                                 // what is chosen, to choose again
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeDisabled();  // the plan on screen is not of it
  await expect(dialog.getByText(/Start run waits until what is chosen can be planned/)).toBeVisible();
  await menu.selectOption('native:mps');
  await expect(dialog.getByText(/not a node and a place/)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Start run' }).click();
  expect((await runs(page))[0].places).toEqual({ faces: 'native:mps' });
});

test('a plan that failed for a reason that was not the choice is planned again, with the same choices, when asked', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const menu = placeMenu(dialog, 'faces', 'Face tracks');
  await page.evaluate(() => { (window as unknown as { __refusePlace?: string }).__refusePlace = 'ssh-lab:cuda'; });   // a server briefly unreachable
  await menu.selectOption('ssh-lab:cuda');
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeDisabled();
  await page.evaluate(() => { delete (window as unknown as { __refusePlace?: string }).__refusePlace; });          // reachable again
  await dialog.getByRole('button', { name: 'Plan again' }).click();
  await expect(dialog.getByText(/not a node and a place/)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Start run' }).click();
  expect((await runs(page))[0].places).toEqual({ faces: 'ssh-lab:cuda' });       // the same choice, not another
});

test('changes made while a refused one was planning are not run: Start run waits for a plan of all of them', async ({ page }) => {
  type W = { __holdPlan?: Promise<void>; __refusePlace?: string; releasePlan?: () => void };
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const faces = placeMenu(dialog, 'faces', 'Face tracks');
  await dialog.getByRole('checkbox', { name: 'Run Shot captions' }).check();
  await dialog.getByRole('button', { name: 'Shot captions' }).click();
  const model = dialog.getByRole('listitem', { name: 'captions' }).getByRole('combobox', { name: 'Model' });
  await page.evaluate(() => { const w = window as unknown as W; w.__holdPlan = new Promise((r) => { w.releasePlan = r; }); });
  await model.selectOption('claude-opus-5-5');                                    // its plan held back
  await faces.selectOption('ssh-lab:cuda');                                       // planned with it, held too
  await page.evaluate(() => { const w = window as unknown as W; w.__refusePlace = 'ssh-lab:cuda'; w.releasePlan!(); });
  await expect(dialog.getByText('not a node and a place: "faces" = "ssh-lab:cuda"')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeDisabled();  // Opus was never planned either
  await expect(model).toHaveValue('claude-opus-5-5');
  await page.evaluate(() => { const w = window as unknown as W; delete w.__refusePlace; delete w.__holdPlan; });
  await faces.selectOption('native:mps');
  await expect(dialog.getByRole('heading', { name: /\$6\.24$/ })).toBeVisible();   // planned with Opus now
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
});

test('another video that cannot be planned with what was chosen offers to plan with each step\'s own place', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  await placeMenu(dialog, 'faces', 'Face tracks').selectOption('ssh-lab:cuda');
  await expect(placeMenu(dialog, 'faces', 'Face tracks')).toHaveValue('ssh-lab:cuda');
  await page.evaluate(() => { (window as unknown as { __refusePlace?: string }).__refusePlace = 'ssh-lab:cuda'; });   // the server since refused
  await dialog.getByRole('button', { name: 'Change…' }).click();
  await expect(dialog.getByText(/not a node and a place/)).toBeVisible();
  await expect(dialog.getByRole('listitem', { name: 'faces' })).toHaveCount(0);   // no plan of this video yet
  await dialog.getByRole('button', { name: "Plan again with each step's own place and settings" }).click();
  await expect(placeMenu(dialog, 'faces', 'Face tracks')).toHaveValue('native:mps');
  await expect(dialog.getByText(/not a node and a place/)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
});

test('moving a step to a lab server is the choice to send it its inputs: it stays on, and the run may send them there only', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const faces = dialog.getByRole('listitem', { name: 'faces' });
  await placeMenu(dialog, 'faces', 'Face tracks').selectOption('ssh-lab:cuda');
  await expect(dialog.getByRole('checkbox', { name: 'Run Face tracks' })).toBeChecked();   // not turned off for sending
  await dialog.getByRole('button', { name: 'Face tracks' }).click();          // its details: what it sends, and where
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
  await placeMenu(dialog, 'faces', 'Face tracks').selectOption('cloud:cuda');
  await expect(dialog.getByRole('heading', { name: /steps to run.*\$0\.49/ })).toBeVisible();
  await expect(dialog.getByRole('listitem', { name: 'faces' })).toContainText('Up to $0.49');   // the most the machine can cost
  await dialog.getByRole('button', { name: 'Start run' }).click();
  const [ran] = await runs(page);
  expect(ran.allow.uploads).toEqual({ faces: { kinds: ['faces', 'transcript', 'video'], service: 'Cloud GPU (AWS L4)' } });
  expect(ran.maxCostUsd).toBe(0.99);                                            // the graph's $0.50, and the machine's most
});

test('moving a step back to this machine sends nothing', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const menu = placeMenu(dialog, 'faces', 'Face tracks');
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
  const menu = placeMenu(dialog, 'faces', 'Face tracks');
  await expect(menu.getByRole('option')).toHaveText([/^Apple GPU/, /^NVIDIA GPU on lab \(SSH\)/, /^Cloud GPU \(AWS L4\)/]);   // this Mac, the lab server, the cloud
  const settings = await settingsAt(page, /^Compute$/);
  const servers = settings.getByRole('region', { name: 'Remote servers' });
  await expect(servers.getByRole('listitem')).toHaveCount(1);
  await expect(settings.getByRole('listitem', { name: 'lab' })).toContainText('Linux, 32 cores, 252 GB, NVIDIA GPU (48 GB)');
  await expect(settings.getByRole('form', { name: 'Add a remote server' })).toHaveCount(0);   // opened when asked for
  await addServer(settings, 'gpu2', 'you@gpu2.example.edu');
  await expect(settings.getByRole('listitem', { name: 'gpu2' })).toBeVisible();
  await expect(settings.getByRole('form', { name: 'Add a remote server' })).toHaveCount(0);   // closed once added
  await expect(servers.getByRole('listitem')).toHaveCount(2);
  await toExtract(page);
  await expect(menu.getByRole('option', { name: /NVIDIA GPU on gpu2 \(SSH\)/ })).toHaveCount(1);
});

test('removing a remote server or the cloud provider takes its place out of the menus', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const menu = placeMenu(dialog, 'faces', 'Face tracks');
  await expect(menu.getByRole('option', { name: /on lab/ })).toHaveCount(1);
  await expect(menu.getByRole('option', { name: /Cloud GPU/ })).toHaveCount(1);
  const settings = await settingsAt(page, /^Compute$/);
  await settings.getByRole('listitem', { name: 'lab' }).getByRole('button', { name: 'Remove lab' }).click();
  await expect(settings.getByRole('listitem', { name: 'lab' })).toHaveCount(0);
  await expect(settings.getByRole('listitem', { name: 'AWS' })).toContainText('$0.98 an hour');
  await settings.getByRole('button', { name: 'Remove AWS' }).click();
  await expect(settings.getByRole('listitem', { name: 'AWS' })).toHaveCount(0);
  await toExtract(page);
  // nowhere else to run: the step's place is plain text, and the plan says the steps run here
  await expect(dialog.getByText('Steps run on this Mac.')).toBeVisible();
  await expect(menu).toHaveCount(0);
  await expect(dialog.getByRole('listitem', { name: 'faces' })).toContainText('Apple GPU');
  await expect(dialog.getByRole('listitem', { name: 'faces' })).not.toContainText(/on lab|Cloud GPU/);
});

test('a step on a remote server that is then removed goes back to this machine, and nothing is agreed for it', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const menu = placeMenu(dialog, 'faces', 'Face tracks');
  await menu.selectOption('ssh-lab:cuda');
  await expect(menu).toHaveValue('ssh-lab:cuda');
  const settings = await settingsAt(page, /^Compute$/);
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
  const settings = await settingsAt(page, /^Compute$/);
  await settings.getByRole('button', { name: 'Add server…' }).click();
  const form = settings.getByRole('form', { name: 'Add a remote server' });
  await form.getByLabel('Name').fill('lab');
  await form.getByLabel('Host').fill('you@another-lab.example.edu');
  await expect(form.getByRole('button', { name: 'Add server' })).toBeDisabled();
  await expect(form.getByText(/lab is already a remote server here: remove it first/)).toBeVisible();
});

test('a step on a remote server whose name now leads to another machine goes back to this machine', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const menu = placeMenu(dialog, 'faces', 'Face tracks');
  await menu.selectOption('ssh-lab:cuda');
  await expect(menu).toHaveValue('ssh-lab:cuda');
  await page.evaluate(() => { (globalThis as { __readdedElsewhere?: boolean }).__readdedElsewhere = true; });   // re-added with the CLI
  const settings = await settingsAt(page, /^Compute$/);
  await settings.getByRole('listitem', { name: 'lab' }).getByRole('button', { name: 'Test lab' }).click();
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
  await placeMenu(dialog, 'faces', 'Face tracks').selectOption('ssh-lab:cuda');
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
  await page.evaluate(() => { const g = globalThis as { __holdHost?: Promise<void>; __release?: () => void };
    g.__holdHost = new Promise((r) => { g.__release = r; }); });
  const settings = await settingsAt(page, /^Compute$/);
  await settings.getByRole('button', { name: 'Clear the cache on lab' }).click();
  await expect(settings.getByText('Clearing the cache on lab…')).toBeVisible();
  await toExtract(page);                                              // back before it is done
  await expect(dialog.getByText('Settings: Clearing the cache on lab… Start run waits for it.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeDisabled();
  await page.evaluate(() => (globalThis as { __release?: () => void }).__release!());
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
  await expect(placeMenu(dialog, 'faces', 'Face tracks')).toHaveValue('ssh-lab:cuda');
});

test('a step on a remote server found without its GPU goes back to this machine', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const menu = placeMenu(dialog, 'faces', 'Face tracks');
  await menu.selectOption('ssh-lab:cuda');
  await page.evaluate(() => { (globalThis as { __gpuGone?: boolean }).__gpuGone = true; });
  const settings = await settingsAt(page, /^Compute$/);
  await settings.getByRole('button', { name: 'Test lab' }).click();
  await expect(settings.getByRole('listitem', { name: 'lab' })).toContainText('no GPU');
  await toExtract(page);
  await expect(menu).toHaveValue('native:mps');                      // the plan still stands, on this machine
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
});

test('a remote server that cannot be reached is not added, and says why', async ({ page }) => {
  await planned(page, '/?pipeline-demo=remote');
  const settings = await settingsAt(page, /^Compute$/);
  const form = await addServer(settings, 'far', 'you@unreachable.example.edu');
  await expect(settings.getByText(/could not reach you@unreachable\.example\.edu/)).toBeVisible();
  await expect(settings.getByRole('listitem', { name: 'far' })).toHaveCount(0);
  await expect(form.getByLabel('Name')).toHaveValue('far');           // kept, to correct
});

test('a pipeline from before other machines says so and offers nothing to set', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=old-cli');
  await expect(dialog.getByRole('combobox', { name: /^Where / })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Add a remote server or cloud GPU' })).toHaveCount(0);
  const settings = await settingsAt(page, /^Compute$/);
  await expect(settings.getByText(/This pipeline runs every step on this computer/)).toBeVisible();
});

test('a failure listing the machines is said as it is, not taken for an older pipeline', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=machines-error');
  await expect(dialog.getByText(/PermissionError: hosts\.json/)).toBeVisible();
  await expect(dialog.getByText(/cannot run steps elsewhere/)).toHaveCount(0);
});

test('remote servers are offered by a pipeline that cannot start cloud machines yet', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=no-cloud');
  await expect(dialog.getByRole('button', { name: 'Add a remote server or cloud GPU' })).toBeVisible();
  const settings = await settingsAt(page, /^Compute$/);
  await expect(settings.getByText(/cannot start cloud machines yet/)).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Add server…' })).toBeVisible();
});

test('in a narrow window Settings fits without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await planned(page, '/?pipeline-demo=remote');
  const settings = await settingsAt(page, /^Compute$/);
  await addServer(settings, 'gpu17', 'firstname.lastname@gpu-node-17.psych.example.edu');   // a long one
  await expect(settings.getByRole('listitem', { name: 'gpu17' })).toBeVisible();
  const page_ = page.locator('.page.on');
  expect(await page_.evaluate((d) => d.scrollWidth - d.clientWidth)).toBeLessThanOrEqual(0);
});

// --- keys, set in Settings where they are used: Models (shot captions, gated models), Machines (a cloud provider) -----

test('a key is saved to the keychain where its step is listed, leaves the page at once, and can be removed', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  const settings = await settingsAt(page, /^Models$/);
  const captions = settings.getByRole('listitem', { name: 'Shot captions' });
  await expect(captions).toContainText('Runs on the Anthropic API');
  const anthropic = captions.getByRole('listitem', { name: 'Anthropic key' });
  await expect(anthropic).toContainText('Not set. Get one at console.anthropic.com/settings/keys');
  await expect(anthropic.getByRole('textbox')).toHaveCount(0);                            // a field only when asked for
  await anthropic.getByRole('button', { name: 'Add the Anthropic key' }).click();
  const field = anthropic.getByRole('textbox', { name: 'Anthropic key' });
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('type', 'password');
  await field.fill('sk-ant-test-0123456789');
  await anthropic.getByRole('button', { name: 'Save' }).click();
  await expect(anthropic).toContainText('Saved in the keychain');
  await expect(anthropic.getByRole('textbox')).toHaveCount(0);                            // not kept in the page
  expect(await page.content()).not.toContain('sk-ant-test-0123456789');
  await expect(anthropic.getByRole('button', { name: 'Replace the Anthropic key' })).toBeVisible();
  await anthropic.getByRole('button', { name: 'Remove the Anthropic key' }).click();
  await expect(anthropic).toContainText('Not set');
  await toExtract(page);
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
});

test('Models lists every step with its models, where it runs, a licence that limits use, and its choices', async ({ page }) => {
  await page.goto('/?pipeline-demo');
  const settings = await settingsAt(page, /^Models$/);
  for (const step of ['Shots and audio', 'Speech transcript', 'Face tracks', 'Shot captions'])
    await expect(settings.getByRole('listitem', { name: step })).toBeVisible();
  const faces = settings.getByRole('listitem', { name: 'Face tracks' });
  await expect(faces).toContainText('Academic use only');
  await expect(faces).toContainText('Runs on your computers');
  await expect(settings.getByRole('combobox', { name: 'Shot captions: model' })).toHaveValue('claude-haiku-5-5');
  await expect(settings.getByRole('region', { name: 'Hugging Face' })).toHaveCount(0);   // no gated model: no key asked for
});

test("the captions model chosen in Models is what Extract plans with, and Extract can still change it for a run", async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  const settings = await settingsAt(page, /^Models$/);
  await settings.getByRole('combobox', { name: 'Shot captions: model' }).selectOption('claude-opus-5-5');
  await page.reload();                                                                   // kept
  const again = await settingsAt(page, /^Models$/);
  await expect(again.getByRole('combobox', { name: 'Shot captions: model' })).toHaveValue('claude-opus-5-5');
  await toExtract(page);
  const extract = page.getByRole('region', { name: 'Extract' });
  await extract.getByRole('button', { name: 'Choose a video…' }).click();
  await extract.getByRole('checkbox', { name: 'Run Shot captions' }).check();
  await expect(extract.getByRole('listitem', { name: 'captions' })).toContainText('$6.24');   // 52 shots of Opus
  void dialog;
});

// --- Hugging Face access: the gated models' steps, set up in order at the top of Models --------------------------------

/** Settings > Models in a gated demo, with the pages the app opens recorded rather than opened. */
async function hfAccessAt(page: Page, demo: string) {
  await page.addInitScript(() => {
    const w = window as unknown as { __opened: string[] };
    w.__opened = [];
    window.open = (url?: string | URL) => { w.__opened.push(String(url)); return null; };
  });
  await page.goto(`/?pipeline-demo=${demo}`);
  const settings = await settingsAt(page, /^Models$/);
  return { settings, hf: settings.getByRole('region', { name: 'Hugging Face access' }) };
}
const opened = (page: Page) => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
const model = (hf: Locator, name: string) => hf.getByRole('listitem', { name: 'Ask for access' }).getByRole('listitem', { name });

test('gated models: the steps to set up Hugging Face, each model with how it is granted and where to ask', async ({ page }) => {
  const { settings, hf } = await hfAccessAt(page, 'gated');
  await expect(hf.getByRole('heading', { name: 'Hugging Face access' })).toBeVisible();
  await expect(hf.locator('.steps > li')).toHaveCount(4);
  await expect(model(hf, 'SAM 3')).toContainText('Objects');
  await expect(model(hf, 'SAM 3')).toContainText('Meta reviews requests');
  await expect(model(hf, 'DINOv3')).toContainText('Meta reviews requests');
  await expect(model(hf, 'pyannote')).toContainText('Speaker diarization');
  await expect(model(hf, 'pyannote')).toContainText('Granted on accepting the terms');
  await expect(model(hf, 'SAM 3')).not.toContainText(/Granted|Not yet/);                      // nothing known without a token
  await hf.getByRole('button', { name: 'Open Hugging Face' }).click();
  await hf.getByRole('button', { name: 'Ask for access to DINOv3' }).click();
  await hf.getByRole('button', { name: 'Create token' }).click();
  expect(await opened(page)).toEqual(['https://huggingface.co/login', 'https://huggingface.co/facebook/dinov3-vitl16-pretrain-lvd1689m',
    'https://huggingface.co/settings/tokens/new?tokenType=read']);
  // the steps that need it say so, and lead to it; the token is not asked for again on them
  const objects = settings.getByRole('listitem', { name: 'Objects' });
  await expect(objects).toContainText('facebook/sam3');
  await expect(settings.getByRole('listitem', { name: 'Speaker diarization' }).getByRole('button', { name: 'Needs Hugging Face access' })).toBeVisible();
  await expect(settings.getByRole('listitem', { name: 'Hugging Face key' })).toHaveCount(0);
  await objects.getByRole('button', { name: 'Needs Hugging Face access' }).click();
  await expect(hf.getByRole('heading', { name: 'Hugging Face access' })).toBeFocused();
});

test('saving a token checks every model at once, and Check again shows a review Meta has since granted', async ({ page }) => {
  const { settings, hf } = await hfAccessAt(page, 'gated');
  const token = hf.getByRole('form', { name: 'Hugging Face token' });
  await token.getByLabel('Paste it here').fill('hf_demo_pending_0123456789');
  await token.getByRole('button', { name: 'Save' }).click();
  await expect(hf).toContainText('Signed in as ana');
  await expect(hf).toContainText('Saved in the keychain');
  expect(await page.content()).not.toContain('hf_demo_pending_0123456789');
  await expect(model(hf, 'SAM 3')).toContainText('✓ Granted');
  await expect(model(hf, 'DINOv3')).toContainText('Not yet');
  await expect(model(hf, 'pyannote')).toContainText('✓ Granted');
  await expect(settings.getByRole('listitem', { name: 'Objects' }).getByRole('button', { name: 'Needs Hugging Face access' })).toBeVisible();
  await expect(settings.getByRole('listitem', { name: 'Speaker diarization' }).getByRole('button', { name: 'Needs Hugging Face access' })).toHaveCount(0);
  await page.evaluate(() => { (globalThis as { __metaGranted?: boolean }).__metaGranted = true; });
  await hf.getByRole('button', { name: 'Check again' }).click();
  await expect(hf).toContainText('Signed in as ana · access to all 3 models');                 // one line now
  await expect(hf.locator('.steps')).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Needs Hugging Face access' })).toHaveCount(0);
  await hf.getByRole('button', { name: 'Show steps' }).click();
  await expect(model(hf, 'DINOv3')).toContainText('✓ Granted');
  await hf.getByRole('button', { name: 'Hide steps' }).click();
  await expect(hf.locator('.steps')).toHaveCount(0);
});

test('a token Hugging Face refuses is said plainly, with no model said granted, and a new one is checked at once', async ({ page }) => {
  const { hf } = await hfAccessAt(page, 'gated-refused');
  await expect(hf.getByRole('alert')).toHaveText('Hugging Face refused this token.');
  await expect(hf).not.toContainText('Signed in');
  await expect(model(hf, 'SAM 3')).not.toContainText(/Granted|Not yet/);
  await hf.getByRole('button', { name: 'Replace the Hugging Face token' }).click();
  const field = hf.getByLabel('Paste it here');
  await expect(field).toBeFocused();
  await field.fill('hf_demo_0123456789');
  await field.press('Enter');
  await expect(hf).toContainText('Signed in as ana · access to all 3 models');
  await expect(hf.getByRole('alert')).toHaveCount(0);
});

test('with every model granted it is one line; removing the token brings the steps back', async ({ page }) => {
  const { settings, hf } = await hfAccessAt(page, 'gated-granted');
  await expect(hf).toContainText('Hugging Face');
  await expect(hf).toContainText('Signed in as ana · access to all 3 models');
  await expect(settings.getByRole('button', { name: 'Needs Hugging Face access' })).toHaveCount(0);
  await hf.getByRole('button', { name: 'Remove the Hugging Face token' }).click();
  await expect(hf.getByLabel('Paste it here')).toBeVisible();
  await expect(model(hf, 'SAM 3')).not.toContainText('Granted');
  await expect(settings.getByRole('button', { name: 'Needs Hugging Face access' })).toHaveCount(2);
});

test('a token the command line finds in a file is checked too, and is not the app\'s to remove', async ({ page }) => {
  const { hf } = await hfAccessAt(page, 'gated-file');
  await expect(hf).toContainText('Signed in as ana · access to all 3 models');
  await expect(hf.getByRole('button', { name: 'Remove the Hugging Face token' })).toHaveCount(0);
  await hf.getByRole('button', { name: 'Show steps' }).click();
  await expect(hf).toContainText('Found in ~/.config/hyperstudy/bakeoff.env');
});

test('a check that fails is said, not taken for an older pipeline, and can be asked again', async ({ page }) => {
  const { hf } = await hfAccessAt(page, 'gated');
  await page.evaluate(() => { (globalThis as { __checkFails?: string }).__checkFails = 'the pipeline failed: URLError: Network is unreachable'; });
  const token = hf.getByRole('form', { name: 'Hugging Face token' });
  await token.getByLabel('Paste it here').fill('hf_demo_0123456789');
  await token.getByRole('button', { name: 'Save' }).click();
  await expect(hf.getByRole('alert')).toContainText('Network is unreachable');
  await expect(hf.getByRole('button', { name: 'Test the Hugging Face token' })).toHaveCount(0);
  await page.evaluate(() => { delete (globalThis as { __checkFails?: string }).__checkFails; });
  await hf.getByRole('button', { name: 'Check again' }).click();
  await expect(hf).toContainText('Signed in as ana · access to all 3 models');
  await expect(hf.getByRole('alert')).toHaveCount(0);
});

test('a token half pasted and put away with Escape is gone the next time', async ({ page }) => {
  const { hf } = await hfAccessAt(page, 'gated-pending');
  await hf.getByRole('button', { name: 'Replace the Hugging Face token' }).click();
  await hf.getByLabel('Paste it here').fill('hf_thrown_away');
  await hf.getByLabel('Paste it here').press('Escape');
  await hf.getByRole('button', { name: 'Replace the Hugging Face token' }).click();
  await expect(hf.getByLabel('Paste it here')).toHaveValue('');
});

test('a pipeline whose check does not say each model\'s access keeps the token\'s Test', async ({ page }) => {
  const { hf } = await hfAccessAt(page, 'gated-old');
  await expect(model(hf, 'SAM 3')).toBeVisible();
  await expect(hf.getByRole('button', { name: 'Check again' })).toHaveCount(0);
  await hf.getByRole('button', { name: 'Test the Hugging Face token' }).click();
  await expect(hf.getByRole('status')).toHaveText('✓ Hugging Face accepted the key.');
  await expect(model(hf, 'SAM 3')).not.toContainText('Granted');                              // not said, so not shown
});

test('Hugging Face access fits a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { hf } = await hfAccessAt(page, 'gated-pending');
  await expect(model(hf, 'DINOv3')).toContainText('Not yet');
  for (const name of ['SAM 3', 'DINOv3', 'pyannote']) {
    const box = (await model(hf, name).boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('a pipeline that cannot list its steps still offers the Anthropic key, and says nothing is wrong', async ({ page }) => {
  await page.goto('/?pipeline-demo=old-cli');
  const settings = await settingsAt(page, /^Models$/);
  await expect(settings.getByRole('listitem', { name: 'Anthropic key' })).toBeVisible();
  await expect(settings.getByText(/Could not list the models/)).toHaveCount(0);   // an older pipeline, not a failure
});

test('a key is tested with its provider, and a key it refuses is said so', async ({ page }) => {
  await page.goto('/?pipeline-demo');
  const settings = await settingsAt(page, /^Models$/);
  const anthropic = settings.getByRole('listitem', { name: 'Anthropic key' });
  await expect(anthropic.getByRole('button', { name: 'Test the Anthropic key' })).toHaveCount(0);   // nothing to test yet
  for (const [key, said] of [['sk-ant-good', '✓ Anthropic accepted the key.'], ['rejected-key', 'Anthropic refused the key.']]) {
    await anthropic.getByRole('button', { name: /(Add|Replace) the Anthropic key/ }).click();
    await anthropic.getByRole('textbox', { name: 'Anthropic key' }).fill(key);
    await anthropic.getByRole('button', { name: 'Save' }).click();
    await anthropic.getByRole('button', { name: 'Test the Anthropic key' }).click();
    await expect(anthropic.getByRole('status')).toHaveText(said);
  }
});

test('a pipeline from before key tests says to update it, not that the key failed', async ({ page }) => {
  await page.goto('/?pipeline-demo=old-checks');
  const settings = await settingsAt(page, /^Models$/);
  const anthropic = settings.getByRole('listitem', { name: 'Anthropic key' });
  await anthropic.getByRole('button', { name: 'Add the Anthropic key' }).click();
  await anthropic.getByRole('textbox', { name: 'Anthropic key' }).fill('sk-ant-good');
  await anthropic.getByRole('button', { name: 'Save' }).click();
  await anthropic.getByRole('button', { name: 'Test the Anthropic key' }).click();
  await expect(anthropic.getByRole('alert')).toHaveText('Update the pipeline to test keys.');
});

test('a server is tested before it is added, with what overrides ~/.ssh/config for it', async ({ page }) => {
  await page.goto('/?pipeline-demo=remote');
  const settings = await settingsAt(page, /^Compute$/);
  await settings.getByRole('button', { name: 'Add server…' }).click();
  const form = settings.getByRole('form', { name: 'Add a remote server' });
  await expect(form.locator('datalist option')).toHaveCount(2);                          // the hosts ~/.ssh/config names
  await form.getByLabel('Host').fill('lab-gpu.example.edu');
  await expect(form.getByLabel('Name')).toHaveValue('lab-gpu');                          // made from the host
  await form.getByText('Advanced (over ~/.ssh/config)').click();
  await form.getByLabel('User').fill('ana');
  await form.getByLabel('Port').fill('2222');
  await form.getByLabel('Key file').fill('~/.ssh/id_lab');
  await form.getByRole('button', { name: 'Test connection' }).click();
  await expect(form.getByRole('status')).toContainText('Reached lab-gpu.example.edu: Linux, 32 cores');
  await form.getByLabel('Port').fill('2223');
  await expect(form.getByRole('status')).toHaveCount(0);                                 // what was tested is not this any more
  await form.getByLabel('Port').fill('2222');
  expect(await page.evaluate(() => (window as unknown as { __pipelineServers: unknown[] }).__pipelineServers)).toEqual([]);   // nothing added by a test
  await form.getByRole('button', { name: 'Add server' }).click();
  const row = settings.getByRole('listitem', { name: 'lab-gpu' });
  await expect(row).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __pipelineServers: unknown[] }).__pipelineServers))
    .toEqual([{ name: 'lab-gpu', dest: 'lab-gpu.example.edu', overrides: { user: 'ana', port: 2222, identity: '~/.ssh/id_lab' } }]);
});

test('a server that cannot be reached is said so by Test connection, and nothing is added', async ({ page }) => {
  await page.goto('/?pipeline-demo=remote');
  const settings = await settingsAt(page, /^Compute$/);
  await settings.getByRole('button', { name: 'Add server…' }).click();
  const form = settings.getByRole('form', { name: 'Add a remote server' });
  await form.getByLabel('Host').fill('unreachable.example.edu');
  await form.getByRole('button', { name: 'Test connection' }).click();
  await expect(settings.getByText(/could not reach unreachable.example.edu/)).toBeVisible();
  await expect(settings.getByRole('listitem', { name: 'unreachable' })).toHaveCount(0);
});

test('a step missing a key says which, and leads to where it is set', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=missing-key');
  await dialog.getByRole('checkbox', { name: 'Run Shot captions' }).check();
  const captions = dialog.getByRole('listitem', { name: 'captions' });
  await expect(captions).toContainText('Needs the Anthropic key: add it in Settings');
  await captions.getByRole('button', { name: 'add it in Settings' }).click();
  const settings = page.getByRole('region', { name: 'Settings' });
  await expect(settings.getByRole('tab', { name: 'Models' })).toHaveAttribute('aria-selected', 'true');
  await expect(settings.getByRole('button', { name: 'Add the Anthropic key' })).toBeVisible();
});

test('a failure listing the pipeline\'s keys is said as it is, not taken for an older pipeline', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=keys-error');
  await expect(dialog.getByText(/the pipeline's keys: .*PermissionError: keys.json/)).toBeVisible();
  const settings = await settingsAt(page, /^Models$/);
  await expect(settings.getByRole('listitem', { name: 'Anthropic key' })).toBeVisible();   // the app's own keys still work
});

test('a pipeline from before `perception keys` has the app\'s keys and says nothing is wrong', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=old-cli');
  await expect(dialog.getByText(/the pipeline's keys/)).toHaveCount(0);
  const settings = await settingsAt(page, /^Models$/);
  await expect(settings.getByRole('listitem', { name: 'Anthropic key' })).toContainText('Not set');
  await expect(settings.getByText(/Could not read the keys/)).toHaveCount(0);
});

test('a run cannot start while a key is being saved, even from Extract', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
  await page.evaluate(() => { const g = globalThis as { __holdKey?: Promise<void>; __releaseKey?: () => void };
    g.__holdKey = new Promise((r) => { g.__releaseKey = r; }); });
  const settings = await settingsAt(page, /^Models$/);
  const anthropic = settings.getByRole('listitem', { name: 'Anthropic key' });
  await anthropic.getByRole('button', { name: 'Add the Anthropic key' }).click();
  await anthropic.getByRole('textbox', { name: 'Anthropic key' }).fill('sk-ant-test-0123456789');
  await anthropic.getByRole('button', { name: 'Save' }).click();
  await expect(settings.getByText('Saving the Anthropic key…')).toBeVisible();
  await toExtract(page);                                              // back before it is saved
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeDisabled();   // a run now would race the key
  await expect(dialog.getByText('Settings: Saving the Anthropic key… Start run waits for it.')).toBeVisible();
  await page.evaluate(() => (globalThis as { __releaseKey?: () => void }).__releaseKey!());
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
});

// --- where a step runs, chosen on its row ---------------------------------------------------------------------------

test('the menu on a step\'s row moves it and plans again; a step with one place to run says it in plain text', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const faces = dialog.getByRole('listitem', { name: 'faces' });
  const menu = placeMenu(dialog, 'faces', 'Face tracks');
  await expect(menu).toHaveValue('native:mps');
  await expect(faces.locator('.time')).toHaveText('1 min 36 s');
  await expect(dialog.getByText(/^Not counting Face tracks/)).toHaveCount(0);
  await menu.selectOption('ssh-lab:cuda');
  await expect(faces.locator('.time')).toHaveText('No estimate');              // the new plan's estimate, for the server
  await expect(dialog.getByText(/^Not counting Face tracks/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Face tracks' })).toHaveAttribute('aria-expanded', 'false');   // nothing opened to move it
  const asr = dialog.getByRole('listitem', { name: 'asr' });
  await expect(asr.getByRole('combobox')).toHaveCount(0);
  await expect(asr.locator('.where')).toHaveText('Apple GPU');
});

// --- cloud GPU providers, added in Settings > Compute -----------------------------------------------------------------

test('RunPod has one Test and one Remove: Test is its key\'s (the same request), Remove takes the key with it', async ({ page }) => {
  await page.goto('/?pipeline-demo=remote');
  const settings = await settingsAt(page, /^Compute$/);
  const cloud = settings.getByRole('region', { name: 'Cloud GPU' });
  await cloud.getByRole('button', { name: 'Add provider…' }).click();
  const form = cloud.getByRole('form', { name: 'Add a cloud GPU provider' });
  await form.getByRole('textbox', { name: 'RunPod API key' }).fill('rp-test-0123456789');
  await form.getByRole('button', { name: 'Add RunPod' }).click();
  const runpod = cloud.getByRole('listitem', { name: 'RunPod', exact: true });
  await expect(runpod.getByRole('button', { name: /^Remove/ })).toHaveCount(1);         // one Remove: RunPod's, not its key's
  await expect(runpod.getByRole('button', { name: 'Remove the RunPod key' })).toHaveCount(0);
  await expect(runpod.getByRole('button', { name: /^Test/ })).toHaveCount(1);           // one Test: the key's
  await expect(runpod.getByRole('button', { name: 'Test RunPod' })).toHaveCount(0);
  await runpod.getByRole('button', { name: 'Test the RunPod key' }).click();
  await expect(runpod.getByRole('status').filter({ hasText: 'accepted' })).toHaveText('✓ RunPod accepted the key.');
  const aws = cloud.getByRole('listitem', { name: 'AWS', exact: true });               // no key of its own: Test is AWS's
  await expect(aws.getByRole('button', { name: /^Test/ })).toHaveCount(1);
  await expect(aws.getByRole('button', { name: 'Test AWS' })).toHaveCount(1);
});

test('RunPod whose key has gone keeps a Test of its own, which says the key is missing', async ({ page }) => {
  await page.goto('/?pipeline-demo=runpod-key-gone');
  const settings = await settingsAt(page, /^Compute$/);
  const runpod = settings.getByRole('region', { name: 'Cloud GPU' }).getByRole('listitem', { name: 'RunPod', exact: true });
  await expect(runpod.getByRole('listitem', { name: 'RunPod key' })).toContainText('Not set.');
  await expect(runpod.getByRole('button', { name: 'Test the RunPod key' })).toHaveCount(0);   // nothing for the key to test
  await runpod.getByRole('button', { name: 'Test RunPod' }).click();
  await expect(runpod.locator('p.tested')).toHaveText('no RunPod API key.');
  await runpod.getByRole('button', { name: 'Add the RunPod key' }).click();         // the next thing done
  await runpod.getByRole('textbox', { name: 'RunPod key' }).fill('rp-good');
  await runpod.getByRole('button', { name: 'Save' }).click();
  await expect(runpod.getByRole('listitem', { name: 'RunPod key' })).toContainText('Saved in the keychain');
  await expect(runpod.locator('p.tested')).toHaveCount(0);                            // said of the key before
});

test('RunPod is added with its key, is then a place for a step, and removing it removes its key', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const menu = placeMenu(dialog, 'faces', 'Face tracks');
  await expect(menu.getByRole('option', { name: /RunPod/ })).toHaveCount(0);
  const settings = await settingsAt(page, /^Compute$/);
  const cloud = settings.getByRole('region', { name: 'Cloud GPU' });
  await cloud.getByRole('button', { name: 'Add provider…' }).click();
  const form = cloud.getByRole('form', { name: 'Add a cloud GPU provider' });
  await expect(form.getByRole('radio', { name: /^RunPod/ })).toBeChecked();
  const key = form.getByRole('textbox', { name: 'RunPod API key' });
  await expect(key).toBeFocused();
  await expect(form.getByRole('button', { name: 'Add RunPod' })).toBeDisabled();   // it needs its key
  await key.fill('rp-test-0123456789');
  await form.getByRole('button', { name: 'Add RunPod' }).click();
  const runpod = cloud.getByRole('listitem', { name: 'RunPod', exact: true });
  await expect(runpod).toBeVisible();
  await expect(form).toHaveCount(0);
  await expect(runpod.getByRole('listitem', { name: 'RunPod key' })).toContainText('Saved in the keychain');
  expect(await page.content()).not.toContain('rp-test-0123456789');
  await toExtract(page);
  await expect(menu.getByRole('option', { name: /^Cloud GPU \(RunPod\)/ })).toHaveCount(1);
  await settingsAt(page, /^Compute$/);
  await cloud.getByRole('button', { name: 'Remove RunPod' }).click();
  await expect(runpod).toHaveCount(0);
  await cloud.getByRole('button', { name: 'Add provider…' }).click();
  await expect(form.getByRole('textbox', { name: 'RunPod API key' })).toBeVisible();   // its key went with it
  await form.getByRole('button', { name: 'Cancel' }).click();
  await toExtract(page);
  await expect(menu.getByRole('option', { name: /RunPod/ })).toHaveCount(0);
});

test('a RunPod key that RunPod refuses is said why and not kept: nothing is added, and the form asks for a key again', async ({ page }) => {
  await page.goto('/?pipeline-demo=remote');
  const settings = await settingsAt(page, /^Compute$/);
  const cloud = settings.getByRole('region', { name: 'Cloud GPU' });
  await cloud.getByRole('button', { name: 'Add provider…' }).click();
  const form = cloud.getByRole('form', { name: 'Add a cloud GPU provider' });
  await form.getByRole('textbox', { name: 'RunPod API key' }).fill('rejected-0123456789');
  await form.getByRole('button', { name: 'Add RunPod' }).click();
  await expect(cloud.getByText(/RunPod did not accept the key/)).toBeVisible();
  await expect(cloud.getByRole('listitem', { name: 'RunPod', exact: true })).toHaveCount(0);
  await expect(form.getByRole('textbox', { name: 'RunPod API key' })).toBeVisible();   // the refused key is not in the keychain
  await expect(cloud.getByRole('listitem', { name: 'RunPod key' })).toHaveCount(0);
});

test('a key saved in the keychain always has a row, where it can be removed, even when nothing uses it now', async ({ page }) => {
  await page.goto('/?pipeline-demo=hf-stored');   // a Hugging Face key from 0.0.2; no step uses a gated model
  const settings = await settingsAt(page, /^Models$/);
  const unused = settings.getByRole('region', { name: 'Keys no step uses' });
  const hf = unused.getByRole('listitem', { name: 'Hugging Face key' });
  await expect(hf).toContainText('Saved in the keychain');
  await hf.getByRole('button', { name: 'Remove the Hugging Face key' }).click();
  await expect(unused).toHaveCount(0);
});

test('a key saved earlier has a row even when the pipeline cannot list its steps, so it can be removed', async ({ page }) => {
  await page.goto('/?pipeline-demo=old-cli-hf');   // a Hugging Face key from 0.0.2, and a pipeline before steps were listed
  const settings = await settingsAt(page, /^Models$/);
  const hf = settings.getByRole('listitem', { name: 'Hugging Face key' });
  await expect(hf).toContainText('Saved in the keychain');
  await hf.getByRole('button', { name: 'Remove the Hugging Face key' }).click();
  await expect(hf).toHaveCount(0);
});

test('changing the captions default in Settings changes what Extract plans next, even after it planned with the old one', async ({ page }) => {
  await page.goto('/?pipeline-demo');
  let settings = await settingsAt(page, /^Models$/);
  await settings.getByRole('combobox', { name: 'Shot captions: model' }).selectOption('claude-opus-5-5');
  await toExtract(page);
  const extract = page.getByRole('region', { name: 'Extract' });
  await extract.getByRole('button', { name: 'Choose a video…' }).click();
  await extract.getByRole('checkbox', { name: 'Run Shot captions' }).check();
  const captions = extract.getByRole('listitem', { name: 'captions' });
  await expect(captions).toContainText('$6.24');                                          // Opus
  settings = await settingsAt(page, /^Models$/);
  await settings.getByRole('combobox', { name: 'Shot captions: model' }).selectOption('claude-haiku-5-5');
  await toExtract(page);
  await expect(captions).toContainText('$0.16');                                          // Haiku: the new default, not the old one kept
  await extract.getByRole('button', { name: 'Start run' }).click();
  const runs = await page.evaluate(() => (window as unknown as { __pipelineRuns: { settings: Record<string, Record<string, string>> }[] }).__pipelineRuns);
  expect(runs.at(-1)!.settings.captions?.model ?? 'claude-haiku-5-5').toBe('claude-haiku-5-5');
});

test('a default the pipeline no longer offers is not shown as chosen: the step shows its own default', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hyperstudy-annotator:step-defaults',
    JSON.stringify({ 'vlm.shot-captions@1.0.0': { model: 'claude-sonnet-4' } })));   // a model an update took away
  await page.goto('/?pipeline-demo');
  const settings = await settingsAt(page, /^Models$/);
  await expect(settings.getByRole('combobox', { name: 'Shot captions: model' })).toHaveValue('claude-haiku-5-5');
  await expect(settings.getByRole('listitem', { name: 'Shot captions' })).toContainText('Claude Haiku 5.5');
});

test("RunPod's Test result goes when its key is replaced, or RunPod is removed and added again", async ({ page }) => {
  await page.goto('/?pipeline-demo=remote');
  const settings = await settingsAt(page, /^Compute$/);
  const cloud = settings.getByRole('region', { name: 'Cloud GPU' });
  const add = async (key: string) => {
    await cloud.getByRole('button', { name: 'Add provider…' }).click();
    const form = cloud.getByRole('form', { name: 'Add a cloud GPU provider' });
    await form.getByRole('textbox', { name: 'RunPod API key' }).fill(key);
    await form.getByRole('button', { name: 'Add RunPod' }).click();
  };
  await add('rp-good');
  const runpod = cloud.getByRole('listitem', { name: 'RunPod', exact: true });
  await runpod.getByRole('button', { name: 'Test the RunPod key' }).click();
  const said = runpod.getByRole('status').filter({ hasText: 'accepted' });
  await expect(said).toHaveText('✓ RunPod accepted the key.');
  await runpod.getByRole('button', { name: 'Replace the RunPod key' }).click();
  await runpod.getByRole('textbox', { name: 'RunPod key' }).fill('rp-other');
  await runpod.getByRole('button', { name: 'Save' }).click();
  await expect(said).toHaveCount(0);                                                     // said of the key before
  await runpod.getByRole('button', { name: 'Test the RunPod key' }).click();
  await expect(said).toHaveCount(1);
  await cloud.getByRole('button', { name: 'Remove RunPod' }).click();
  await add('rp-good');
  await expect(said).toHaveCount(0);                                                     // said of the RunPod removed
});

test("RunPod's key cannot be replaced while its Test is running, so an answer is never the new key's", async ({ page }) => {
  await page.goto('/?pipeline-demo=remote');
  const settings = await settingsAt(page, /^Compute$/);
  const cloud = settings.getByRole('region', { name: 'Cloud GPU' });
  await cloud.getByRole('button', { name: 'Add provider…' }).click();
  await cloud.getByRole('textbox', { name: 'RunPod API key' }).fill('rp-good');
  await cloud.getByRole('button', { name: 'Add RunPod' }).click();
  const runpod = cloud.getByRole('listitem', { name: 'RunPod', exact: true });
  await page.evaluate(() => { const w = window as unknown as { __holdCheck?: Promise<void>; release?: () => void };
    w.__holdCheck = new Promise((r) => { w.release = r; }); });
  await runpod.getByRole('button', { name: 'Test the RunPod key' }).click();           // its answer, held back
  await expect(runpod.getByText('Testing the RunPod key…')).toBeVisible();
  await expect(runpod.getByRole('button', { name: 'Replace the RunPod key' })).toBeDisabled();
  await page.evaluate(() => (window as unknown as { release: () => void }).release());
  await expect(runpod.getByRole('status').filter({ hasText: 'accepted' })).toHaveText('✓ RunPod accepted the key.');
});

test("testing AWS keeps its answer when RunPod's key changes", async ({ page }) => {
  await page.goto('/?pipeline-demo=remote');                                         // AWS is on here
  const settings = await settingsAt(page, /^Compute$/);
  const cloud = settings.getByRole('region', { name: 'Cloud GPU' });
  const aws = cloud.getByRole('listitem', { name: 'AWS', exact: true });
  await aws.getByRole('button', { name: 'Test AWS' }).click();
  await expect(aws.locator('p.tested')).toHaveText('✓ AWS can be used.');
  await cloud.getByRole('button', { name: 'Add provider…' }).click();
  await cloud.getByRole('textbox', { name: 'RunPod API key' }).fill('rp-good');
  await cloud.getByRole('button', { name: 'Add RunPod' }).click();
  await expect(aws.locator('p.tested')).toHaveText('✓ AWS can be used.');
});

test("a Test that fails leaves no earlier ✓ beside its error", async ({ page }) => {
  await page.goto('/?pipeline-demo=remote');
  const settings = await settingsAt(page, /^Compute$/);
  const aws = settings.getByRole('region', { name: 'Cloud GPU' }).getByRole('listitem', { name: 'AWS', exact: true });
  await aws.getByRole('button', { name: 'Test AWS' }).click();
  await expect(aws.locator('p.tested')).toHaveText('✓ AWS can be used.');
  await page.evaluate(() => { (window as unknown as { __holdCheck?: Promise<void> }).__holdCheck = Promise.reject(new Error('the pipeline failed: network is unreachable')); });
  await aws.getByRole('button', { name: 'Test AWS' }).click();
  await expect(settings.getByText(/network is unreachable/)).toBeVisible();
  await expect(aws.locator('p.tested')).toHaveCount(0);
});
