# CharacterStudio — state report

Update this file when the app's state changes. A new window should
read this instead of relying on chat. Check the claims against the
code and the job files named below. Do not mark a run as done here
unless it was actually run.

Observed 2026-11-12, commit `1e17143`, job `character_11e49d`
("Character") at `jobs/character_11e49d`. The app was opened and all
six steps were clicked. Nothing was uploaded, generated, placed,
dragged, bound, played, or exported in that pass.

## How to read a later change

Replace the "Observed" line with the new commit and time. For each
step, say what is on disk, what the panel showed, and what was not
run. If a bind log changes, replace the deformation table from
`jobs/<id>/logs/rig.txt` rather than editing numbers from memory.

## Job files

Present: `job.json`, `markers.json`, `mesh.glb`, `mesh_check.json`,
`surface.npy`, `logs/rig.txt`, `logs/markers.txt`, `logs/mesh_check.txt`.

Absent: source image, T-pose image, `rig/` (no `rigged_animated.glb`),
`animations.json`, export log.

Live API at the time of the check: one job. `skeleton_seen` true.
`running` null. `can_run`: source yes, tpose no, mesh no, markers yes,
skeleton yes, rig yes, animations no. `off_body` and `joints_off_body`
empty. `animations` null. Motion library: 234 clips.

`markers.json`: 8 markers, 28 joints, `fingers` is `five`. Joints
match `joints_auto` (no dragged offset stored). `finger_tips` is
still present for all ten digits and was not cleared by the reset.
`envelopes` in the bind log is `{}` on every run.

## Per-step state

The bar shows six buttons: Source, T-pose, Mesh, Markers, Rig,
Animations. After Animations, Source had no search box and no fit
or playback dock. Rig had no motion search and no fit dock. Each
step's panel held only its own controls.

### Source

Panel is only "Upload my own." Step state `empty`. No source image.
Generation from a picture was not run.

### T-pose

Panel has Standard / 2.5D / Custom prompt, "Generate T-pose," and an
upload. Generate is disabled because there is no source image. Step
state `empty`. No T-pose picture. Generation was not run.

Settings stored on the job are method `standard` and the default
T-pose prompt.

### Mesh

`mesh.glb` is present (10,867 vertices in the stored check). Step
state `done`, message "mesh check passed." The panel shows that
stored check, every line a pass:

- has geometry — 10,867 vertices
- one main body — 1 mesh object
- T-pose arms — arm span 0.89 / height 1.00
- head present — 869 vertices in the top
- markers found — body is large enough to place dots
- textured — textured

"Generate mesh" is disabled because there is no T-pose. Upload is
available. The mesh was not regenerated and the check was not rerun.
Mesh settings: preset `optimized`, 60,000 triangles, seed mode
`default`, seed `156863899`.

### Markers

Step state `done`, message "reset adjusted." Panel is "Place dots"
and "Reset dots." No off-body banner. The stored joints match the
automatic pose, so the file does not hold a dragged joint. Dots were
not placed or dragged in this check.

### Rig

The skeleton draws on the mesh. The panel lists 27 joints and does
not list finger names. It has Show skeleton, Show envelopes, six
envelope sliders (pelvis, spine_01, spine_02, spine_03, thigh_l,
thigh_r), the five/four/three/mitten choice (set to five), and
Bind & wear, which is enabled. View buttons stay on the stage.
Bend / Twist / Swing stays hidden until a dot is picked.

`app/static/marker-placement-guide.svg` exists and is not shown.
Nothing in `app/static` references that file.

Joint dots are drawn. The drag handler treats them as joints
(`stage.js` kind `"joint"`, pointer-up posts the joints). A drag
was not performed. A drag would save the joints and delete the rig
(`put_markers` pose edit calls `clear_after("skeleton")`). The next
bind reads those joints in `wear.py` `fit_bones`. That bind was not
run. The rig folder is gone.

Saved finger tips remain in `markers.json` from before the reset,
separate from the joints.

Server step state: `skeleton` is `done` ("skeleton on the mesh"),
`rig` is `empty`.

### Animations

Panel says to bind on Rig before a motion can play. The library
lists 234 clips, with search, a family menu, import, and + / − on
the cards. "Export .glb" is disabled. No saved-motion row, no play
dock, no fit card. No `animations.json`, no rig file. No clip was
played and no fit slider was moved.

Step state `empty`. `can_run.animations` is false.

## Six buttons, seven server steps

The UI list in `app/static/studio.js` is source, tpose, mesh,
markers, rig, animations. The server list in `app/pipeline/jobs.py`
is those six plus `skeleton`. Both were confirmed on the running
app: the bar has six buttons, and `/api/jobs` returns seven step
keys.

Skeleton is not a button. Rig uses it. The status line "skeleton on
the mesh" is the skeleton step's message, and Bind is allowed only
when `skeleton_seen` is set (`can_run.rig` requires markers, seen,
and no off-body joints). The server list was not folded. The note
in `CharacterStudio-rig-drag-dots.md` still says to reconcile the
two.

## Retarget, export, fit

Retarget on Walk and a second motion was not played. There is no
rig to play. In `stage.js`, `playClip` uses an action already in
the loaded rig as stored. `_retargetClip` runs only for a library
clip that is not already an action on that rig. Built-in clips are
copied onto the rig at bind by `wear.py` `copy_clip` as local
rotations. The only Walk evidence on disk is the bind log below,
and every one of those checks failed.

Export .glb was not run. The button is disabled. There is no rig,
no saved clips, and no export log. `jobs.py` `export_package`
refuses to run without a rig and at least one saved clip, then
calls `pack.py`.

Fit and playback are not on this character. Both are created only
on Animations, and only after a rig exists (`ensureFit`,
`mountTransport`). Fit is stored per clip in `animations.json`
through `anim-settings`. Nothing is saved, and neither control was
on screen.

## Deformation checks

Source: `jobs/character_11e49d/logs/rig.txt`. Nineteen `STEP deform_qa`
lines. No `PASS`. The rig those binds wrote is no longer on disk.
These checks were not rerun.

The check is `deform_gate` in `app/pipeline/blender/wear.py`. It
samples 4,489 edges. For each edge it divides the posed length by
the rest length of the unbound mesh. A tear is an edge longer than
2.5 times its rest length. `max_stretch` is the worst ratio in the
sample. The bind fails if the sum of tears across the five poses
is not zero. The poses are always Idle frame 30, Walk frames 1, 9,
and 25, and Mild crouch frame 20. The same log line says Walk was
copied as 40 frames and Mild crouch as 88, so those frames are
inside the clips.

The log does not name the edge or the bone. It does not record
bone positions. It only counts lengthening past 2.5; it does not
count crushed edges.

Every pose in every run is over 2.5. The quietest result is still
Idle at 4.606 times and Mild crouch at 8.459 times, with Walk
frame 25 at 7.658 times on that same run. The 2.5 cutoff is not
what fails these.

The weight line beside each run is `STEP weights`. `unweighted` is
0 and `envelopes` and `tags` are `{}` on all 19. No vertex was left
without a weight, and no custom envelope size was stored. The
default radius `(0.02 * height)` is not printed. Finger weight and
head weight are sums of the weights painted onto those bones, not
vertex counts. Those weights are computed from the bone positions.

| Run | Idle 30 | Walk 1 | Walk 9 | Walk 25 | Mild crouch 20 | Finger weight | Head weight |
|---|---|---|---|---|---|---|---|
| 1 | 82 tears, 22.302× | 70, 21.128× | 78, 21.003× | 89, 21.437× | 95, 34.819× | 181.7 | 1193.3 |
| 2 | 50, 19.835× | 55, 15.657× | 57, 15.586× | 66, 15.829× | 75, 23.523× | 181.7 | 1265.5 |
| 3 | 36, 7.973× | 43, 9.632× | 43, 8.774× | 49, 7.378× | 54, 10.71× | 181.7 | 1418.1 |
| 4 | 29, 6.948× | 40, 6.664× | 37, 7.43× | 38, 10.275× | 60, 11.65× | 181.7 | 1668.1 |
| 5 | 31, 6.938× | 40, 6.673× | 37, 7.445× | 38, 10.302× | 65, 11.539× | 181.7 | 1678.0 |
| 6 | 31, 6.938× | 44, 6.673× | 41, 7.445× | 42, 10.302× | 64, 11.539× | 327.5 | 1678.0 |
| 7 | 35, 6.938× | 40, 6.673× | 37, 7.445× | 36, 10.302× | 64, 11.539× | 85.1 | 1678.0 |
| 8 | same measured result as run 7 | | | | | 85.1 | 1678.0 |
| 9 | 31, 6.938× | 36, 6.673× | 33, 7.445× | 34, 10.302× | 64, 11.539× | 121.2 | 1678.0 |
| 10 | 30, 4.606× | 36, 5.932× | 31, 5.896× | 33, 7.658× | 50, 8.459× | 121.2 | 1678.3 |
| 11 | 34, 4.606× | 35, 5.932× | 32, 5.896× | 34, 7.658× | 55, 8.459× | 121.2 | 1677.4 |
| 12 | 32, 6.887× | 33, 5.932× | 34, 5.973× | 35, 7.756× | 56, 9.085× | 121.2 | 1517.1 |
| 13 | 35, 7.619× | 34, 8.206× | 36, 7.838× | 39, 10.922× | 56, 10.912× | 121.2 | 1505.2 |
| 14 | 85, 13.157× | 82, 12.606× | 86, 13.954× | 95, 15.390× | 129, 15.174× | 121.2 | 1377.4 |
| 15 | 74, 13.15× | 71, 10.845× | 71, 11.778× | 79, 11.525× | 112, 11.697× | 121.2 | 1152.0 |
| 16 | 70, 29.003× | 79, 22.487× | 81, 22.751× | 85, 25.637× | 115, 29.888× | 121.2 | 1257.5 |
| 17 | same measured result as run 16 | | | | | 121.2 | 1257.5 |
| 18 | same measured result as run 16 | | | | | 121.2 | 1257.5 |
| 19 | 80, 29.003× | 101, 23.888× | 104, 23.888× | 106, 25.637× | 124, 29.888× | 752.2 | 1257.5 |

Runs 7 and 8 match. Runs 16, 17, and 18 match. Those repeats saw
the same deformation.

Idle fails on all 19, from 29 tears to 85. Walk and Mild crouch are
worse than Idle on the same run, but the mesh is already tearing on
Idle. The last run is the clear weight change: finger weight goes
from 121.2 to 752.2 while head weight stays 1257.5, and Walk goes
from about 80 tears to 101–106. Runs 4 through 9 keep the same worst
Idle stretch (6.938×) and Walk frame 1 stretch (6.673×) while finger
weight swings from 85.1 to 327.5 and the tear counts only shift by a
few edges. Run 10 then drops the worst stretch with almost no change
in those two sums. The log does not say what else changed.

The log shows the skinning result tearing. It does not separate a
bad weight paint from bones sitting off the mesh, because the
weights are painted from the bone positions and the positions are
not stored. It rules out custom envelope sizes, vertices left
unweighted, and a too-strict 2.5 cutoff.
