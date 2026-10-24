// Browser tests of layout and pointer behaviour that unit tests cannot reach (they need a real layout engine).
// They run against the Vite dev server (npm run dev) and the bake-off data proxied at /devdata, in the installed Google
// Chrome. Tests that need the bake-off data skip themselves when it is not served (CI).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:1420', channel: 'chrome', headless: true, viewport: { width: 1440, height: 900 } },
  // started for the run (CI) unless one is already running (local work)
  webServer: { command: 'npm run dev', url: 'http://localhost:1420', reuseExistingServer: true, timeout: 60_000 },
});
