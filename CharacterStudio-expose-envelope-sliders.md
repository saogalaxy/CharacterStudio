# CharacterStudio — expose envelope sliders for the other bones

Goal: the Rig panel lets the user resize the envelope of any
deform bone, not just the six midsection bones, so the bind
deformation can be calibrated from the UI.

Why now: the tear cluster from the Character blue bind is the
clavicles, upper arms, and head (Idle 50 of 56 torn edges), and
none of those bones has an envelope slider. The six sliders in
the panel cover pelvis, spine_01–03, and thigh_l/r only. So the
worst cluster cannot be calibrated from the UI today — it needs
joint moves or backend edits by bone name.

## What to build

The backend already takes an envelope override for any bone by
name (`wear.py` `paint`: every deform bone gets scale
`envelopes.get(name, 1.0)`, sigma `0.02 * height * scale`). The
markers endpoint already accepts `{envelopes: {bone: value}}`
and stores it. This is UI-only work: add sliders that post the
same shape for the missing bones.

Add sliders for, grouped by region under the existing six:

- Shoulders / arms: clavicle_l, clavicle_r, upperarm_l,
  upperarm_r, lowerarm_l, lowerarm_r
- Neck / head: neck_01, head
- Legs: calf_l, calf_r

Same slider range and behaviour as the existing six. Moving a
slider posts the override and marks the rig stale, the same as
today — the next bind reads it. No other bone's default changes:
a bone with no override keeps scale 1.0.

## Verify by running

Run the app, then ask the user for a clip or screenshot of the
result. Do not use computer-use or screen recording to verify —
the user is in front of the PC and sends the clips.

1. The Rig panel shows the new sliders, grouped, with the same
   range as the existing six.
2. Move the clavicle_l slider, bind, and check the bind log:
   the `envelopes` line for that run lists clavicle_l with the
   new value (it is `{}` on every run today).
3. If a slider moves but the log still shows `{}`, state that —
   do not mark this done.
