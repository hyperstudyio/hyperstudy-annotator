import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// svelte-package strips the components' TypeScript through this; the published .svelte files are plain JavaScript.
export default { preprocess: vitePreprocess() };
