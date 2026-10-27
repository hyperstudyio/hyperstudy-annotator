# Porting the prototype annotator to Svelte

The prototype (`hyperstudy-perception/pipeline/bakeoff/annotator/template.html`, one page of plain JavaScript over a
`build.py` data blob) is the reference for behaviour: every interaction in it was reviewed by hand. This app reads
track bundles instead of the blob, keeps corrections in SQLite instead of `localStorage`, and is written as Svelte 5
components so HyperStudy can embed the viewer later.

Search the code for `TODO: [ANNOTATOR-PORT]` to find steps that are not finished.

## Layout of `src/lib`

| Path | What it is |
|---|---|
| `types.ts` | The bundle format (schema 0.1), only the fields the app reads |
| `source.ts` | Where a bundle comes from: `BundleSource` (Tauri commands, or HTTP for browser testing) and where its corrections are kept (`CorrectionStore`) |
| `model/bundle.ts` | `Bundle`: every layer loaded once and indexed (by id, by shot, by time). Immutable. |
| `model/corrections.ts` | The op log: op types, `fold(ops)` into corrected state, and the importer for the prototype's v1 files |
| `model/session.svelte.ts` | `Session`: bundle + corrections + selection + view prefs + playback; the questions every view asks (`personOf`, `speakerOf`, `included`, the review queue...) |
| `model/view.svelte.ts` | Per-viewer layout (hidden and reordered rows, heights, drawer, overlays), in `localStorage`; never corrections |
| `draw/*.ts` | Canvas drawing for the overlay and the timeline's plot rows |
| `timeline/rows.ts` | The timeline's groups and rows, built from the session |
| `timeline/scale.ts` | The time scale (fit, time under the pointer, zoom about the pointer) |
| `model/context.ts` | The session and source as Svelte context, for every component under the workspace |
| `components/` | Svelte components. `Workspace.svelte` (given a `Session` and its `BundleSource`) is the piece HyperStudy embeds; `Viewer.svelte` loads a bundle into one |

## Steps

1. **Data model.** Bundle loading and indexing, the corrections fold with the bundle's string ids, the v1 importer
   (`track 126` to `face:126`, `Person O` to `person:Person O`), the session's queries. Unit tests.
2. **Persistence.** Corrections through Tauri commands (`load/append/truncate/replace_corrections`), or
   `localStorage` in browser mode. Undo removes the newest batch (ops committed together share `at`).
3. **Layout.** Header (counts, undo, import, export), stage, drawer with tabs (Inspect, Review, People; Annotate and
   Data were folded into the timeline later: BACKEND_PLAN decisions), splitters for the drawer width and timeline height, the `\` key.
4. **Overlay.** Faces (by person, dashed when excluded, candidate numbers), objects, skeletons, hands, landmarks,
   gaze (Gaze-LLE peak, or the py-feat ray), facing; display smoothing; click a face or object to select it.
5. **Timeline.** Groups (Audio and speech, Prosody, People, Objects, Gestures, Social, Sounds, On-screen text,
   Annotations): collapse, hide rows, drag to reorder groups and rows within a group, drag a row's edge to resize,
   group chips. Rows: shots, waveform, transcript, prosody (pitch, ending, affect lines, delivery captions), a row
   per person (on screen + speech, drag speech between rows to change the speaker), objects, gestures, social,
   sounds, text, annotation types (drag across to add a span). Shot cuts, playhead, clip and range shading.
6. **Inspector views.** Shot, utterance (speaker choice, candidates, prosody), face track (assign, py-feat at the
   playhead), person (merge, not a person, co-visible warning, similar people), object track and identity,
   sound, text, gesture, facing, gaze event, note. Lightboxes: every track of a person, compare two people.
7. **Tabs.** Review queue (uncertain speakers by shot, possible duplicates, unconfirmed sounds), People. Annotation
   types (yes/no, category, number, text; about a person or the scene) are made and edited on the timeline's
   Annotations group; the models behind each group are its ⓘ.
8. **Keys.** Space, Shift+Space, L, arrows, Shift+arrows, `,` `.` shots, `j` `k` review, `a` annotate the selection,
   `[` `]` mark a span, `y` `n` and 1-9 a selected annotation's value, 1-9 `o` `m` `u` `x` speaker, Esc, Cmd+Z, `\`.
9. **Browser check** of every step in Chrome against the prototype, then the native app.

## Status (2026-10-23)

Steps 1-8 are done and checked in Chrome (browser mode) on both bake-off bundles. Step 9: the native app builds and
starts (`npm run tauri dev`); its window and file dialogs still need checking by hand (the TODO in `source.ts`).

Tests: `npm test` (vitest: the model, the timeline rows and scale, the drawing maths), `npm run test:e2e` (Playwright,
in the installed Chrome and in WebKit, the desktop app's engine, `--project chrome|webkit`, against `npm run dev`; the
tests that need the bake-off bundles read `/devdata` and skip without it, as in CI),
`cargo test` in `src-tauri`, `npm run check`.

The viewer's grid tracks are `minmax(0, ...)` and its items `min-width: 0`: the timeline's scale is fitted to its
width, so that width must never depend on what is on screen (see `e2e/timeline.spec.ts`).

## Not ported (the bundle does not carry it yet)

- Model pickers for pose, hands and gaze: a bundle holds one model per layer.
- Face mesh, emblems and meaningful-gesture events: not converted into bundles yet.
- Alt-click segmentation: needs the pipeline's segment server; comes with the "drive the pipeline" phase.
