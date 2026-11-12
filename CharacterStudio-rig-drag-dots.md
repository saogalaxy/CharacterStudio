# CharacterStudio — Rig step: placement guide chart + prove dragged dots reach the bind

Status, checked firsthand at HEAD `ed7938b9` (2026-11-12):
most of this job already landed in Cursor's two commits.
What is already in the code:

- Six-step bar (Skeleton folded into Rig). The Rig panel
  shows the skeleton on the mesh with the 27-name hover
  guide ("Hover a name to see where that dot should
  sit. Yellow is the middle, blue the left, red the
  right.").
- Every skeleton dot and joint is draggable in front,
  side, back, and free views, with mirror. Dragging a
  joint updates the joints and redraws the bones.
- On drag end the full joints map is posted to the
  markers endpoint, and the server merges the posted
  joints into the stored detection. The rig step reads
  its markers from those stored joints. The chain
  drag -> saved joints -> bind exists in code.
- Export .glb package, and marker names, fit, and
  playback are kept on the character.

## What is left

1. Show the placement guide chart itself as a reference
   in the Rig panel, next to the name list. The chart is
   `app/static/marker-placement-guide.svg` (front view
   plus side view with depth, 27 points). The name list
   alone makes the user hover one name at a time; the
   chart shows all 27 positions at once.
2. Prove by running that a dragged joint changes the
   bound mesh: drag a joint that sits off the body onto
   the body, bind, and check the bound mesh follows the
   corrected joint, not the detected one. The code path
   exists — this is a run check, not new code, unless
   the run shows the bind ignores the dragged joints.
3. Reconcile the step count: the UI bar shows six steps
   but the backend still lists seven (`STEPS` in
   `jobs.py` still has `skeleton`, and the Rig view
   drives it). Confirm the fold is intentional, or fold
   the backend step too, so the two do not drift apart.

## Verify by running

Run the app, then ask the user for a clip or
screenshot of the result. Do not use computer-use
or screen recording to verify — the user is in
front of the PC and sends the clips.

1. The chart is visible in the Rig panel.
2. Drag a dot off the body onto the body, bind,
   and the bound mesh follows the corrected joint.
3. If a listed name has no dot, or a dot has no
   name, state which one — do not mark this done.
