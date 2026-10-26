// The release workflows can only really run from a v*.*.* tag (the signing secrets are in the `release` environment),
// so their secret wiring is checked here instead, on every pull request. A reusable workflow gets an environment's
// secret only if (1) it declares the secret under on.workflow_call.secrets, (2) its caller passes it by name, and (3)
// the job reading it sets `environment: release`. Otherwise the secret is an empty string, with no error: that is how
// the first v0.0.1 run failed.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parse } from 'yaml';

type Job = { uses?: string; environment?: string; secrets?: 'inherit' | Record<string, string>; steps?: unknown[] };
type Workflow = { on: Record<string, { secrets?: Record<string, unknown> } | null>; jobs: Record<string, Job> };

const load = (name: string) => parse(readFileSync(`.github/workflows/${name}`, 'utf8')) as Workflow;
const secretsRead = (x: unknown) => [...JSON.stringify(x).matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);

const release = load('release.yml');
const called = Object.values(release.jobs).filter((j) => j.uses?.startsWith('./.github/workflows/'));

test('release.yml calls the macOS and Linux build workflows', () => {
  expect(called.map((j) => j.uses).sort()).toEqual(['./.github/workflows/release-linux.yml', './.github/workflows/release-macos.yml']);
});

test.each(called.map((j) => [j.uses!.split('/').pop()!, j] as const))(
  '%s gets every secret it reads: declared, passed by name, and in a job of the release environment',
  (file, caller) => {
    const wf = load(file);
    const declared = Object.keys(wf.on.workflow_call?.secrets ?? {});
    const passed = caller.secrets === undefined ? [] : caller.secrets === 'inherit' ? declared : Object.keys(caller.secrets);
    for (const [name, job] of Object.entries(wf.jobs)) {
      for (const s of secretsRead(job.steps ?? [])) {
        expect(declared, `${file}: job ${name} reads ${s}, not declared under on.workflow_call.secrets`).toContain(s);
        expect(passed, `release.yml does not pass ${s} to ${file}`).toContain(s);
        expect(job.environment, `${file}: job ${name} reads ${s} but does not set environment: release`).toBe('release');
      }
    }
    expect(caller.secrets, 'secrets: inherit would hand every repository secret to the build').not.toBe('inherit');
  },
);

const UPDATER = ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD'];

test('the macOS build reads all six signing secrets, and the updater key', () => {
  const read = new Set(secretsRead(load('release-macos.yml').jobs.build.steps));
  expect([...read].sort()).toEqual(
    ['APPLE_API_ISSUER', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_SIGNING_IDENTITY', ...UPDATER],
  );
});

test('the Linux build reads the updater key, and nothing else', () => {
  expect([...new Set(secretsRead(load('release-linux.yml').jobs.build.steps))].sort()).toEqual(UPDATER);
});

// The updater's manifest is written after both builds, from the signatures they attached. Its script is run here on
// stand-in signatures: an installed copy with no entry for its platform, or a URL that is not the file attached, never
// gets the update.
test('latest.json is made after both builds, for the Mac, a .deb install and an AppImage', () => {
  const job = release.jobs.updater as Job & { needs: string[]; steps: { name: string; run: string }[] };
  expect(job.needs).toEqual(expect.arrayContaining(['macos', 'linux']));
  expect(secretsRead(job.steps), 'it needs no secret: the signatures are on the release already').toEqual([]);
  const dir = mkdtempSync(join(tmpdir(), 'latest-json-'));
  const files = ['aarch64-apple-darwin.app.tar.gz', 'x86_64-unknown-linux-gnu.deb', 'x86_64-unknown-linux-gnu.AppImage'];
  mkdirSync(join(dir, 'sigs'));
  for (const f of files) writeFileSync(join(dir, 'sigs', `HyperStudy-Annotator-v1.2.3-${f}.sig`), `sig of ${f}\n`);
  execFileSync('bash', ['-c', job.steps.find((s) => s.name === 'Write latest.json')!.run],
    { cwd: dir, env: { ...process.env, TAG: 'v1.2.3', GITHUB_REPOSITORY: 'hyperstudyio/hyperstudy-annotator' }, stdio: 'pipe' });
  const manifest = JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'));
  expect(manifest.version).toBe('1.2.3');
  const base = 'https://github.com/hyperstudyio/hyperstudy-annotator/releases/download/v1.2.3/HyperStudy-Annotator-v1.2.3-';
  expect(manifest.platforms).toEqual({
    'darwin-aarch64': { signature: `sig of ${files[0]}`, url: base + files[0] },
    'linux-x86_64-deb': { signature: `sig of ${files[1]}`, url: base + files[1] },
    'linux-x86_64': { signature: `sig of ${files[2]}`, url: base + files[2] },
  });
});

// The app checks this repository's latest release: the endpoint must name it, and every download must be signed.
test('the app looks for updates on this repository\'s releases', () => {
  const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  expect(conf.plugins.updater.endpoints).toEqual(['https://github.com/hyperstudyio/hyperstudy-annotator/releases/latest/download/latest.json']);
  expect(conf.bundle.createUpdaterArtifacts, 'only the release build makes updater artifacts: it alone has the key').toBeFalsy();
});

// The updater's public key: an app built without the real one could never install an update, and a key swapped by
// mistake would strand every installed copy (they accept only updates signed with the key they were built with).
test('the app carries the release key\'s public half', () => {
  const pubkey: string = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).plugins.updater.pubkey;
  expect(Buffer.from(pubkey, 'base64').toString('utf8').split('\n')[0]).toBe('untrusted comment: minisign public key: 61C9048AB724D58E');
});
