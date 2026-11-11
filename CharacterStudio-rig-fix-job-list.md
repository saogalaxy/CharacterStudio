# CharacterStudio — rig fix job list (rig: fix in place; UI: overhaul)

Draft prepared 2026-11-11, from Muse's firsthand code read of
`saogalaxy/CharacterStudio` at HEAD `7d893a42` ("Initial commit of Character Studio",
co-authored by Cursor). Verdict split 2026-11-11 after screenshots + video:
**rig core: fix in place, don't overhaul. UI: overhaul — it does not match the
backend, and the markers do not work the way ActionForge's dots do.**

## What this app actually is (correction to the earlier web-rebuild sketch)

Native Windows desktop app, not a web app: Python aiohttp backend (`app/app.py`),
pywebview/WebView2 frontend (`app/static/`), headless Blender + ComfyUI runtimes
under `runtime/` (not in the repo), job pipeline in `app/pipeline/jobs.py`:
source image → T-pose → mesh → markers → rig → animations, each step owning one
artifact, changing a step clears everything after it. No root README, no package.json.
Repo guidelines: `character_studio_agent_guidelines.md`.

## What is good — do not rebuild

- `app/pipeline/blender/markers.py`: auto-detects 8 markers (chin, groin, elbows,
  wrists, knees) from mesh slices — neck as narrowest slice above the arms, groin
  where legs separate, armpit from arm-column runs, hip socket from pelvis width.
  `joints_from_markers` derives ~30 joints; spine follows the back via an inset
  depth that deliberately ignores long hair behind the torso.
- `app/pipeline/blender/m2m_skel.py`: fits the Mesh2Motion template skeleton
  (`library/mesh2motion/skeleton.glb`, UE5 bone names) onto those joints. Bone
  lengths follow the character, bone rolls stay with the template (`_match_roll`),
  so library clip quaternions still bend the same hinge. Fingers/leaf bones scaled
  from template local offsets.
- `app/pipeline/blender/rig.py`: region-envelope skinning — nearest deform bone,
  blended only with parent and child, head cut off below the neck, left/right side
  limit, max 4 influences, normalized — then a deform QA gate on idle/walk/crouch
  frames (edge tears over 2.5x stretch, max stretch) with PASS/FAIL in the rig report.
- UI (`app/static/viewer.js`, `app/static/app.js`): already ActionForge-style by
  design ("First Action Forge pass") — draggable anchor/follow landmarks, mirror,
  solo, off-body highlighting, draggable joints in the Three.js front view. Dragging
  posts to the markers endpoint, `jobs.put_markers` recomputes joints from markers
  or syncs markers from joints, and Rig is gated until nothing is off-body.

## Gaps vs ActionForge (found in the code)

1. No envelope control — zero "envelope" hits in either JS file; bind uses fixed
   `sigma = 0.02 * height` and a fixed band in `rig.py`.
2. No cloth/prop tagging — everything weighted as body except the head cutoff
   and fingers.
3. No finger detection or finger-count setting — fingers always scaled from the
   5-finger template.
4. Side view exists in code but does not show up as usable in the screenshots —
   `viewer.js` `_makeViewBar` / `setOrthoView` (Front / Left / Right / Back /
   Free, with `_dragPlane` and `onBodyAt` per view) is present, yet in the
   2026-11-11 screenshots Free is highlighted and the view is still front-on,
   and joint depth is still auto-inferred by `_inset_y` with no clear side-view
   depth edit. Treat as a UI-parity bug to verify/fix, not a missing feature.
5. No already-rigged import path — every mesh is re-rigged to the Mesh2Motion
   template; no keep-skeleton / bone-mapping option.
6. No IK, layering, or Motion Lab in the rig section — fit controls are degree
   offsets (arm-space, arm-forward) over a sampled mixer pose.
7. UI parity breaks visible in the 2026-11-11 screenshots (and confirmed in code):
   the top bar shows 4 steps (Source / T-pose / Mesh / Rig) while the backend
   has 6 steps (`source, tpose, mesh, markers, rig, animations` in `jobs.py`);
   Mesh shows "done" while Source and T-pose show "not done", which the backend
   `can_run` chain does not explain; `app.js` renders two stacked "Dots" cards
   (one with "Place dots again", one from `markersCard` with "Reset markers" /
   "Bind & wear" and the same help text twice); joint labels pile up with no
   offset or leader line — shoulder/elbow/wrist, hip/pelvis, knee, and ankle
   labels all stack on each other; the 14 UI landmarks in `viewer.js` do not
   match the 8 backend markers in `markers.py`, and the follow-dot checkboxes
   (locked vs unlocked) read as incomplete items.
8. Markers do not work like ActionForge's dots — seen in the user's 2026-11-11
   video (job "anime", ~4 min, watched firsthand) and confirmed in code
   (`viewer.js` `LANDMARKS`, lines 47–62; drag handler ~1138–1165):
   - Auto-place puts the pelvis/groin dot low, between the thighs below the
     hip dots, and the hip dots out on the thighs; knees/ankles sit close
     together because the legs are together, so the skeleton reads as off
     even though most dots are roughly on the body.
   - White follow dots (elbow, hip, knee) are not draggable at all by
     default: `s.userData.drag = !follow || solo.has(spec.id)`, and solo
     is only set by ticking that dot's checkbox in the right panel.
     CORRECTION (user, 2026-11-11, firsthand): they DID try to tick the
     boxes and the boxes did not tick — my earlier read that "no follow
     dot is ever unlocked" implied they never tried, which was wrong.
     The code path looks like it should work (`markersCard` onchange
     sets `job._markerSolo`, calls `viewer.setSolo`, then `renderSide()`;
     `carryClient` preserves `_markerSolo` across polls), so a tick that
     does not stick is a real bug to reproduce, not a usage error — or
     the click target is the green ✓ status mark next to the box, which
     does nothing. Either way, tick-to-unlock is bad UI: the shoulder
     (an anchor) moves freely with no tick at all, so the panel implies
     a gate that does not apply to half the dots and does not work for
     the other half.
   - Labels sit on top of the dots (`.label` is `transform: translate(10px,
     -50%)` with no per-dot offset, so stacked labels cover neighbouring
     dots). CSS says `pointer-events: none`, so a label should not eat a
     click in theory — but visually it hides the dot underneath, so a
     clean grab is impossible: you cannot see or aim at the dot you are
     trying to click.
   - Orange anchor dots drag their followers with them: shoulder drags
     elbow, groin/pelvis drags hip_l, hip_r, knee_l, knee_r
     (`follow: ["hip_l", "hip_r", "knee_l", "knee_r"]`). There is no way
     to move one joint alone without first unlocking it, and no way to
     move the pelvis without moving both hips and both knees.
   - Labels have no offset/leader, so shoulder/elbow/wrist and
     hip/pelvis/knee labels pile on top of each other; in the video the
     user zooms in on the pelvis, then on the right arm, tries a drag,
     the status flips to "skeleton adjusted", and the dots barely move —
     then gives up and hits Bind & wear. The rig then runs and the walk
     plays with a deformation check PASS, so the bad marker UX is not
     blocking the bind, it is just unfixable in the UI.

## Target behaviour — follow ActionForge, don't invent a new interaction model
(user decision, 2026-11-11: "the UI should follow ActionForge behavior")

From ActionForge's own help docs, read firsthand 2026-11-11
(`actionforge.app/help/main-page`):

1. **Place dots:** orange dots are the ones you drag — chin, shoulders,
   wrists, groin, ankles. White dots find themselves on the mesh —
   elbows, hips, knees, fingertips. Height and finger count are set here.
   A dot is validated (e.g. knee must sit between groin and ankle) and
   Rig stays greyed out while a dot is wrong.
2. **Skeleton:** built from the dots; joints can be dragged and fixed from
   Front / Side / Back / Free views. Parts can be tagged Cloth or Prop
   (untagged = body). Bone envelopes can be shown and resized, and they
   decide the bind weighting. Detect fingers is five-finger only.
3. **Bind & wear:** the mesh is weighted to the skeleton in the background,
   then the character plays animations. Re-rig re-opens at the skeleton
   step — move dots/joints, retag, rebind.

That is the spec Job 1–3 must match. CharacterStudio today inverts it:
its white dots are locked behind a checkbox that does not tick, its
orange dots drag a whole chain, and it has no separate dots → skeleton
step — the two are collapsed into one panel with a checklist. The fix
is to copy the AF model, not to invent a third model.

Seen live in the user's second ActionForge demo (2026-11-11, ~114 s,
"Demo of the dots being moved"):
- Labels are hover-only, not permanent. At ~21 s hovering the right
  elbow shows "Elbow (R)"; at ~76–82 s hovering the groin shows
  "Groin". The rest of the time the dots are bare — no label pile-up,
  nothing covering a dot you need to grab. CORRECTION (user,
  2026-11-11): labels should be an option to show if you want to see
  what a dot is called, not a necessity — so the fix is a labels
  show/hide option, default off, not mandatory hover-only and not
  permanent labels.
- The orange groin dot moves alone. At ~30–39 s it is dragged down
  and back up the centre line while the hips and knees stay put —
  the opposite of CharacterStudio, where dragging the pelvis drags
  both hips and both knees with it. CORRECTION (user, 2026-11-11):
  on the first dots, white does move with the orange — that follow
  behaviour is what CharacterStudio also does, and is not the bug.
  The difference is the unlock: a white dot can turn orange if it
  needs adjusting, by grabbing/selecting it in the viewport, with
  no checkbox in the side panel.
- Validation names the dot. After the groin is dragged off the body,
  the RIG IT panel shows a red banner: "The groin dot isn't on the
  body – drag it onto the groin." Rig is blocked until that named dot
  is back on the mesh — not a generic "binding stays locked" message.
- Dots and skeleton are separate panels. Dots: RIG IT instructions
  1–5, Height 1.80 m, TURN LEFT / TURN RIGHT, Fingers Five,
  DETECT FINGERS, MIRROR LEFT AND RIGHT, RESET DOTS, RIG. Skeleton:
  FRONT / SIDE / BACK / FREE, DETECT FINGERS, Cloth/Prop tagging,
  Envelopes / SHOW ENVELOPES, MIRROR, SHOW ONE SIDE, SHOW BONE AXES,
  BACK TO THE DOTS, RIG & WEAR.

9. Animation preview loops with a T-pose flash at the end of a loop
   (user, 2026-11-11, firsthand — not yet in the list before this):
   the preview gets to the end of a play loop and shows T-pose, instead
   of looping as continuous motion. Read firsthand 2026-11-11 in
   `viewer.js`, `app.js`, `animations.py`, `rig.py`, `m2m_skel.py`
   at HEAD `7d893a42`:
   - No loop is ever set: zero `setLoop` / `LoopRepeat` / `LoopOnce`
     hits in `viewer.js`, `app.js`, or `animations.py`. `play()` is
     `this.actions[name].reset().fadeIn(0.2).play()` (`viewer.js`
     ~615–622) — it relies on Three.js's default, which is LoopRepeat,
     and never says "loop this" explicitly. The only `loop = true` in
     the app is the library-tile video preview (`app.js` line 819),
     not the 3D viewer.
   - Every frame, `_evalMixerAndFit()` calls `_resetToBind()` first,
     then `mixer.update(dt)` (`viewer.js` ~363–370). So any bone the
     clip does not write, or any moment the mixer is not writing, is
     shown at bind / T-pose by design.
   - `copy_clip()` (`m2m_skel.py` lines 216–285) copies the source
     clip's frames verbatim, `frame_start..frame_end` inclusive,
     with no loop-closure frame — the last keyed frame is not the
     first pose again, so a wrap snaps from the last pose back to
     the first, and if that first pose is near rest it reads as a
     T-pose flash.
   - `rig.py` leaves the rig on `idle` at frame 1 before the GLB
     export (lines 218–220), so the file's resting pose is idle
     frame 1.
   Not proven yet from code alone: whether a given clip's first
   frame is actually T-pose, or whether the flash is the wrap snap,
   the bind-reset, or both. That needs checking the walk clip's
   first/last frames in the exported GLB / in Blender, not guessing.

## Job 0 — Groundwork (before any fix)

- Read `character_studio_agent_guidelines.md` and follow it.
- Read `app/pipeline/blender/mesh.py`, `tpose.py`, and `validate_studio.py` in full
  (not read in the verdict pass) — confirm how markers/rig artifacts are stored
  and validated before touching them.
- Confirm HEAD is still `7d893a42` or record the new HEAD if the repo moved.
- Done when: the agent can state where `markers.json` lives, what `put_markers`
  accepts, and what clears downstream steps when markers change.

## Job 1 — Markers: make a dot move the dot you grabbed (do first; this is the
video's complaint)

Why: today a white dot cannot be dragged at all, an orange dot drags a whole
chain, and the labels hide which dot is which — so the auto-place errors
(pelvis low, hips wide) cannot be corrected in the UI.

- `app/static/viewer.js` / `app/static/app.js`: make every landmark draggable
  by default (follow dots included), with the follow/anchor behaviour as an
  explicit, visible mode, not a hidden checkbox — e.g. dragging a follow dot
  moves only that dot, dragging an anchor moves it plus its followers only
  while a modifier / toggle is held, or vice versa, matching the help text
  that is actually shown. Drop the tick-to-unlock checkbox entirely: the
  shoulder moves with no tick, the follow-dot tick does not stick when
  tried (user, 2026-11-11), and the green ✓ next to each row is a status
  mark, not a control, so the panel currently has two tick-like things
  per row and neither unlocks a dot reliably. The right-panel list must
  say "draggable", not "— locked", and a dot being draggable must be
  visible in the viewport (ring on the selected dot), not only in a
  checkbox. Follow behaviour itself is correct and matches ActionForge
  (white moves with orange on the first dots); the unlock is what is
  wrong — in ActionForge a white dot turns orange when it needs
  adjusting, by grabbing it in the viewport.
- Labels: an option to show them, default off, not a necessity. Hover
  shows a dot's name ("Elbow (R)", "Groin"); turning labels on shows
  them all if you want to see what they are called. No permanent
  labels by default — permanent labels are what pile up and cover
  the dot you need to grab. `pointer-events: none` in CSS is not
  enough — the label still hides the dot visually.
- Reconcile the 14 UI landmarks with the 8 backend markers: a drag of a
  landmark that has no backend marker (shoulder, hip, ankle) must still
  persist via `jobs.put_markers` joints path, and a drag of a marker
  (chin, groin, elbow, wrist, knee) must recompute joints the same way
  today; do not silently drop a drag.
- Done when: in the video's exact scenario, the pelvis can be raised to
  hip height without moving the knees, an elbow can be moved alone without
  moving the shoulder/wrist, and "skeleton adjusted" reflects the dot that
  was actually moved. No new validation errors from a single-dot edit.

## Job 1b — Side view: verify/fix the existing view bar (with Job 1, not "add")

Why: side view exists in code (`_makeViewBar` / `setOrthoView`, `_dragPlane`,
`onBodyAt`) and in the video the Front/Left/Right/Back buttons do rotate
the character (side-on at ~3:54 in the video), but in the earlier screenshots
Free was highlighted while the view stayed front-on.

- Verify the view-bar active state always matches the actual camera, in
  markers mode as well as anim mode; fix the state that let Free show as
  selected on a front-on view.
- Dragging in a side view must edit depth (`_dragPlane` per view) and persist
  via the markers endpoint exactly like a front-view drag.
- Done when: a spine/neck/hip joint can be dragged in depth in side view,
  the change persists in `markers.json`, front view shows the same joint,
  and a re-rig reflects the corrected depth.

## Job 2 — Per-bone envelope size (do second) — scoped to the midsection first

Why: bad weights show first at shoulders, hips, and neck, and today the bind
sigma/band are fixed constants.

SCOPE CORRECTION (user, 2026-11-11, from the ActionForge demo): the only
part they really have to adjust is the midsection. In the ActionForge
photo the midsection envelope is the translucent volume around the
spine/pelvis; in the demo video the control is in the Skeleton step,
under Cloth/Prop: "Envelopes — SHOW ENVELOPES — The space each bone
moves, and how big it is", with MIRROR LEFT AND RIGHT, SHOW ONE SIDE,
and SHOW BONE AXES beside it. CORRECTION to my last message: the user
did toggle that switch and it showed the envelopes — that is a UI
toggle to add in CharacterStudio, not just a backend size value.
Job 2 therefore starts with spine/pelvis/hip envelopes only, not every
bone, and with a SHOW ENVELOPES switch that actually shows them.
White-dot note (user, 2026-11-11): in the demo the white dots were
already in the correct spot for the limbs, so no white-dot drag was
needed — the absence of a drag in the video is not evidence a white
dot cannot be dragged.

- `app/pipeline/blender/rig.py`: replace the fixed `sigma = 0.02 * height` /
  fixed band with per-bone overrides read from `markers.json` (via
  `paint_regions`); when no override is set, behaviour must be identical to
  today — defaults equal the current fixed values.
- UI: a SHOW ENVELOPES switch (as in ActionForge — toggling it shows the
  envelope volumes in the viewport) plus an envelope-size control for
  the picked joint. Start with spine/pelvis/hips only — the midsection;
  other bones use the default.
- Done when: changing a midsection envelope changes the weights in the rig
  report and the deform QA gate still runs (idle/walk/crouch, PASS/FAIL
  recorded); a run with no overrides produces the same result as before
  the change.

## Job 3 — Cloth / prop tagging

Why: a cape, skirt, sword, or long hair currently gets weighted the same as a limb.

- UI: click a mesh part in the viewer and tag it Cloth, Prop, or Body (untagged
  = Body); store the tag with the job artifacts (alongside `markers.json`).
- `app/pipeline/blender/rig.py`: props get rigid weighting to one bone (usually
  a hand) or are excluded from deform; cloth gets a looser falloff than body.
- Done when: on a test mesh, a tagged prop follows its bone without stretching
  and a tagged cloth region no longer trips the QA tear gate the way it did as
  body. Untagged meshes rig exactly as before.

## Job 4 — Finger count

Why: a 4-finger or mitten character gets wrong fingers from the 5-finger template.

- UI: finger-count setting — five, four, three, mitten (same options ActionForge
  offers).
- `app/pipeline/blender/m2m_skel.py`: pick the matching hand template instead of
  always scaling the five-finger one; validate the count against the mesh where
  possible.
- Done when: a mitten / 4-finger test mesh gets the matching hand, and a
  five-finger mesh is unchanged.

## Job 5 — Retarget path for already-rigged GLBs (defer; separate feature)

Only after Jobs 1–4. Add a keep-your-skeleton option: bone-name matching plus a
manual bone-map table, retargeting by storing each source bone's rest-pose offset
against the Mesh2Motion template and copying rotations through it. Do not start
this as part of the rig fix — it is a new import path, not a repair.

## Job 6 — Animation preview: loop as continuous motion, no T-pose flash

Why: the preview hits the end of a loop and flashes T-pose (user,
2026-11-11). A walk that snaps to T-pose every cycle is not a loop.

- First, check the clip, not the viewer: in the exported
  `rigged_animated.glb` / in Blender, compare the walk clip's first
  and last keyed frames. If they do not match, the clip is not
  loop-closed and no viewer setting will fix the snap.
- `app/static/viewer.js`: set the loop explicitly on play —
  `action.setLoop(THREE.LoopRepeat, Infinity)` — instead of relying
  on the Three.js default; do not use LoopOnce / clampWhenFinished.
- `app/pipeline/blender/m2m_skel.py` `copy_clip`: loop-close the
  copied clip — copy the first frame again as the final frame (or
  trim to a true cycle), so the last pose blends back into the first
  instead of snapping.
- `viewer.js` `_evalMixerAndFit`: keep `_resetToBind()` from showing
  T-pose at the wrap — bones the clip does not write must hold their
  last mixer pose across the wrap, not fall back to bind.
- Done when: walk (and idle) play in the preview for several cycles
  with no T-pose frame at the wrap, and the scrub/frame counter
  wraps from the last frame to frame 1 without a jump in pose.

## Non-goals for this round

- No web rebuild (the Vite + TypeScript + React + Three.js sketch does not
  describe this app) and no Blender-free browser version.
- No overhaul of `markers.py` detection or `_match_roll` roll preservation.
- No IK, animation layering, or Motion Lab in this round.
- No change to export formats.

## Caveats

- Code-read verdict, not a run verdict: Muse did not run the app (the Windows
  Blender/ComfyUI runtime is not in the repo and not on Muse's machine) and did
  not read `mesh.py`, `tpose.py`, or `validate_studio.py` in full. The video
  was watched firsthand (2026-11-11, job "anime", ~4 min) and the marker
  drag behaviour above was matched against `viewer.js` at HEAD `7d893a42`;
  the cursor is not visible in most 1-second frames, so which exact dot was
  grabbed in each zoomed attempt is inferred from the dots' movement and
  the code, not seen directly.
- The public/logged-out GitHub page for the repo returns 404 (private repo);
  Muse's GitHub connector read access was verified firsthand — do not treat the
  web 404 as the repo not existing.
- Respect the pipeline invalidation rule: changing markers clears rig and
  animations downstream; each job's test should re-run from the markers step.
