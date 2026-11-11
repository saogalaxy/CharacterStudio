# CharacterStudio — UI changes: backend audit and implementation spec

Scope: the UI changes approved in the interactive demo
(`characterstudio-ui-demo`) checked against the backend code read at
HEAD `62e79b0d` ("Add rig fix job list"). Files read:
`app/app.py`, `app/static/app.js`, `app/static/viewer.js`,
`app/pipeline/jobs.py`, `app/pipeline/tpose.py`,
`app/pipeline/mesh.py`, `app/pipeline/animations.py`,
`app/pipeline/blender/markers.py`, `app/pipeline/blender/m2m_skel.py`,
`app/pipeline/blender/rig.py`, `app/pipeline/blender/mesh_check.py`,
`app/pipeline/blender/export_pack.py`,
`library/mesh2motion/clip_list.txt`,
`library/mesh2motion/preview_index.json`, and the directory listing of
`library/mesh2motion/animations/`.

Context: the rig-fix job list (`CharacterStudio-rig-fix-job-list.md`,
Jobs 0–6) covers markers (Job 1), side view (Job 1b), midsection
envelopes (Job 2), cloth/prop tagging (Job 3), finger count (Job 4),
retarget (Job 5, deferred), and the animation loop flash (Job 6).
This spec covers the demo UI changes against that same backend and
does not replace Jobs 0–6.

## Verdict

- Backend-ready, no new backend work: T-pose method selection and
  upload; mesh detail/seed presets and upload; mesh-check readout;
  upload-my-own on Source; the "Fit to character" overlay ranges and
  per-clip fit persistence; the motion-library data source (234 clips,
  real preview URLs for 221 of them); transport, scrub, and speed
  controls.
- Backend work still needed: splitting the single Rig tab into
  separate Markers / Rig / Animations views (required by the six-step
  top bar); grab-to-unlock for white follow dots and a labels
  show/hide option; a named off-body banner; per-bone envelope
  overrides and envelope rendering in the viewport; cloth/prop tag
  storage and weighting; finger-count selection and hand templates;
  the animation loop closure (Job 6).
- Demo-only, with no backend behind it: the animated stick-figure
  card previews; the category filter; the four NEW motion cards and
  the "Add a new motion" card as drawn; the fixed 1360 px desktop
  lock; the six-step top bar as drawn (see the decision point below).

## Decisions required before implementation

1. **Top bar: six steps — decided: six.** The backend pipeline has six
   steps (`jobs.py`: `STEPS = ["source", "tpose", "mesh", "markers",
   "rig", "animations"]`). The current frontend defines the same six
   in `STEPS` (`app.js`) but renders only four tabs
   (`UI_STEPS = [source, tpose, mesh, rigflow]`), with markers, rig,
   and animations collapsed into the single Rig tab (`rigflow`),
   split internally by `job._rigPhase` ("dots" / "play"). The demo
   shows six top-level steps, which matches the backend step list
   and does not match the current frontend. Decision (2026-11-11):
   keep the six tabs as shown in the demo. Implementation splits
   `rigflow` into three views. Splitting requires new `view`
   handling in `renderSide()` (`app.js`), which currently handles
   only `source`, `tpose`, `mesh`, and `rigflow`; a
   `view === "animations"` branch does not exist except in the unused
   demo path (`previewDemoClip`, `animationsCard` has `demo = false`).
2. **Library presentation: flat 234-card grid or family tree.**
   The backend groups library clips into families
   (`animations.py`: `clip_family`, `siblings`, `family_root`) and
   the current UI shows collapsed family roots, capped at 80 root
   tiles, with a "Showing 80 of N — refine search" note. The demo
   shows all 234 clips as individual cards. Pick one before
   implementation.
3. **Category filter.** No category field exists in the code read:
   `library_clips()` returns `id`, `label`, `source`, `file`,
   `family`, `preview`, plus `siblings` / `family_root` where
   applicable. The current UI filters by text search only
   (`_libFilter`). A category filter needs a category mapping defined
   from clip ids/families; no such mapping exists in the code read.
4. **NEW motion cards.** No "new" flag or recency field exists in
   the code read. The closest existing concepts are Import motion
   (a file the user supplies) and Add "clip" (a highlighted library
   clip added to the character). The four NEW cards (Jump, Dance,
   Sit, Bow) correspond to existing material — `jump`, `sit`, `bow`
   are built-in clips (`animations.py`: `CLIPS`), and dance is a
   clip family (`dance-*`) — but nothing in the code marks them as
   new. Decide whether NEW means "recently added to the library"
   (needs a source of recency, not found in the code read) or drop
   the badge.
5. **Card preview source.** Real previews are looping MP4s from
   `library/mesh2motion/preview_index.json` (221 URLs for 234 clips;
   13 clips have no preview URL) served through
   `animations.py`: `library_preview_url()`, rendered by
   `previewMedia()` in `app.js` as a muted looping autoplaying video,
   falling back to an initial-letter placeholder tile. On-character
   clips also have still thumbnails at `rig/poses/{clip}_front.png`
   (`thumb_rel`, `pose_shots`, rendered by `render_poses.py` at rig
   time). The demo's animated stick figures are stand-ins with no
   backend source; implementation must use the MP4 previews and the
   pose thumbnails, not the stand-ins.
6. **Seed default.** The demo showed a Default seed of 42 in one
   build. The backend default is 156863899
   (`mesh.py`: `DEFAULT_SEED = 156863899`). Use 156863899.

## Mapping: demo change against backend

### 1. Six pipeline steps, desktop-locked 1360 px, no responsive reflow

| | |
|---|---|
| Backend support | `jobs.py`: six steps, each owning one artifact (`source.png`, `tpose.png`, `mesh.glb`, `markers.json`, `rig/rigged_animated.glb`, `animations.json`); changing a step clears everything after it (`clear_after`). `app.js`: `STEPS` lists the same six. |
| Backend work needed | Split `rigflow` into Markers / Rig / Animations views (decision 1). `render()` maps `UI_STEPS` to the top bar; `renderSide()` and `renderView()` handle `rigflow` as one view with `_rigPhase` dots/play. |
| Demo-only / mismatch | The 1360 px fixed lock has no backend equivalent. The real window is a desktop window created at 1500×950 with a minimum size of 1100×700 (`app.py`: `webview.create_window`). The demo lock is a presentation choice for viewing the demo on a phone; it does not describe a backend constraint. |

### 2. T-pose: method Standard / 2.5D / Custom prompt, custom prompt box, Generate T-pose, Upload my own T-pose image

| | |
|---|---|
| Backend support | Fully supported. `tpose.py`: `METHODS = ("standard", "2_5d", "custom")`, `DEFAULT_METHOD = "standard"`; `settings_from()` restores stock prompts for standard / 2_5d and preserves the remembered custom prompt (`custom_prompt` survives a switch away from custom). `build_prompt()`: standard output 1024×1024; 2.5D uses the Desktop prompt with a larger output (2048 fallback when the `4x-UltraSharp.pth` upscale model is absent). Endpoint: `POST /api/jobs/{job}/tpose-settings` (`app.py`) → `jobs.set_tpose_settings()` → `tpose.settings_from()`. Run: `POST /api/jobs/{job}/run/tpose` → `jobs._run_tpose()` (Comfy graph, 1800 s timeout). Upload: `POST /api/jobs/{job}/upload/tpose` → `jobs.put_image()` — square-pads to 1024×1024 and clears downstream steps. Frontend: `tposeMethodCard()` and `runCard()` in `app.js` already render this exact set. |
| Backend work needed | None. |
| Demo-only / mismatch | None, except the demo's earlier pose-setting sliders (arm level, stance, torso, cleanup switches) are not part of this step and were removed; they belong in Animations (change 6). |

### 3. Mesh: detail presets Optimized 60k / Simple 12k + 8k–80k tris slider; seed presets Default / Random / Lock seed + seed number; Generate mesh; Upload my own mesh (.glb); mesh-check readout

| | |
|---|---|
| Backend support | Fully supported. `mesh.py`: `PRESETS = {"optimized": 60000, "simple": 12000}`, `clamp_tris()` limits 8000–80000; `SEED_MODES = ("default", "random", "lock")`, `DEFAULT_SEED = 156863899`, `clamp_seed()` limits 0–2147483647, `resolve_seed()` picks the seed actually used and `jobs._run_mesh()` records it in `mesh_settings`. Endpoint: `POST /api/jobs/{job}/mesh-settings` → `jobs.set_mesh_settings()` → `mesh.settings_from()`. Run: `POST /api/jobs/{job}/run/mesh` → `jobs._run_mesh()` (Comfy, 7200 s timeout), then `jobs._mesh_check()`. Upload: `POST /api/jobs/{job}/upload/mesh` → `jobs.put_mesh()` (writes the file, `normals.repair()`, enqueues `mesh_check`). Mesh check: `jobs._mesh_check()` runs Blender `mesh_check.py`, which writes `mesh_check.json` with checks `has geometry`, `one main body`, `T-pose arms` (arm span ≥ 0.70× height), `head present`, `markers found`, `textured` (textured is informational — `ok` excludes it). Frontend: `meshQualityCard()`, `meshSeedCard()`, `meshCheckCard()` in `app.js` already render this exact set. |
| Backend work needed | None. |
| Demo-only / mismatch | Upload format: the backend accepts `.glb` only — `app.py` `upload()` rejects a mesh whose first four bytes are not the `glTF` magic. A demo upload accepting `.gltf` / `.obj` / `.fbx` does not match the backend; restrict the Mesh upload to `.glb` or add a conversion step (not found in the code read). |

### 4. Markers: ActionForge dots — orange anchors draggable, white follow dots turn orange when grabbed, labels as an option default off, no tick-to-unlock, off-body dot named in banner blocking Rig

| | |
|---|---|
| Backend support | Partial. Detection and persistence exist. `markers.py`: `MARKERS = ("chin", "groin", "elbow_l", "elbow_r", "wrist_l", "wrist_r", "knee_l", "knee_r")` (8 markers); `joints_from_markers()` derives the skeleton joints; `off_body()` (tolerance 0.015) and `joints_off_body()` report off-body markers/joints. `jobs.put_markers()` (`POST /api/jobs/{job}/markers`): accepts a full marker set (must match the stored 8 names exactly) or a joints dict (each joint must already exist); a marker update recomputes joints via `_joints_from_pts()`; a joint update syncs markers back via `_sync_markers_from_joints()` (lowerarm → elbow, hand → wrist, calf → knee, plus chin from neck +0.025×height and groin from pelvis −0.05×height); recomputes both off-body lists; clears rig and animations downstream; returns the updated detection with message "skeleton adjusted". Rig gating exists: `Job.state()` sets `markers.can_run` false while anything is off-body, and `markersCard()` disables Bind & wear while `blocked > 0`. Frontend landmarks exist: `viewer.js` `LANDMARKS` (14 entries: chin, shoulder/elbow/wrist L+R, groin, hip/knee/ankle L+R) with anchor/follow tones, mirror map, and follow parents; `DRAG_JOINTS` (16 joints) are draggable; `_makeViewBar()` / `setOrthoView()` provide Front / Left / Right / Back / Free with `_dragPlane()` per view. |
| Backend work needed | (a) Grab-to-unlock: the current drag gate is `s.userData.drag = !follow || solo.has(spec.id)` (`viewer.js`), where `solo` is set only by the follow-dot checkbox in `markersCard()` (`job._markerSolo` → `viewer.setSolo()`). Removing the checkbox requires a new grab path: a pointer-down on a follow dot in the viewport must mark that dot unlocked (turn it orange) and make it draggable alone, without a panel checkbox. The follow behaviour itself stays — an anchor drag shifts its followers via `_shiftLandmark()`; only the unlock mechanism changes. (b) Labels option: no show/hide toggle and no hover-only name handler were found in `app.js` or `viewer.js` in the code read — labels are created for landmarks and joints in `setLandmarks()` and shown by default. Add a labels option (default off) and a hover name display. (c) Named off-body banner: the current UI shows per-row ✓/✗ marks and the help text "binding stays locked until every dot is on the mesh", and `_run_markers()` lists off-body names in the step message. No banner naming a single off-body dot exists in the panel; add one that names the dot (for example "The groin dot isn't on the body") and blocks Rig until it is back on the mesh. (d) Reconcile 14 UI landmarks with 8 backend markers: shoulder, hip, and ankle landmarks have no backend marker and persist only through the joints path; a drag of any landmark must persist through `put_markers()` and must not be silently dropped. |
| Demo-only / mismatch | None in the behaviour itself; the demo's separate Markers step is the same view-split question as decision 1 (markers is a backend step but a phase of the Rig tab in the current frontend). |

### 5. Rig: Skeleton step, SHOW ENVELOPES switch + midsection (spine/pelvis/hips) size controls, cloth/prop tagging, finger count selector

| | |
|---|---|
| Backend support | Rig execution exists; the three controls do not. `jobs._run_rig()` runs Blender `rig.py` with `[mesh, out_dir, markers.json]` (3600 s timeout), then renders pose shots, runs `glb_check.py`, records the deform QA gate, and exports the pack. `rig.py` `paint_regions()`: nearest deform bone, blended only with parent and child, head cut off below the neck, side limit `0.06 * height`, max 4 influences, normalised. The skeleton itself is fitted by `m2m_skel.fit()`, preserving template bone rolls (`_match_roll`). The spine/pelvis/hip bones named by the demo exist in the joint set (`pelvis`, `spine_01/02/03`, `thigh_l/r`). |
| Backend work needed | (a) Envelopes (Job 2): no envelope control was found in the code read — zero envelope UI hits in `app.js` / `viewer.js`; `rig.py` uses fixed constants `sigma = 0.02 * height` and `band = d[nearest] * 1.8 + 0.03 * height`. Work: per-bone envelope overrides stored with the job artifacts (the Job 2 design reads them from `markers.json` via `paint_regions()`; no such field exists in the code read), a SHOW ENVELOPES switch that renders the envelope volumes in the viewport (new Three.js geometry in `viewer.js`), and a size control for the picked bone, starting with spine/pelvis/hips only. No-override runs must produce identical results to the current fixed values. (b) Cloth/prop tagging (Job 3): no tagging was found in the code read — zero cloth/prop hits outside the word "envelope" in a docstring; `rig.py` weights every region as body except the head cutoff and fingers. Work: a tag store with the job artifacts, a click-to-tag UI, and `rig.py` weighting branches (rigid single-bone weighting or exclusion for props, looser falloff for cloth). (c) Finger count (Job 4): no finger-count setting was found in the code read. `m2m_skel.py` scales fingers from the single five-finger template (`_knuckle_frac()`, leaf bones keep the template local offset scaled with the parent). Work: a five / four / three / mitten selector and matching hand templates; no alternate hand template exists in the code read. |
| Demo-only / mismatch | The demo's separate Skeleton step does not exist in the current frontend — the skeleton/dots work happens in the Rig tab's dots phase. The envelope switch, the midsection size controls, tagging, and the finger selector are new UI backed by the new backend work above, not by existing code. |

### 6. Animations: 234-clip motion library cards with looping demo previews, search + category filter, four NEW motion cards + Add a new motion, transport/scrub/speed, "Fit to character" overlay per selected clip

| | |
|---|---|
| Backend support | Substantially supported. Library data: `library/mesh2motion/clip_list.txt` has 234 lines and `library/mesh2motion/animations/` contains exactly the same 234 `.glb` files (verified by set comparison; no file is in one list and not the other). `animations.py`: `library_clips()` reads those files, labels each via `_label_from_id()` (stem with `-`/`_` → space, Title Case), groups them into families (`clip_family`, `siblings`, `family_root`). Endpoint: `GET /api/motion-library` returns the library list and count; `jobs.state()` exposes `motion_library`, `motion_library_count`, `anim_clips`, and `anim_available`. Previews: `preview_index.json` holds 221 looping MP4 preview URLs; `library_preview_url()` resolves a clip id (including through `BUILTIN_MESH2MOTION`) to a URL. On-character clips: `animations.py` `CLIPS` (12 builtins: idle, walk, mild_crouch, wave, farm_harvest, run, jump, sit, cheer, bow, clap, point; default selected `walk`); `catalog()` lists builtins first, then imports; `settings_from()` clamps speed to 0.25–3.0. Adding a library clip: `POST /api/jobs/{job}/apply-library` → `jobs.apply_library_motion()` → `_bake_motion_file()` (copies the library GLB, imports it onto the rig, adds the clip with `fit: default_fit()`). Importing a file: `POST /api/jobs/{job}/import-motion` (`.fbx` / `.glb` / `.gltf`) → `jobs.import_motion()`. Replacing builtins: `POST /api/jobs/{job}/replace-builtins` → `jobs.replace_builtins_from_library()`. Fit overlay: fully supported — `animations.py` `default_fit()` returns `{hip: 0.0, arms: 1.0, legs: 1.0, arm_space: 0.0, arm_fwd: 0.0, turn: 0.0}`; `_fit_from()` clamps hip ±0.25, arms/legs 0–1.5, arm_space/arm_fwd ±120, turn ±45 (legacy `arm_raise` maps to `arm_space`). `app.js` `mountAnimFitOverlay()` renders the overlay for the selected clip with sliders Arm-Space −120…120, Arms ↔ −120…120, Overdrive 0–1.5, Stance 0–1.5, Hip height −0.12…0.12, Turn −30…30, plus Frame scrub (30 fps), Speed 0.25–2, "Include in export", and Reset fit; dragging a slider calls `viewer.setFit()` live and keeps the clip playing (`resumePlay()`); on change, `saveAnimPatch()` posts the per-clip fit to `POST /api/jobs/{job}/anim-settings` → `jobs.set_anim_settings()` → `anims.write()` (`animations.json`). Export applies the fit: `export_pack.py` `_apply_fit_to_action()` applies arm_space / arm_fwd / arms / legs / hip / turn per clip. Transport: `viewer.play()` plays the selected clip; the overlay's Frame scrub calls `viewer.scrubTo()` and Speed calls `viewer.setTimeScale()`. |
| Backend work needed | (a) Loop closure (Job 6, still open): `viewer.play()` is `this.actions[name].reset().fadeIn(0.2).play()` with no `setLoop` call anywhere in the code read; `_evalMixerAndFit()` calls `_resetToBind()` before `mixer.update(dt)` every frame; `m2m_skel.copy_clip()` copies frames verbatim with no loop-closure frame. A demo walk that loops cleanly is demo behaviour, not backend behaviour, until Job 6 is implemented. (b) Library presentation: the current UI caps the gallery at 80 root tiles and filters by text search only (`_libFilter`); showing all 234 as individual cards and adding a category filter are UI changes (decisions 2 and 3). (c) Fit on library-only clips: a fit exists only for clips in `animations.json` (on-character clips). A library clip has no fit until it is added to the character via apply-library; the overlay must not offer fit controls for a clip that is not on the character. (d) Range note: the overlay's Hip height (±0.12) and Turn (±30) ranges are narrower than the backend clamps (±0.25 and ±45). Keep the overlay ranges; the backend accepts them. The overlay's Speed cap (2) is narrower than the backend speed clamp (3.0); keep the overlay cap. |
| Demo-only / mismatch | The animated stick-figure previews are stand-ins; real previews are the MP4 URLs (221 clips) and the initial-letter placeholder for the 13 clips without a preview URL, plus `rig/poses/{clip}_front.png` stills for on-character clips. Card names in the demo are representative; implementation must use `library_clips()` labels (decision 5). The category filter and the NEW cards have no backend source (decisions 3 and 4). "Add a new motion" as drawn has no backend equivalent; the existing equivalents are Import motion (a supplied file) and Add "clip" (a highlighted library clip). |

### 7. Upload my own on Source (image), T-pose (image), Mesh (.glb)

| | |
|---|---|
| Backend support | Fully supported. One endpoint, `POST /api/jobs/{job}/upload/{step}` (`app.py`): `source` and `tpose` go to `jobs.put_image()` (square-pad to 1024×1024; source uses a 1.1× pad, T-pose 1.0×; clears downstream steps); `mesh` goes to `jobs.put_mesh()` after the `glTF` magic check (writes the file, `normals.repair()`, enqueues `mesh_check`). Any other step is rejected ("you can't upload a {step}"). Frontend: `uploadCard()` in `app.js` renders "Use your own" with a "Choose file…" button for each of the three steps, and the viewport accepts drag-and-drop for them (`UPLOAD = {source: "image/*", tpose: "image/*", mesh: ".glb"}`). |
| Backend work needed | None. |
| Demo-only / mismatch | Mesh upload format (see change 3): `.glb` only in the backend. |

## Backend work list, ordered by dependency

1. **Decisions 2–6.** Resolve the library presentation, the category filter, the NEW cards, the card preview source, and the seed default (156863899) before implementation. The view split (item 2) gates most of the rest.
2. **Groundwork (Job 0).** Read `character_studio_agent_guidelines.md` in full; read `app/pipeline/blender/mesh.py`, `app/pipeline/tpose.py`, and `app/tests/validate_studio.py` in full; confirm the HEAD and the location of `markers.json` and what `put_markers()` accepts.
3. **Split the Rig tab into Markers / Rig / Animations views.** Add `markers` and `animations` as real views in `app.js` (`render()`, `renderView()`, `renderSide()`), moving the dots phase, the bind/play phase, and `animationsCard()` / `mountAnimFitOverlay()` into their own views. Required by the six-step bar; also required for a standalone Animations step that is not gated on the Rig tab's play phase (the overlay currently mounts only when `view === "rigflow"` and `job._rigPhase === "play"` with a rigged character).
4. **Markers: grab-to-unlock, labels option, named off-body banner (Job 1).** Replace the `solo` checkbox mechanism in `viewer.js` / `markersCard()` with viewport grab-to-unlock; add a labels show/hide option defaulting to off plus hover names; render the off-body list as a banner naming each off-body dot. Keep the existing `put_markers()` contract, the 8-marker exact-set validation, the joints path, and the `can_run` rig gate unchanged.
5. **Side-view state (Job 1b).** Verify the view-bar active state always matches the camera in markers mode; side-view drags must edit depth via `_dragPlane()` and persist through the markers endpoint like front-view drags.
6. **Animation loop (Job 6).** Check the walk clip's first and last frames in the exported GLB / in Blender; set the loop explicitly on play; loop-close `copy_clip()`; keep `_resetToBind()` from showing T-pose at the wrap. Required before claiming the demo's clean loop as real behaviour.
7. **Library cards from real data.** Build the Animations library from `GET /api/motion-library` (`library_clips()`), with labels from `_label_from_id()`, previews from `preview_index.json` (placeholder tile for the 13 clips without a URL), text search as today, and the family grouping or flat grid per decision 2. Remove the 80-root-tile cap only if decision 2 says flat; keep the "Add clip" and "Import motion" flows as they are. Do not carry the demo's stick-figure previews or representative names into the implementation.
8. **Envelopes (Job 2).** Add per-bone envelope override storage, read it in `rig.py` `paint_regions()` (defaults equal the current fixed `sigma` / band), add the SHOW ENVELOPES switch with viewport rendering of the volumes, and a size control for the picked bone, midsection first (spine/pelvis/hips). A no-override run must match the current result, and the deform QA gate must still run.
9. **Cloth/prop tagging (Job 3).** Add tag storage with the job artifacts, click-to-tag UI, and `rig.py` weighting branches for cloth and prop regions.
10. **Finger count (Job 4).** Add the five / four / three / mitten selector and matching hand templates in `m2m_skel.py`; a five-finger mesh must be unchanged.
11. **Mesh upload format.** Restrict the Mesh upload to `.glb` in the UI, matching the backend `glTF` magic check, unless a conversion step is added (not found in the code read).

## Non-goals

- No web rebuild and no Blender-free browser version.
- No overhaul of `markers.py` detection or `_match_roll` roll preservation.
- No IK, animation layering, or Motion Lab in this round.
- No change to export formats.
- No retarget path for already-rigged GLBs in this round (Job 5, deferred).
