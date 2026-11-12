# CharacterStudio — re-bind greyed out: skeleton-seen is sent once and never again

Defect (user, first bind run): Bind ran once, then the Bind
button was greyed out and re-binding was not possible.

Cause in `app/static/studio.js`: the Skeleton panel posts
`skeleton/seen` only once per page load (`seenSent` flag).
The server clears `skeleton_seen` whenever the markers are
edited or an earlier step is re-run — which also clears the
rig. After that, the page never sends `skeleton/seen` again,
so Bind stays disabled even after the skeleton is opened
again. The button greys out because its blocked check
includes `!job.skeleton_seen`.

## Fix (already written into `app/static/studio.js`)

- In `poll()`: whenever the server reports `skeleton_seen`
  as false, `seenSent` is reset to false. The next time the
  Skeleton panel draws, it posts `skeleton/seen` again and
  Bind unblocks. Nothing else changes: the post still happens
  at most once per skeleton check, and a checked skeleton
  still stays checked.

## Verify by running

Pull, start the app, and on the job:

1. Bind once.
2. Go back to Markers, move a dot, then open Skeleton.
3. Bind & wear must be clickable again — not greyed out.
4. Bind a second time and confirm the rig step finishes.

If Bind is still greyed out at step 3, record what the
Skeleton panel and the status line show instead of
marking this done.
