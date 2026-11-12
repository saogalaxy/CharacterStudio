# CharacterStudio — exe launcher like the old one

Correction to the earlier "standalone exe" wording: the app is
not packaged as one single file. The old `Character Studio.exe`
was never one file either — it was a small launcher, 13,824
bytes, that started the app from its own folder. The clean
build gets the same kind of launcher.

Goal, in order:

1. Iron out the kinks in the app's current form — Markers,
   Skeleton check, Bind, Animations — the defects already
   listed in the job list, the UI spec, the rebuild directive,
   and the skeleton-visibility fix. Each one counts only when
   proven by running the app.
2. Then build the exe launcher.

## The exe launcher

- A real .exe, not a .bat or .cmd file. The .bat and .cmd
  launchers are stopgaps and go away.
- It launches the app the way the old exe did: it starts
  `app/app.py` with the app's own portable Python runtime,
  from the app root, and the app window opens. No console
  window left open behind the app.
- The exe carries the `CharacterStudio.ico` icon.
- The exe lives at the app root, next to the `app/` and
  `library/` folders, and the desktop shortcut points at it.
- The portable Python, Blender, and ComfyUI runtimes stay
  in `runtime/` beside the exe, excluded from the repo.
  They are not inside the exe — the exe starts the app from
  its own folder; it does not bundle the runtimes into one
  file.

## Done when

- The kinks are proven fixed by running the app first.
- Then the exe is built, double-clicked on the machine,
  and the seven-step window opens with no .bat, .cmd, or
  console window involved.
- If a kink is still open, the exe waits — a launcher does
  not count as fixing.
