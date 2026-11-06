<script>
  // What an embedding app uses: the viewer on a source, a panel, the stores and the format helpers.
  import { Viewer, Workspace, Popover, httpSource, LocalCorrectionStore, fold, live, annotated, LICENCE_TEXT, OPENABLE } from '@hyperstudyio/annotator';

  const source = httpSource('/bundle', null);
  const used = [Workspace, Popover, LocalCorrectionStore, fold, live, annotated, LICENCE_TEXT, OPENABLE];
</script>

{#await source then s}<Viewer source={s} />{/await}
<p hidden>{used.length}</p>
