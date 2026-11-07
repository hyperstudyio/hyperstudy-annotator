import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

// The editor is the workspace package packages/annotator, read from its source here, so an edit there is live in the
// app at once; HyperStudy uses the published build (npm run package).
const annotator = fileURLToPath(new URL('./packages/annotator/src/lib', import.meta.url));

// Tauri expects a fixed port and ignores the Rust side in the watcher.
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: [
      { find: /^@hyperstudyio\/annotator$/, replacement: `${annotator}/index.ts` },
      { find: /^@hyperstudyio\/annotator\/(.*)$/, replacement: `${annotator}/$1` },
    ],
  },
  clearScreen: false,
  server: {
    port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] },
    // Browser-mode testing: /devdata/* is served by a local http-server on 8766 (bundles and videos stay outside
    // the repo; see README). Same origin, so no CORS setup is needed.
    proxy: { '/devdata': { target: 'http://127.0.0.1:8766', rewrite: (p) => p.replace(/^\/devdata/, '') } },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: { target: 'safari16', sourcemap: !!process.env.TAURI_ENV_DEBUG },
  test: { include: ['src/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'scripts/**/*.test.ts'] },
});
