# @hyperstudyio/annotator

The HyperStudy Annotator's editor, as a Svelte 5 package: view a perception bundle's tracks over its video, correct
them (who a face is, who speaks, what was said), and annotate the video on its timeline. The desktop app
(this repository's root) and HyperStudy both use it.

The editor sees a bundle only through a `BundleSource`: where the manifest, layers and assets come from, the video's
URL, and the `CorrectionStore` that keeps the edits (an append-only op log, `perception-corrections/3`). Each app
supplies its own; `httpSource` (a bundle served over HTTP, edits in localStorage) is the reference. A bundle can come
from anyone, so a source checks every path it names (layers, side files, assets) with `bundlePath` before fetching
it, as `httpSource` does: plain relative segments only, as the desktop app's `bundle::safe_path` allows.

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
  panels it opens on the page's body carry; nothing outside them is restyled.
- **The host's CSS.** The root rule weighs one class, so a host's `*` or bare element rules cannot undo it; the rules
  inside weigh what bare element rules do (`:where()`), so the editor's components always win over them. A host's
  own rule for a bare element (`button { … }`) therefore ties with the editor's and wins if it loads later: keep such
  rules out of `.hs-annotator` (`:not(.hs-annotator *)`, or scope them to the host's own containers). HyperStudy's
  global rules that match the editor's elements (`* { box-sizing: inherit }`, `h1`) are covered by a test; its `a`
  rule matches nothing here, as the editor has no links.
- **Theme.** The colours are custom properties set on `.hs-annotator`. Override them on `.hs-annotator` itself
  (`.hs-annotator { --color-primary: … }`), not under an ancestor of the viewer: the panels it opens are on the page's
  body, outside that ancestor, and would keep the defaults. One theme per page.
- **Links out.** A model's page opens through `openExternal`, a new tab by default, and only on the hosts in `OPENABLE`.

Requires `svelte` ^5.53. Built with `npm run package` (svelte-package, then publint); the desktop app reads the
source directly (a Vite alias), so an edit here is live in the app at once.
