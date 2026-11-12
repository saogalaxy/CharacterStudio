# CharacterStudio — bind deformation calibration: make the mesh fit the animation

Goal: the bind must shape the mesh correctly through the animation.
The deformation gate must read zero tears across Idle, Walk, and
Mild crouch, and the mesh must hold together visibly in playback —
head upright, no stray line, no warping at the waist, hips, or chest.

## Baseline (run 20, job character_11e49d, 2026-11-12 08:46)

The gate has failed on all 20 binds. Run 20: Idle 32 tears at
9.979x, Walk 44 / 44 / 50 tears at 10.055x, Mild crouch 56 tears
at 16.5x. Idle tears on every run — the mesh is already tearing
at rest, before any motion plays. Walk as played is the baked
built-in clip, not the on-demand retarget.

Ruled out already: no custom envelope sizes stored (`envelopes`
is `{}` on every run), no vertices left unweighted (`unweighted`
is 0), and the 2.5 cutoff is not the problem (worst stretches
run 4.6x to 34.8x). The visible defect is the body mesh deforming
under its painted texture — the bikini is paint, not separate
cloth, so cloth tagging does not apply to it.

## Step 1 — diagnose before tuning

The log counts stretched edges only. It never counts crushed or
interpenetrating edges, and it does not name the edge or the bone.
Add tear AND crush attribution to the log in
`app/pipeline/blender/wear.py`: for each failing pose, record
which edges tear, which vertices crush or interpenetrate, which
bones those edges and vertices are weighted to, and the bone
positions at bind time. Then run one bind and report whether the
tears cluster on specific bones or spread everywhere. That decides
whether it is bad weight paint or bones sitting off the mesh. Do
not tune blind.

## Step 2 — calibrate

The levers are joint positions and envelope sizes:

- Joint positions: drag the skeleton dots on the Rig step. Sixteen
  joints already differ from the automatic pose. A drag saves the
  joints and the next bind reads them.
- Envelope sizes: every deform bone gets an envelope at bind time
  (default 0.02 times height). The six Rig sliders are overrides
  for pelvis, spine_01, spine_02, spine_03, thigh_l, thigh_r. No
  custom envelope size has ever been stored — the sliders are an
  untouched lever.

Move the joints and the envelope sizes against the gate until it
reads zero tears on all five poses. Change one thing at a time and
record what changed, so a worse result can be undone.

## Verify by running

Run the app, then ask the user for a clip or screenshot of the
result. Do not use computer-use or screen recording to verify —
the user is in front of the PC and sends the clips.

1. Bind. The gate must read zero tears on Idle, Walk, and Mild
   crouch.
2. Play Walk and Farm harvest. The mesh must hold its shape,
   head upright, no stray line, no warping at the waist, hips,
   or chest.
3. Play one library clip (not a built-in — built-ins are baked
   and never go through the retarget). It must shape cleanly.
4. If the gate still fails after the attribution step, state
   which bones the tears cluster on — do not mark this done
   from reading the code.
