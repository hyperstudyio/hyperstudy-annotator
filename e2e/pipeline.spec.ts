// The Extract page (run the pipeline), and the rail that reaches it, against browser mode's scripted stand-in (?pipeline-demo): Tauri is absent here, and the
// real path is tested in Rust against the real CLI.
import { expect, test, type Page } from '@playwright/test';

/** The Extract page with a pipeline folder and a video chosen, and its plan on screen: the full graph's features, or (a
 *  pipeline folder with no full graph) mvp-captions.yaml. */
async function planned(page: Page, url: string) {
  await page.goto(url);
  const dialog = page.getByRole('region', { name: 'Extract' });
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
  const rail = page.getByRole('navigation', { name: 'App' });
  await expect(rail.getByRole('button', { name: 'Extract' })).toHaveAttribute('aria-current', 'page');
  await extract.getByRole('button', { name: 'Start run' }).click();
  await rail.getByRole('button', { name: 'Settings' }).click();
  await expect(extract).toBeHidden();
  const settings = page.getByRole('region', { name: 'Settings' });
  await expect(settings.getByRole('heading', { name: 'API keys' })).toBeVisible();
  await expect(settings.getByRole('heading', { name: 'Lab servers' })).toBeVisible();
  await rail.getByRole('button', { name: 'Annotator' }).click();
  await expect(page.getByRole('heading', { name: 'Annotator' })).toBeVisible();
  await rail.getByRole('button', { name: 'Extract' }).click();
  await expect(extract.getByRole('heading', { name: /^Finished all/ })).toBeVisible();   // it ran while hidden
  await expect(extract.getByRole('button', { name: 'Open in Annotator' })).toBeVisible();
  await extract.getByRole('button', { name: 'New run' }).click();
  await expect(extract.getByText('None chosen')).toBeVisible();
});

test('a lab server added in Settings is offered on Extract when you go back to it', async ({ page }) => {
  const extract = await planned(page, '/?pipeline-demo');
  const rail = page.getByRole('navigation', { name: 'App' });
  await expect(extract.getByText('This Mac', { exact: true })).toBeVisible();
  await rail.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('region', { name: 'Settings' });
  const add = settings.getByRole('form', { name: 'Add a lab server' });
  await add.getByLabel('Name').fill('gpu9');
  await add.getByLabel('SSH destination').fill('you@gpu9.example.edu');
  await add.getByRole('button', { name: 'Add' }).click();
  await expect(settings.getByRole('listitem', { name: 'gpu9' })).toBeVisible();
  await rail.getByRole('button', { name: 'Extract' }).click();
  await expect(extract.getByText('This Mac, gpu9 (SSH)')).toBeVisible();
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
  await dialog.getByRole('button', { name: 'Change…' }).nth(1).click();      // the video
  await expect(dialog.getByRole('heading', { name: /steps? to run/ })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Run Shot captions' })).not.toBeChecked();
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

// --- managing the other machines from the app ------------------------------------------------------------------------

test('the machines steps can run on are listed, and adding a lab server adds its place to the step menus', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  await expect(dialog.getByText('This Mac, lab (SSH), Cloud GPU')).toBeVisible();
  await dialog.getByRole('button', { name: 'Manage machines' }).click();
  const machines = dialog.getByRole('region', { name: 'Machines' });
  await expect(machines.getByRole('listitem', { name: 'lab' })).toContainText('Linux, 32 cores, 252 GB, NVIDIA GPU (48 GB)');
  await machines.getByLabel('Name').fill('gpu2');
  await machines.getByLabel('SSH destination').fill('you@gpu2.example.edu');
  await machines.getByRole('button', { name: 'Add' }).click();
  await expect(machines.getByRole('listitem', { name: 'gpu2' })).toBeVisible();
  await expect(dialog.getByText('This Mac, lab (SSH), gpu2 (SSH), Cloud GPU')).toBeVisible();
  const menu = dialog.getByRole('listitem', { name: 'faces' }).getByRole('combobox', { name: 'Where faces runs' });
  await expect(menu.getByRole('option', { name: /NVIDIA GPU on gpu2 \(SSH\)/ })).toHaveCount(1);
  await expect(machines.getByLabel('Name')).toHaveValue('');          // the form is ready for the next one
});

test('removing a lab server or turning the cloud off takes its place out of the menus', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  await dialog.getByRole('button', { name: 'Manage machines' }).click();
  const machines = dialog.getByRole('region', { name: 'Machines' });
  const menu = dialog.getByRole('listitem', { name: 'faces' }).getByRole('combobox', { name: 'Where faces runs' });
  await machines.getByRole('listitem', { name: 'lab' }).getByRole('button', { name: 'Remove' }).click();
  await expect(menu.getByRole('option', { name: /on lab/ })).toHaveCount(0);
  await expect(machines.getByText(/^On: AWS g6\.2xlarge, NVIDIA L4, \$0\.98 an hour/)).toBeVisible();
  await machines.getByRole('button', { name: 'Turn off' }).click();
  await expect(menu.getByRole('option', { name: /Cloud GPU/ })).toHaveCount(0);
  await expect(dialog.getByText('This Mac', { exact: true })).toBeVisible();
  await expect(machines.getByRole('button', { name: 'Turn on' })).toBeVisible();
});

test('a step on a lab server that is then removed goes back to this machine, and nothing is agreed for it', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const menu = dialog.getByRole('listitem', { name: 'faces' }).getByRole('combobox', { name: 'Where faces runs' });
  await menu.selectOption('ssh-lab:cuda');
  await expect(menu).toHaveValue('ssh-lab:cuda');
  await dialog.getByRole('button', { name: 'Manage machines' }).click();
  const machines = dialog.getByRole('region', { name: 'Machines' });
  await machines.getByRole('listitem', { name: 'lab' }).getByRole('button', { name: 'Remove' }).click();
  await expect(menu).toHaveValue('native:mps');
  // added again under the same name (perhaps another machine): choosing it is a new choice, not the old one
  await machines.getByLabel('Name').fill('lab');
  await machines.getByLabel('SSH destination').fill('you@another-lab.example.edu');
  await machines.getByRole('button', { name: 'Add' }).click();
  await expect(machines.getByRole('listitem', { name: 'lab' })).toBeVisible();
  await expect(menu).toHaveValue('native:mps');
  await dialog.getByRole('button', { name: 'Start run' }).click();
  const [ran] = await runs(page);
  expect(ran.places).toEqual({});
  expect(ran.allow.uploads).toEqual({});
});

test('a lab server name already listed cannot be added over: another machine under that name is a new choice', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  await dialog.getByRole('button', { name: 'Manage machines' }).click();
  const machines = dialog.getByRole('region', { name: 'Machines' });
  await machines.getByLabel('Name').fill('lab');
  await machines.getByLabel('SSH destination').fill('you@another-lab.example.edu');
  await expect(machines.getByRole('button', { name: 'Add' })).toBeDisabled();
  await expect(machines.getByText(/lab is already a lab server here: remove it first/)).toBeVisible();
});

test('a step on a lab server whose name now leads to another machine goes back to this machine', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const menu = dialog.getByRole('listitem', { name: 'faces' }).getByRole('combobox', { name: 'Where faces runs' });
  await menu.selectOption('ssh-lab:cuda');
  await expect(menu).toHaveValue('ssh-lab:cuda');
  await page.evaluate(() => { (globalThis as { __readdedElsewhere?: boolean }).__readdedElsewhere = true; });   // re-added with the CLI
  await dialog.getByRole('button', { name: 'Manage machines' }).click();
  const machines = dialog.getByRole('region', { name: 'Machines' });
  await machines.getByRole('listitem', { name: 'lab' }).getByRole('button', { name: 'Check' }).click();
  await expect(machines.getByRole('listitem', { name: 'lab' })).toContainText('you@another-lab.example.edu');
  await expect(menu).toHaveValue('native:mps');                      // the name is the same; the machine is not
  await dialog.getByRole('button', { name: 'Start run' }).click();
  const [ran] = await runs(page);
  expect(ran.places).toEqual({});
  expect(ran.allow.uploads).toEqual({});
});

test('a run cannot start while a machine is being cleaned or removed', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  await dialog.getByRole('listitem', { name: 'faces' }).getByRole('combobox', { name: 'Where faces runs' }).selectOption('ssh-lab:cuda');
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
  await page.evaluate(() => { const g = globalThis as { __holdHost?: Promise<void>; __release?: () => void };
    g.__holdHost = new Promise((r) => { g.__release = r; }); });
  await dialog.getByRole('button', { name: 'Manage machines' }).click();
  await dialog.getByRole('button', { name: 'Clean lab' }).click();
  await expect(dialog.getByText('Cleaning lab…')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeDisabled();
  await page.evaluate(() => (globalThis as { __release?: () => void }).__release!());
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
});

test('a step on a lab server found without its GPU goes back to this machine', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  const menu = dialog.getByRole('listitem', { name: 'faces' }).getByRole('combobox', { name: 'Where faces runs' });
  await menu.selectOption('ssh-lab:cuda');
  await page.evaluate(() => { (globalThis as { __gpuGone?: boolean }).__gpuGone = true; });
  await dialog.getByRole('button', { name: 'Manage machines' }).click();
  await dialog.getByRole('button', { name: 'Check lab' }).click();
  await expect(dialog.getByRole('listitem', { name: 'lab' })).toContainText('no GPU');
  await expect(menu).toHaveValue('native:mps');                      // the plan still stands, on this machine
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
});

test('a lab server that cannot be reached is not added, and says why', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=remote');
  await dialog.getByRole('button', { name: 'Manage machines' }).click();
  const machines = dialog.getByRole('region', { name: 'Machines' });
  await machines.getByLabel('Name').fill('far');
  await machines.getByLabel('SSH destination').fill('you@unreachable.example.edu');
  await machines.getByRole('button', { name: 'Add' }).click();
  await expect(machines.getByText(/could not reach you@unreachable\.example\.edu/)).toBeVisible();
  await expect(machines.getByRole('listitem', { name: 'far' })).toHaveCount(0);
  await expect(machines.getByLabel('Name')).toHaveValue('far');       // kept, to correct
});

test('a pipeline from before other machines says so and offers nothing to manage', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=old-cli');
  await expect(dialog.getByText(/This machine only \(this pipeline cannot run steps elsewhere/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Manage machines' })).toHaveCount(0);
});

test('a failure listing the machines is said as it is, not taken for an older pipeline', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=machines-error');
  await expect(dialog.getByText(/PermissionError: hosts\.json/)).toBeVisible();
  await expect(dialog.getByText(/cannot run steps elsewhere/)).toHaveCount(0);
});

test('lab servers are offered by a pipeline that cannot start cloud machines yet', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=no-cloud');
  await expect(dialog.getByText('This Mac', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Manage machines' }).click();
  await expect(dialog.getByText(/cannot start cloud machines yet/)).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Machines' }).getByLabel('SSH destination')).toBeVisible();
});

test('in a narrow window the machines fit without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  const dialog = await planned(page, '/?pipeline-demo=remote');
  await dialog.getByRole('button', { name: 'Manage machines' }).click();
  const machines = dialog.getByRole('region', { name: 'Machines' });
  await machines.getByLabel('Name').fill('gpu17');
  await machines.getByLabel('SSH destination').fill('firstname.lastname@gpu-node-17.psych.example.edu');   // a long one
  await machines.getByRole('button', { name: 'Add' }).click();
  await expect(machines.getByRole('listitem', { name: 'gpu17' })).toBeVisible();
  const overflow = await dialog.evaluate((d) => d.scrollWidth - d.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});


test('a key is saved to the keychain from the dialog, leaves the page at once, and can be removed', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  await expect(dialog.getByText('Set: Hugging Face. Not set: RunPod, Anthropic')).toBeVisible();   // HF from a file the CLI reads
  await dialog.getByRole('button', { name: 'Manage keys' }).click();
  const keys = dialog.getByRole('region', { name: 'Keys' });
  await expect(keys.getByRole('listitem', { name: 'Hugging Face' })).toContainText('Found in ~/.config/hyperstudy/bakeoff.env');
  const runpod = keys.getByRole('listitem', { name: 'RunPod' });
  await expect(runpod).toContainText('Not set. Make one at https://console.runpod.io/user/settings');
  const field = runpod.getByRole('textbox', { name: 'RunPod key' });
  await expect(field).toHaveAttribute('type', 'password');
  await field.fill('rp-test-0123456789');
  await runpod.getByRole('button', { name: 'Save' }).click();
  await expect(runpod).toContainText('Stored in the keychain');
  await expect(field).toHaveValue('');                                                   // not kept in the page
  expect(await page.content()).not.toContain('rp-test-0123456789');
  await expect(dialog.getByText('Set: RunPod, Hugging Face. Not set: Anthropic')).toBeVisible();
  await runpod.getByRole('button', { name: 'Remove the RunPod key' }).click();
  await expect(runpod).toContainText('Not set');
});


test('a failure listing the pipeline\'s keys is said as it is, not taken for an older pipeline', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=keys-error');
  await expect(dialog.getByText(/the pipeline's keys: .*PermissionError: keys.json/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Manage keys' })).toBeVisible();   // the app's own keys still work
});

test('a pipeline from before `perception keys` has the app\'s keys and says nothing is wrong', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo=old-cli');
  await expect(dialog.getByText('Not set: RunPod, Anthropic, Hugging Face')).toBeVisible();
  await expect(dialog.getByText(/the pipeline's keys/)).toHaveCount(0);
});


test('a run cannot start while a key is being saved', async ({ page }) => {
  const dialog = await planned(page, '/?pipeline-demo');
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
  await page.evaluate(() => { const g = globalThis as { __holdKey?: Promise<void>; __releaseKey?: () => void };
    g.__holdKey = new Promise((r) => { g.__releaseKey = r; }); });
  await dialog.getByRole('button', { name: 'Manage keys' }).click();
  const runpod = dialog.getByRole('region', { name: 'Keys' }).getByRole('listitem', { name: 'RunPod' });
  await runpod.getByRole('textbox', { name: 'RunPod key' }).fill('rp-test-0123456789');
  await runpod.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Saving the RunPod key…')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeDisabled();   // a run now would race the key
  await page.evaluate(() => (globalThis as { __releaseKey?: () => void }).__releaseKey!());
  await expect(runpod).toContainText('Stored in the keychain');
  await expect(dialog.getByRole('button', { name: 'Start run' })).toBeEnabled();
});
