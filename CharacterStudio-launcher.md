# CharacterStudio — launcher: the clean build needs a new way to start it

Problem: the clean build (HEAD `5084425`) has no launcher. The
old `Character Studio.exe` is still in the repo, and the desktop
icon still starts it, so the old version runs instead of the clean
build. The clean build's entry point is `app/app.py`, which starts
the window itself.

## Required

1. Delete `Character Studio.exe` from the repo and from the
   launch path. Do not leave the old launcher in place alongside
   the new one.
2. Build a new launcher for the clean build that starts
   `app/app.py` with the app's own portable Python runtime
   (under `runtime/`, not in the repo), from the app root
   `D:\CharacterStudio`.
3. Create a desktop shortcut and icon for the new launcher,
   clearly distinct from the old one, so the clean build is
   started by clicking it.
4. The launcher must start the same window the code describes:
   Character Studio, 1500×950, minimum 1100×700, API on
   127.0.0.1:8765, seven steps — Source, T-pose, Mesh, Markers,
   Skeleton, Rig, Animations.

## Done when

- Clicking the new icon opens the clean build, showing the
  seven-step bar, not the old four-step UI.
- Clicking the old icon no longer starts the app, because the
  old exe is gone.
- The launch is verified by running the new launcher on the
  machine, not by reading the launcher script. Record the
  exact command the launcher runs and what the window showed.
- If the launcher cannot be built, state what blocks it
  instead of leaving the old exe in place.
