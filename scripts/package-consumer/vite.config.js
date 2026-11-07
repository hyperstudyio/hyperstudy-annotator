// As HyperStudy's frontend/vite.config.js sets Svelte up: runes forced for the app's own files only, so a package
// in node_modules compiles with Svelte's default (runes inferred per file), as the published editor will there.
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ dynamicCompileOptions({ filename }) { if (!filename.includes('node_modules')) return { runes: true }; } })],
});
