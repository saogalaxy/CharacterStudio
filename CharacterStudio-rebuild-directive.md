# CharacterStudio — rebuild directive: complete the rig flow, no partial changes

Scope: the rig flow in `saogalaxy/CharacterStudio` — Source, T-pose, Mesh,
Markers, Rig, Animations — rebuilt to match the specifications already in
the repo, with each change finished and verified before the next begins.

## Specifications to follow, in order

1. `CharacterStudio-rig-fix-job-list.md` — Jobs 0–6, in order.
2. `CharacterStudio-ui-changes.md` — demo UI changes, six-step top bar
   decided: Source, T-pose, Mesh, Markers, Rig, Animations.

No change is complete until its Done-when in those files is met and
verified by running the app on the same job, not by reading the code
after editing it.

## New defect to fix in the same rebuild (2026-11-11, job "anime")

Repro, watched firsthand in two videos:

- Markers step: T-pose, face normal, dots appear on the body in front
  view. Chin dot hover shows "chin".
- Bind & wear: viewport goes black for about 44 seconds while the rig
  runs, then the app goes straight into playing an animation. There is
  no bind-pose stop to inspect the skeleton before a motion drives it.
- Walk: head bent forward and down, hair covering the face, no face
  visible front-on. A long thin line shoots from the upper back/shoulder
  diagonally up-right to a small ring far off the body, and stays there
  for the whole walk.
- Farm harvest: same head bent down, same stray line, now shooting
  up-left from the head/spine to a ring far off the body, swinging as
  the character moves. Same defect on a different motion, so it is not
  a Walk clip problem.

Cause to verify, not assume: markers pass the off-body check in front
view only. Depth is guessed, not measured — spine/neck depth comes
from an inset guess inside the body (`markers.py`, `_inset_y`) — and
side view is the place a dot floating in front of or behind the mesh
would be caught. A dot can look on the mesh from the front, pass the
check, and still not be on the mesh in 3D. That is the defect to
prove or disprove with a 3D check, not a front-view screenshot.

Fix required:

- Markers verified in 3D depth, not front view only: a marker's
  position must be checked against the mesh in side view as well as
  front view, and the off-body check must fail a marker that is off
  the mesh in depth. A drag in side view must edit depth and persist
  via the markers endpoint exactly like a front-view drag.
- Bind stops at the bind pose: after Bind & wear finishes, the
  character holds the bind pose with the skeleton visible and does
  not auto-play an animation. Animation plays only when chosen.
- Done when: the same job, re-run from Markers, holds a correct
  bind pose with the head upright and no stray line, and Walk and
  Farm harvest both play with the head upright, the face visible,
  and no line off the body.

## Rules for this rebuild

- Work Jobs 0–6 and the UI changes in order. Do not start a later job
  while an earlier job's Done-when is unmet.
- Do not change the rig core to work around a UI defect: no overhaul
  of `markers.py` detection or `_match_roll` roll preservation.
  Fix the markers, the depth check, and the bind-pose stop instead.
- No partial change counts as done: a control added without its
  backend wiring, a switch that does not show what it claims to show,
  a drag that does not persist, or a panel that looks finished but
  does not run, is not a completed job.
- Every job ends with a run of the app on the same job, from the
  step that job changed, through Bind & wear and at least two
  motions. Record what was run, what passed, and what still fails.
  A job with no run is not finished.
- Do not claim a defect is fixed on a front-view screenshot alone.
  The head and stray-line defects above are only visible in motion
  and in side view.
- If a Done-when cannot be met, state which one, what was tried,
  and what blocks it. Do not mark it done and move on.

## Non-goals for this round

- No web rebuild and no Blender-free browser version.
- No IK, animation layering, or Motion Lab in this round.
- No change to export formats.
- No retarget path for already-rigged GLBs in this round; that is a
  separate feature, after Jobs 1–4.
