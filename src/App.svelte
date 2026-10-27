<script lang="ts">
  // The app: the rail, and its pages. Extract runs the pipeline on a video; Annotator is the library, then a bundle in
  // the viewer; Settings holds the pipeline's keys and machines. A page, once shown, stays mounted while another is on
  // screen (hidden, told it is not `active`), so a run goes on and an open bundle keeps its place.
  // In a browser (development and testing): ?bundle=<URL of a bundle folder>&video=<URL of its video> opens that
  // bundle straight in the viewer; vite serves /devdata from a local http-server (see README). &previous=<URL of an
  // earlier bundle of the same video> opens it as a re-run, offering the earlier bundle's corrections. ?pipeline-demo
  // opens Extract (and Settings) against a scripted stand-in for the pipeline, and ?update-demo=<available|current|
  // offline|bad-download> the app's updates against one for the releases (updates.fake.ts).
  import Rail, { type Page, type RunStatus, type UpdateBadge } from './lib/components/Rail.svelte';
  import Annotator from './lib/components/Annotator.svelte';
  import Viewer from './lib/components/Viewer.svelte';
  import Settings, { type SettingsSection } from './lib/components/Settings.svelte';
  import { httpSource, inTauri, type BundleSource } from './lib/source';
  import PipelineDialog from './lib/components/PipelineDialog.svelte';
  import { tauriPipeline, type PipelineApi, type SetupStatus } from './lib/pipeline';
  import { tauriUpdater, Updates } from './lib/updates.svelte';
  import { tauriLibrary, type LibraryApi } from './lib/library';

  let source = $state<BundleSource | null>(null);
  let error = $state<string | null>(null);
  const desktop = inTauri();
  // the pipeline: the app's, or in browser mode's ?pipeline-demo a scripted stand-in (Tauri is absent there)
  let pipeline = $state<PipelineApi | null>(null);
  // the library of bundles: the app's, or in browser mode's ?library-demo a scripted one (=empty: none yet)
  let library = $state<LibraryApi | null>(null);
  const q = new URLSearchParams(location.search);
  let page = $state<Page>(!desktop && q.has('pipeline-demo') ? 'extract' : 'annotator');
  let shown = $state<Set<Page>>(new Set());
  $effect(() => { if (!shown.has(page)) shown = new Set([...shown, page]); });
  let run = $state<RunStatus | null>(null);
  let modal = $state(false);   // the viewer waits on a dialog: the rail is out of reach, as the page behind it is
  let runKey = $state(0);   // New run: Extract starts over
  // the app's updates: checked quietly at launch; the macOS app menu's Check for Updates… asks again, in Settings
  let updates = $state<Updates | null>(null);
  let settingsShow = $state<SettingsSection | null>(null);   // the part of Settings to bring into view
  // a key, a server or the cloud being changed in Settings: Start run on Extract waits for it (it would race the change)
  let configBusy = $state<string | null>(null);
  const toSettings = (section: SettingsSection) => { page = 'settings'; settingsShow = section; };
  const badge = $derived.by((): UpdateBadge | null => {
    const u = updates?.phase;
    return u?.kind === 'available' ? { state: 'available', version: u.version, fraction: null }
      : u?.kind === 'downloading' ? { state: 'downloading', version: u.version, fraction: u.fraction }
      : u?.kind === 'ready' ? { state: 'ready', version: u.version, fraction: 1 } : null;
  });
  const toUpdates = () => toSettings('updates');
  // the pipeline being set up (first launch, or a new version: its packages and model weights) is, like a run, something
  // a relaunch would stop: listening first, then its status now, so no change is missed
  let setupBusy = $state(false);
  // the setup status could not be read: said beside Relaunch now, which stays offered (a broken status must not strand
  // an installed update); the next setup event clears it
  let setupUnknown = $state<string | null>(null);
  $effect(() => {
    const p = pipeline;
    if (!p) return;
    let off: (() => void) | null = null, gone = false, heard = false;
    const busy = (s: SetupStatus) => s.state === 'installing' || s.state === 'running';
    p.onSetup((s) => { heard = true; setupBusy = busy(s); setupUnknown = null; })
      .then((f) => { if (gone) f(); else off = f; return p.setupStatus(); })
      .then((s) => { if (!gone && !heard) setupBusy = busy(s); })
      .catch((e) => { if (!gone && !heard) setupUnknown = String(e); });
    return () => { gone = true; off?.(); };
  });
  const holdRelaunch = $derived(run?.state === 'running' ? 'A run is going on Extract, and a relaunch would stop it. Relaunch once it ends.'
    : setupBusy ? 'The pipeline is being set up (its packages and model weights), and a relaunch would stop that. Relaunch once it is done.' : null);
  const relaunchCaution = $derived(setupUnknown && `Could not tell whether the pipeline is being set up (${setupUnknown}): a relaunch would stop it if it is.`);
  const startUpdates = (u: Updates) => { updates = u; u.check({ quiet: true }); };
  if (desktop) {
    tauriUpdater().then((api) => startUpdates(new Updates(api))).catch(() => {});
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('menu://check-for-updates', () => { toUpdates(); updates?.check(); });
      // File > Import… and Export…: the Annotator page does them (Annotator, Header), on its own page
      listen('menu://import', () => { page = 'annotator'; window.dispatchEvent(new Event('app:import')); });
      listen('menu://export', () => { if (page === 'annotator') window.dispatchEvent(new Event('app:export')); });
    });
  } else if (q.has('update-demo')) {
    import('./lib/updates.fake').then((m) => startUpdates(new Updates(m.fakeUpdater((q.get('update-demo') || 'available') as Parameters<typeof m.fakeUpdater>[0]))));
  }

  if (desktop) { tauriPipeline().then((p) => (pipeline = p)).catch((e) => (error = String(e))); library = tauriLibrary(); }
  else {
    if (q.has('library-demo')) import('./lib/library.fake').then((m) => (library = m.fakeLibrary(q.get('library-demo') === 'empty')));
    const bundle = q.get('bundle');
    if (q.has('pipeline-demo')) import('./lib/pipeline.fake').then((m) => (pipeline = m.fakePipeline(400, { rejectRun: q.get('pipeline-demo') === 'reject-run', slowStart: q.get('pipeline-demo') === 'slow-start', noNeeds: q.get('pipeline-demo') === 'no-needs', oldCli: q.get('pipeline-demo') === 'old-cli', twoPlaces: q.get('pipeline-demo') === 'two-places', summary: q.get('pipeline-demo') === 'summary', remote: q.get('pipeline-demo') === 'remote', machinesError: q.get('pipeline-demo') === 'machines-error', noCloud: q.get('pipeline-demo') === 'no-cloud', keysError: q.get('pipeline-demo') === 'keys-error', missingKey: q.get('pipeline-demo') === 'missing-key', gated: q.get('pipeline-demo') === 'gated',
      setup: q.get('pipeline-demo') === 'setup-running' ? 'running' : q.get('pipeline-demo') === 'setup-failed' ? 'failed' : q.get('pipeline-demo') === 'installing' ? 'installing' : q.get('pipeline-demo') === 'install-failed' ? 'install-failed' : 'done' },
      // what each demo run was given (its consent, places and spending cap), for the browser tests
      ((window as unknown as { __pipelineRuns: unknown[] }).__pipelineRuns = []))));
    if (bundle) httpSource(bundle, q.get('video'), q.get('previous')).then((s) => (source = s)).catch((e) => (error = String(e)));
  }

  // The web view's own right-click menu offers Reload, which would drop a run going on Extract and the open bundle's
  // place. The desktop app keeps it only where it helps: in a text field (paste) and on selected text (copy).
  function oncontextmenu(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.closest?.('input, textarea, [contenteditable="true"]') || !!window.getSelection()?.toString()) return;
    e.preventDefault();
  }

  // Extract's Open in Annotator: the Annotator page opens that bundle
  let openRequest = $state<string | null>(null);
  function openBundle(id: string) {
    error = null;
    page = 'annotator';
    if (library) openRequest = id;
    else error = `would open ${id}`;   // browser mode without ?library-demo has no library to open from
  }
</script>

<svelte:window oncontextmenu={desktop ? oncontextmenu : undefined} />

<div class="app">
  <div class="rail-wrap" inert={modal}><Rail {page} {run} update={badge} onnavigate={(p) => (page = p)} onupdate={toUpdates} /></div>
  <main>
    {#if shown.has('extract')}
      <div class="page" class:on={page === 'extract'}>
        {#if pipeline}
          {#key runKey}
            <PipelineDialog api={pipeline} visible={page === 'extract'} {configBusy} onsettings={toSettings} onnew={() => runKey++} onopen={openBundle} onstatus={(r) => (run = r)} />
          {/key}
        {:else if error}<p class="error note">{error}</p>
        {:else if !desktop}<p class="muted note">Extract runs the pipeline in the desktop app. In a browser, add <code>?pipeline-demo</code> to the address to try it against a stand-in.</p>
        {/if}
      </div>
    {/if}

    <div class="page" class:on={page === 'annotator'} class:holds-viewer={!!source || !!library}>
      {#if library}
        <Annotator {library} active={page === 'annotator'} request={openRequest} onrequested={() => (openRequest = null)}
          onextract={() => (page = 'extract')} onmodal={(m) => (modal = m)} />
      {:else if source}
        <Viewer {source} active={page === 'annotator'} onmodal={(m) => (modal = m)} />
      {:else}
        <div class="browser">
          <h1 class="page-title">Annotator</h1>
          {#if error}<p class="error">{error}</p>{/if}
          <p class="muted">Open a bundle with <code>?bundle=&lt;bundle folder URL&gt;&amp;video=&lt;video URL&gt;</code>, or add <code>?library-demo</code> to try the library against a stand-in. The desktop app imports bundles from disk.</p>
        </div>
      {/if}
    </div>

    {#if shown.has('settings')}
      <div class="page" class:on={page === 'settings'}>
        <Settings api={pipeline} {updates} active={page === 'settings'} {holdRelaunch} {relaunchCaution} show={settingsShow} onshown={() => (settingsShow = null)}
          onbusy={(b) => (configBusy = b)} />
      </div>
    {/if}
  </main>
</div>

<style>
  .app { height: 100%; display: flex; min-width: 0; }
  .rail-wrap { display: flex; }
  main { flex: 1; min-width: 0; min-height: 0; position: relative; }
  .page { display: none; position: absolute; inset: 0; overflow: auto; }
  .page.on { display: block; }
  .page.holds-viewer { overflow: hidden; }   /* the viewer lays itself out to the window and scrolls its own parts */
  .note { padding: 28px 20px; margin: 0; max-width: 64ch; }
  .browser { padding: 28px 20px; max-width: 720px; display: grid; gap: 8px; }
  .browser p { margin: 0; }
</style>
