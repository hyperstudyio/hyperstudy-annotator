// The release workflows can only really run from a v*.*.* tag (the signing secrets are in the `release` environment),
// so their secret wiring is checked here instead, on every pull request. A reusable workflow gets an environment's
// secret only if (1) it declares the secret under on.workflow_call.secrets, (2) its caller passes it by name, and (3)
// the job reading it sets `environment: release`. Otherwise the secret is an empty string, with no error: that is how
// the first v0.0.1 run failed.
import { readFileSync } from 'node:fs';
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

test('the macOS build reads all six signing secrets', () => {
  const read = new Set(secretsRead(load('release-macos.yml').jobs.build.steps));
  expect([...read].sort()).toEqual(
    ['APPLE_API_ISSUER', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_SIGNING_IDENTITY'],
  );
});
