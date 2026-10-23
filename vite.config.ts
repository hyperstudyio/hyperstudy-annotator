import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Tauri expects a fixed port and ignores the Rust side in the watcher.
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] },
    // Browser-mode testing: /devdata/* is served by a local http-server on 8766 (bundles and videos stay outside
    // the repo; see README). Same origin, so no CORS setup is needed.
    proxy: { '/devdata': { target: 'http://127.0.0.1:8766', rewrite: (p) => p.replace(/^\/devdata/, '') } },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: { target: 'safari16', sourcemap: !!process.env.TAURI_ENV_DEBUG },
  test: { include: ['src/**/*.test.ts'] },
});
