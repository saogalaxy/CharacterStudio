# CharacterStudio — clean build: wipe everything except the T-pose / Mesh APIs and the pose model files

Decision (2026-11-11): the rig-flow rebuild did not fix the defect.
Markers still show dots only, with no skeleton to check visually, and
Bind rigs the mesh before the skeleton is ever shown. The head is
still bent down in Walk. So the whole app is rebuilt clean, with no
reference to the old code, except for the keep list below.

## Stop first

- Stop the current rig rebuild work immediately. Commit nothing
  from it. Do not carry any of its edits into the clean build.

## Keep — do not wipe, do not rewrite, do not redownload

1. T-pose API: `app/pipeline/tpose.py`, its ComfyUI workflows in
   `app/workflows/`, and only what it calls to reach ComfyUI.
   Callable as-is, no edits.
2. Mesh API: `app/pipeline/mesh.py`, its ComfyUI workflows in
   `app/workflows/`, and only what it calls to reach ComfyUI.
   Callable as-is, no edits.
3. Pose model files: everything under `library/mesh2motion/` —
   `skeleton.glb`, `model.glb`, `animations/` (234 clips),
   `manifest.json`, `clip_list.txt`, `preview_index.json`.
   Do not delete, modify, or redownload any of them.
4. The specification files in the repo root:
   `CharacterStudio-rig-fix-job-list.md`,
   `CharacterStudio-ui-changes.md`,
   `CharacterStudio-rebuild-directive.md`, and this file.
5. `runtime/` is not in the repo and is untouched.

## Wipe — everything else, clean

Delete all other code in the repo and rebuild it from scratch:

- `app/app.py`, `app/pipeline/jobs.py`,
  `app/pipeline/animations.py`, `app/pipeline/blender/markers.py`,
  `app/pipeline/blender/rig.py`, `app/pipeline/blender/m2m_skel.py`,
  and every other file under `app/pipeline/` and
  `app/pipeline/blender/` except the kept T-pose / Mesh APIs.
- All of `app/static/` — `index.html`, `app.js`, `viewer.js`,
  `style.css`, and any vendored frontend files.
- `app/tests/`, `Character Studio.exe`, and any other code or
  build artifact in the repo.

## No-reference rule

- Do not open, read, or copy the wiped code while rebuilding.
- Build only from the specification files listed above and from
  the demo UI behaviour they describe.
- The kept T-pose / Mesh APIs and the pose model files are the
  only old material allowed in the new build, and they are used
  as-is, not copied into new code.
- If a new file ends up the same as an old file, it was not built
  clean — rewrite it.

## What the clean build must do

Native Windows desktop app, same shape as before: Python backend,
pywebview/WebView2 frontend, headless Blender + ComfyUI runtimes
under `runtime/`. Six steps, in order: Source, T-pose, Mesh,
Markers, Rig, Animations. Each step owns one artifact, and
changing a step clears everything after it.

- Source, T-pose, Mesh: as specified in
  `CharacterStudio-ui-changes.md` — upload-my-own on all three,
  T-pose method Standard / 2.5D / Custom prompt, Mesh detail
  presets Simple 12k / Optimized 60k and seed presets Default
  (156863899) / Random / Lock seed, mesh-check readout.
- Markers: ActionForge dots — orange anchors draggable, white
  follow dots turn orange when grabbed, no tick-to-unlock,
  labels as an option default off, named off-body banner
  blocking Rig. Markers verified in 3D depth, not front view
  only; a side-view drag edits depth and persists.
- Skeleton: a separate step after Markers, before Bind. The
  skeleton is shown as bones and joints on the mesh in
  Front / Side / Back / Free views, draggable in all views,
  with Cloth / Prop tagging and SHOW ENVELOPES for the
  midsection (spine / pelvis / hips). Nothing is bound until
  the skeleton has been seen and checked.
- Rig: Bind & wear, then the character holds the bind pose
  with the skeleton visible and does not auto-play an
  animation. Animation plays only when chosen.
- Animations: full 234-clip library as cards with the real
  previews, searchable, plus new-motion cards and upload-my-own
  motion; Fit overlay (Arm-Space, Arms, Overdrive, Stance,
  Hip height, Turn, Reset fit) that can be hidden; transport
  with scrub and speed; loops play as continuous motion with
  no T-pose flash at the wrap.

## Order and done-when

- Rebuild in pipeline order: Source, T-pose, Mesh, Markers,
  Skeleton, Rig, Animations. Finish one step and run it before
  starting the next.
- No step counts as done until it runs on the same job, from
  that step, through Bind & wear and at least two motions.
- Done when, on job "anime": Markers show dots, Skeleton shows
  the bones before any bind, Bind stops at a bind pose with
  the head upright and no stray line, and Walk and Farm harvest
  both play with the head upright, the face visible, and no
  line off the body.
- If a done-when cannot be met, state which one, what was
  tried, and what blocks it. Do not mark it done and move on.

## Non-goals for this round

- No web rebuild and no Blender-free browser version.
- No IK, animation layering, or Motion Lab in this round.
- No change to export formats.
- No retarget path for already-rigged GLBs in this round.
