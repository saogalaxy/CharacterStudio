# CharacterStudio — skeleton lines visible, each step owns its overlay

Defect (from the run video): the Skeleton step shows joint dots
but the bone lines are not visible, and the marker dots sit on
the mesh in steps where they do not belong. The lines exist in
the scene; the mesh hides them. The overlays are never cleared
when the step changes, so dots leak into Skeleton, Rig, and
Animations.

## Fix (already written into `app/static/stage.js` and `app/static/studio.js`)

- `stage.js`, `setBones`: the bone lines now draw through the
  mesh (`depthTest: false`, `renderOrder = 5`), the same way the
  joint dots already do. The lines run between the joints, so
  they were hidden inside the body before this change.
- `stage.js`, `setDots`: placing the marker dots now removes
  the bone lines. Markers shows dots only.
- `stage.js`, new `clearOverlay`: removes dots, labels, bone
  lines, and envelopes. It runs on every `clearModel`, so
  loading a new model (mesh or rigged character) never carries
  the previous step's overlay with it.
- `studio.js`, `syncStage`: a step with nothing to show
  ("empty") now clears the stage instead of leaving the last
  overlay on screen.

## Verify by running

Pull, start the app with `CharacterStudio.bat`, and check on
the job, in order:

1. Markers: orange and white dots only, no bone lines.
2. Skeleton: blue joints joined by visible bone lines, in
   front, side, back, and free views. No marker dots.
3. Rig before binding: plain mesh, no dots, no lines.
4. Animations: the character playing, no dots, no lines.

Record the run on video. If any of the four does not hold,
state which one and what is on screen instead. Do not mark
this done from reading the code.
