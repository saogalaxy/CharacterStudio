# CharacterStudio — jiggle physics mode

Goal: a jiggle physics mode the user can turn on when they want
it, and the app shows it playing in the viewer.

## What it is

Spring-bone secondary motion: a chain of bones (hair, chest,
loose parts) simulated at playback, driven by the primary
skeletal motion. The bind paints the weights; jiggle is separate
— it moves the bones after the clip does, while the animation
plays. It is a runtime effect, not part of the bind.

## Toggle

- A switch in the Animations panel, "Jiggle physics", off by
  default, stored per job.
- Off: playback is the plain baked clip, exactly as today.
- On: the marked chains jiggle while the clip plays.

## Which bones jiggle

- The user marks jiggle chains in the Rig panel, one tag per
  bone, the same shape as the cloth/prop tagging the backend
  already stores. A chain is a bone and the bones below it.
- No chain is marked by default. Nothing jiggles until the user
  marks a chain and turns the switch on.

## Simulation

- Runs in the viewer (three.js) per frame during playback.
- Each chain is a spring simulation driven by its parent bone's
  motion, with stiffness and damping. Fixed defaults to start;
  sliders to tune them come later, not in this job.
- The simulation must not move any bone that is not in a marked
  chain, and must not change the clip itself.

## Export

Out of scope for this job. The exported GLB plays the baked clip
without jiggle — GLB has no spring-bone standard. Carrying jiggle
on a VRM export is a later job.

## Order

The user wants this job next, ahead of the bind calibration.
Note: the bind is not yet proven (gate still FAIL, Walk close-up
still fails), so jiggle will be verified on a mesh that still
stretches — the stretch will show through the jiggle. Judge the
jiggle itself (chains move, toggle works, nothing else moves),
not the underlying bind.

## Verify by running

Run the app, then ask the user for a clip or screenshot of the
result. Do not use computer-use or screen recording to verify —
the user is in front of the PC and sends the clips.

1. The switch is in the Animations panel, off by default, and
   stays off unless the user turns it on.
2. With the switch off, a clip plays exactly as it does today.
3. With a chain marked and the switch on, the chain visibly
   jiggles while the clip plays, and the rest of the character
   moves exactly as it does with the switch off.
4. If the switch is on but no chain is marked, nothing changes
   — state that, do not mark this done.
