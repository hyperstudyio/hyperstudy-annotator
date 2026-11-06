# @hyperstudyio/annotator

The HyperStudy Annotator's editor, as a Svelte 5 package: view a perception bundle's tracks over its video, correct
them (who a face is, who speaks, what was said), and annotate the video on its timeline. The desktop app
(this repository's root) and HyperStudy both use it.

The editor sees a bundle only through a `BundleSource`: where the manifest, layers and assets come from, the video's
URL, and the `CorrectionStore` that keeps the edits (an append-only op log, `perception-corrections/3`). Each app
supplies its own; `httpSource` (a bundle served over HTTP, edits in localStorage) is the reference.

```svelte
<script>
  import { Viewer, httpSource } from '@hyperstudyio/annotator';
  const source = httpSource('/bundles/clip1', '/videos/clip1.mp4');
</script>

<div style="height: 100vh">
  {#await source then source}<Viewer {source} openExternal={(url) => window.open(url, '_blank', 'noopener')} />{/await}
</div>
```

- **Size.** The viewer fills its parent's height; give it a sized container.
- **Look.** `annotator.css` (imported by the workspace) is scoped to `.hs-annotator`, which the editor's root and the
  panels it opens on the page's body carry; nothing outside them is restyled. Its colours are custom properties on
  that root, so a host can override them there.
- **Links out.** A model's page opens through `openExternal`, a new tab by default, and only on the hosts in `OPENABLE`.

Requires `svelte` ^5.53. Built with `npm run package` (svelte-package, then publint); the desktop app reads the
source directly (a Vite alias), so an edit here is live in the app at once.
