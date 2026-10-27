// Browser tests of layout and pointer behaviour that unit tests cannot reach (they need a real layout engine).
// They run against the Vite dev server (npm run dev) and the bake-off data proxied at /devdata, in the installed Google
// Chrome and in WebKit, the desktop app's engine (macOS's WKWebView), which differs where it matters: it does not blur
// a focused field it removes, its Tab skips buttons, and it takes Backspace as Back (npx playwright install webkit).
// `--project chrome` or `--project webkit` runs one. Tests that need the bake-off data skip themselves when it is not
// served (CI).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:1420', headless: true, viewport: { width: 1440, height: 900 } },
  projects: [{ name: 'chrome', use: { channel: 'chrome' } }, { name: 'webkit', use: { browserName: 'webkit' } }],
  // started for the run (CI) unless one is already running (local work)
  webServer: { command: 'npm run dev', url: 'http://localhost:1420', reuseExistingServer: true, timeout: 60_000 },
});
