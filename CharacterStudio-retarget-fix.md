# CharacterStudio — motions are not retargeted: clip applied raw

Defect (user, motion playing): the character moves when a
card is picked, but the mesh does not shape correctly.

Cause, confirmed firsthand: nothing in the code retargets.
Zero hits for "retarget" in `stage.js`, `studio.js`,
`motions.py`, `wear.py`, `jobs.py`, and `app.py`.
`stage.js` `playClip` loads the library clip and applies
its tracks to the character's rig exactly as stored —
the template skeleton's rotations and bone positions,
with no correction for the character's own bind pose
and proportions.

## Fix (already written into `app/static/stage.js`, `_retargetClip`)

`playClip` now retargets the cloned clip before playing
it:

- Rotation tracks: each keyframe is corrected by the
  bind-pose offset between the template bone and the
  character's bone — target bind times the source's
  rotation relative to its own bind. At the bind pose
  the character stays exactly at its own bind; the
  motion transfers relative to it. The offset math was
  tested against the real three.js Quaternion class
  (bind identity, relative-rotation transfer,
  same-bind no-op).
- Position tracks: the template's bone positions are
  dropped for every bone except `root`, which is kept
  and scaled by the character-to-template height
  ratio. Template positions would otherwise pull the
  character's bones to template proportions. Scale
  tracks are dropped; the character keeps its own
  bone lengths.
- The source bind is read from the clip file's own
  skeleton at load time. If a clip file carries no
  skeleton, the clip is left as it was — no worse
  than before.
- Clips already baked into the rigged file (the
  built-ins) are untouched; only on-demand library
  clips go through this.

## Verify by running

Pull, start the app, and on the job:

1. Pick a Walk card. The character must walk with
   clean shaping — no bent head, no stretched limbs,
   feet on the ground.
2. Pick a second, different motion (for example Farm
   harvest). Same bar: it must shape correctly.
3. If a motion still misshapes, record which card and
   what the mesh does — do not mark this done from
   reading the code.
