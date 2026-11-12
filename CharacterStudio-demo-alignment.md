# CharacterStudio — UI alignment: built app vs UI design demo

The built app is bare bones next to the UI design demo
(`characterstudio-ui-demo`). The demo is the target —
open it here to see the layout, not just this text:
https://muse.ai/s/characterstudio-ui-demo-cp6cxb6rxkxsxb0/pvuuBMoxiIxKXkgETmL8RKPA0HwVF5REHWzdEycvsvw
This list is what is missing or different, step by step. Work
it in order. Each item counts only when proven by running
the app, not by reading the code. Verification is by the
user: run the app, then ask the user for a clip or
screenshot of the result. Do not use computer-use or
screen recording to verify — the user is in front of the
PC and sends the clips.

What already matches — do not redo it: T-pose controls
(method, prompt, Generate, upload); Mesh presets and seed
(Optimized 60k / Simple 12k, Default / Random / Lock,
default seed 156863899); Markers dots (orange drag, white
turns orange on grab, labels off by default, named
off-body banner); Skeleton envelopes (midsection sliders);
six Fit sliders at the demo's ranges with Reset fit and
Hide; upload-my-own on Source / T-pose / Mesh; library
renders all 234 clips with real previews where they
exist.

## 1. Steps: 6 in the demo, 7 in the built app

Demo top bar: Source, T-pose, Mesh, Markers, Rig,
Animations, with Skeleton as a flow step inside Rig.
Built app: Skeleton is its own top-level step. The two
specs conflict — the UI spec decided six, the clean-build
spec required a separate Skeleton step. The six-tab bar
was the decided form. Reconcile it to six, with Skeleton
as a step inside Rig, unless the owner says otherwise.

## 2. Jobs sidebar — absent

Demo: left sidebar with "+ New", four jobs (anime,
knight, chibi-cat, robot), Library / Animations / Exports.
Built app: no sidebar; it auto-loads the job named
"anime". Add the sidebar: list jobs, switch jobs, create
a job.

## 3. Source — bare

Demo: upload card, Remove background (on) / Auto-crop to
body (on) toggles, detected-character info, current file
shown, "Next: T-pose" button. Built app: one line of
text plus "Upload my own". Add the file display, the
character info, and step-to-step Next navigation. The
background/crop toggles have no backend behind them;
add them as settings that stick, or say what blocks
them instead of silently dropping them.

## 4. T-pose — same controls, thinner presentation

Demo: three method cards, prompt box, upload card,
Generate, "Last build" line, back/next navigation.
Built app: method dropdown, prompt only for Custom,
Generate, Upload. Add the navigation buttons and the
last-build line.

## 5. Mesh — no detail slider, no Custom preset

Demo: Detail presets Simple 12k / Optimized 60k /
Custom, Detail slider 8k–80k triangles, seed presets
plus seed slider/number, Generate, upload, "Last
build" line. Built app: preset dropdown with only
Optimized / Simple — no Custom preset and no tris
slider; seed mode dropdown plus number input; upload
restricted to .glb. Add the Custom preset and the
detail slider. The .glb-only upload matches the
backend; the demo's wider formats were demo-only.
The built app already has a Mesh check readout card
the demo dropped — keep it.

## 6. Markers — close, with gaps

Demo: 14 dots, Auto-place, Reset follow, rig-flow
indicator (1 Place dots / 2 Skeleton / 3 Bind &
wear), status line ("All dots are on the body"),
viewport Labels and Show envelopes checkboxes.
Built app: Dots card, Show labels checkbox, Place
dots, Reset dots, off-body banner. Add the rig-flow
indicator, the all-dots status line, the Show
envelopes toggle in this view, and a "Next: Rig"
button.

## 7. Rig / Skeleton — cloth/prop tagging entirely absent

Demo Rig panel: envelope sliders, Body / Cloth / Prop
tagging buttons, Detect fingers, Mirror left/right,
Show one side, Show bone axes, status ticks "SKELETON
FIT" and "DEFORMATION PASS", "Back to dots",
"Bind & wear". Built Skeleton step: Show envelopes,
six sliders (pelvis, spine_01–03, thigh_l/r), a
fingers dropdown, Bind & wear. Built Rig step: help
text plus Bind & wear only.
Add, in full: cloth/prop tagging (no backend exists
for it yet — add the storage and the weighting);
Mirror, Show-one-side, Show-bone-axes toggles;
SKELETON FIT / DEFORMATION PASS status ticks; a
"Back to dots" button. The Rig step must also show
the skeleton on the bound mesh, not just the mesh
and a button.
Note: the built app marks the skeleton as seen the
moment the Skeleton panel first draws. That is not
a check. Replace it with an explicit confirm — the
skeleton counts as checked only when the owner says
so on the panel, not when the panel opens.

## 8. Animations — cards only, no controls

Demo: 234 cards with 10 categories, each card with
name, category, duration and "Loops" / "Plays once",
a Play button, and a live preview; four NEW cards;
an "Add a new motion" card; a saved-clips section;
transport (Play, restart, scrub slider, speed
0.5x–2x, "LOOP-CLOSED" label); exports
(`anime_rigged.glb`, `anime_walk.glb`, Export .glb).
Built app: Search box, a family dropdown, a grid of
clips with previews or letter tiles, an "Upload a
motion" card, click-a-card to apply-and-play, and
the Fit overlay.
Add: transport controls (play/pause, restart, scrub,
speed — the stage already has scrub and speed
methods, nothing calls them); per-card duration and
Loops / Plays-once labels; per-card Play button;
saved-clips section; export buttons. NEW cards need
a recency field that does not exist yet — add it.
The demo's 10 categories have no backend source;
the built filter uses clip-name families instead.
Add a real category field or say what blocks it.
Also: clicking a card must change the motion. Today
it does not — the rig is not reloaded after a clip
is applied, so the new clip never reaches the
player. Reload the rig (or add the clip) when a
card is applied, and prove it by playing two
different motions in one run.

## 9. Fit overlay — no pill to bring it back

Demo: "Hide" collapses the overlay to a small "Fit
to character" pill on the viewport; tapping the pill
restores it with settings intact; status line "Walk ·
unmodified". Built app: a "Hide fit" / "Show fit"
button inside the overlay toggles it hidden — there
is no pill. Add the pill. Add the status line. The
overlay must also mount for a library clip before
it is applied, not only after it is on the
character.

## 10. Viewport

Demo: FRONT / SIDE / BACK / FREE plus Labels and
Show-envelopes checkboxes on the viewport. Built
app: five view buttons (front / left / right / back
/ free); labels only via the panel checkbox;
envelopes toggle only in the Skeleton panel. Add
the viewport Labels and Show-envelopes checkboxes.

## Also fixed alongside this list

- Mesh step never showed the mesh: the step had no
  mesh mode, so opening it cleared the viewport
  even though the step was green. The Mesh step now
  loads and shows `mesh.glb`; uploading a new mesh
  reloads the viewport; views that are not Markers
  or Skeleton show a clean mesh with no overlay.
  (`app/static/studio.js`: Mesh view added to mesh
  mode, `paintMarkers` clears the overlay for other
  views, upload resets the shown mode.)
