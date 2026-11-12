# CharacterStudio — standalone exe: the end goal, after the kinks

Goal, in order:

1. Iron out the kinks in the app's current form — Markers,
   Skeleton check, Bind, Animations — the defects already
   listed in the job list, the UI spec, the rebuild directive,
   and the skeleton-visibility fix. Each one counts only when
   proven by running the app.
2. Then package the app as a standalone exe file.

## The exe

- A real .exe launcher, not a .bat or .cmd file. The .bat
  and .cmd launchers are stopgaps and go away.
- Double-clicking the exe starts the clean build:
  `app/app.py` with the app's own portable Python runtime,
  from the app root. No console window left open behind
  the app.
- The exe carries the `CharacterStudio.ico` icon.
- The exe lives at the app root, next to the `app/` and
  `library/` folders, and the desktop shortcut points at it.
- The portable Python, Blender, and ComfyUI runtimes stay
  in `runtime/` beside the exe, excluded from the repo.
  They are not inside the exe file itself — the exe starts
  the app from its own folder; it does not bundle the
  runtimes.

## Done when

- The kinks are proven fixed by running the app first.
- Then the exe is built, double-clicked on the machine,
  and the seven-step window opens with no .bat, .cmd, or
  console window involved.
- If a kink is still open, the exe waits — packaging does
  not count as fixing.
