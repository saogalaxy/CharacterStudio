# CharacterStudio — generation status screen: source silhouette, live stage text, progress bar

Goal: on the T-pose and Mesh generation pages, while a generation is
running, show a status screen so the user can see what is happening
instead of a disabled button and a static message.

## What to build

1. A silhouette of the previous source image, shown on the
   generation page while it runs:
   - On the T-pose page, the previous source is the Source step image.
   - On the Mesh page, the previous source is the T-pose image.
   - The silhouette fills up from the bottom as the generation
     progresses: fill height follows progress from 0 to 1, bottom
     to top. It is a progress fill, not decoration — the fill level
     must track the real progress.
2. Under the silhouette, a text line naming the stage that is
   running right now, with a progress bar underneath the text.
   The text must update when the running stage changes, so the
   user can read what stage the generation is on at any moment.
3. When the generation finishes, the status screen gives way to
   the result, as the pages already do (the finished image shows).

## Backend work — the stage and the progress must be real

Today the job only reports a step state (empty / running / done /
error) and one static message ("running tpose"), and the ComfyUI
queue call only polls history until it succeeds or errors. That
cannot drive this screen. Before the frontend can show it:

- The generation run must report the stage that is actually
  running and a progress value from 0 to 1, through the job
  state the frontend already polls.
- Stage names come from the real phases of each generation
  workflow — read them from the T-pose and Mesh workflows, do
  not invent stage names.
- Do not fake it: no timed animation pretending to be progress,
  no invented stage label. If the backend cannot see inside a
  stage yet, report what it can honestly say (for example
  "waiting on ComfyUI") rather than a made-up stage.

## Verify by running

Run the app, then ask the user for a clip or screenshot of the
result. Do not use computer-use or screen recording to verify —
the user is in front of the PC and sends the clips.

1. Run a T-pose generation: the silhouette of the source image
   fills from the bottom, the text names the running stage and
   changes as stages change, and the bar moves with it.
2. Run a Mesh generation: same bar, with the silhouette of the
   T-pose image.
3. If the text ever names a stage that is not actually running,
   or the fill moves while nothing is progressing, state that —
   do not mark this done.
