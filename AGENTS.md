# Character Studio — agent entry point

Character Studio is a **native Windows desktop app**: a local aiohttp API
(`app/app.py`, `127.0.0.1:8765`), headless Blender + portable ComfyUI in
`runtime/`, and a pywebview/WebView2 UI in `app/static/`. It is not a website.

Read these before changing anything, in this order:

1. `character_studio_agent_guidelines.md` — master architecture and rules
   (process boundaries, IPC, DOM contracts, `window.__viewer`, fit semantics).
2. `.cursor/rules/marker-placement.mdc` — the hard marker/skeleton zoom order.
3. `CharacterStudio-state-report.md` — what was actually run and what still
   fails. Update it when the app's state changes; never mark a run done there
   unless it was run.
4. `.cursor/rules/explain-before-change.mdc` — post the plan block (goal,
   files, contracts, exact change, proof) before the first edit.

## Non-negotiable rules

- **Markers → skeleton/rig close-ups → bind → wear.** Never bind or call
  `see_skeleton` from numbers alone. Zoom each of the eight dots and each
  critical joint on the mesh (chin, head/crown, neck, clavicles, spine,
  pelvis, knees) in *both* front and side view. An empty `off_body` is not
  proof; `joints_off_body` is not proof of depth.
- **Verify by running the app on the same job.** A change with no run is not
  finished. Do not claim a fix from a front-view screenshot or from reading
  the diff. Do not use computer-use or screen recording; the user sends clips.
- **No partial changes.** A control without backend wiring, a switch that does
  not do what it says, or a drag that does not persist is not done.
- **No silent refactors.** Renaming element IDs, CSS classes, or API JSON keys
  means updating every referencing file in the same edit.
- **No isolated UI edits.** Any change in `app/static/` must be checked against
  `app/pipeline/jobs.py`, the API routes in `app/app.py`, and the viewer.
- **Say what you will change, then change it (§7):** before the first edit,
  post a plan block — goal, files, contracts, the exact change, how it will be
  verified by running, and what is out of scope. When the change came from the
  user, restate their suggestion first. Run the cross-file audit for it:
  `index.html`, `app/static/studio.js`, `app/static/stage.js`, `app/app.py`,
  and `app/pipeline/jobs.py`. No edit without the block, one-line fixes
  included. See `.cursor/rules/explain-before-change.mdc`.
- Prefer the local **API / CLI / MCP** over driving the window (see
  **Agent drive** below). Do not use computer-use to click Studio unless the
  user asks for a visual check the tools cannot do.

## Agent drive (MCP + CLI)

The app exposes the same local HTTP API the window uses at
`http://127.0.0.1:8765`. Agents should drive jobs through that API — not by
clicking the WebView.

| Piece | Path / name |
|--------|-------------|
| HTTP API | `app/app.py` (`--headless` ok) on `127.0.0.1:8765` |
| Shared client | `app/agent_drive.py` (`StudioClient`, auto-starts headless) |
| CLI | `app/cs_cli.py` |
| MCP server | `app/mcp_server.py` → Cursor namespace **`user-character-studio`** / tools `cs_*` |
| Headless launcher | `Launch-CharacterStudio-Headless.cmd` |

### Prefer MCP when available

If the Character Studio MCP tools are connected, use them first:

1. `cs_ensure` — start headless API if nothing is listening
2. `cs_list_jobs` / `cs_get_job` — pick a job id
3. Marker/skeleton edits: `cs_get_markers` → `cs_put_markers` → zoom-check → `cs_see_skeleton` (only after real mesh close-ups)
4. Bind: `cs_run_step` with `step=rig`, `wait=true`
5. Inspect: `cs_weights`, `cs_tears`, `cs_poses`, `cs_rig_report`

Other steps: `cs_run_step` (`markers` \| `skeleton` \| `animations` \| `mesh` \| `tpose` \| `source`), `cs_stop`.

Do **not** call `cs_see_skeleton` or `cs_run_step` `rig` from numbers alone — follow `.cursor/rules/marker-placement.mdc`.

### CLI (same API)

From PowerShell (portable runtime Python):

```powershell
cd D:\CharacterStudio\app
..\runtime\python\python.exe cs_cli.py ensure
..\runtime\python\python.exe cs_cli.py jobs
..\runtime\python\python.exe cs_cli.py job <job_id>
..\runtime\python\python.exe cs_cli.py markers <job_id>
..\runtime\python\python.exe cs_cli.py see-skeleton <job_id>
..\runtime\python\python.exe cs_cli.py run <job_id> rig --wait
..\runtime\python\python.exe cs_cli.py weights <job_id>
..\runtime\python\python.exe cs_cli.py tears <job_id>
..\runtime\python\python.exe cs_cli.py poses <job_id>
..\runtime\python\python.exe cs_cli.py report <job_id>
..\runtime\python\python.exe cs_cli.py stop <job_id>
```

`ensure` / most commands auto-start `--headless` if the API is down. Use
`--no-ensure` only when you intentionally want a hard fail if the server is off.

### Register MCP in Cursor (once per machine)

`mcp.json` entry (stdio):

```json
{
  "mcpServers": {
    "character-studio": {
      "command": "D:\\CharacterStudio\\runtime\\python\\python.exe",
      "args": ["D:\\CharacterStudio\\app\\mcp_server.py"]
    }
  }
}
```

Reload MCP after adding it. Tools appear as `cs_ensure`, `cs_list_jobs`, …
If the namespace shows `needsAuth` / error / loading, fix the connection before
falling back to CLI.

### Typical bind check loop

```text
cs_ensure → cs_list_jobs → (zoom Markers + Skeleton/Rig on mesh)
→ cs_see_skeleton → cs_run_step rig wait=true
→ cs_weights + cs_tears + read jobs/<id>/rig/poses/*.png
```

Job files live under `jobs/<id>/` (`markers.json`, `rig/`, `export/`,
`logs/rig.txt`). The deform gate can be `FAIL` and still write a GLB — report
the gate, do not hide it.

## Conventions that bite

- Six UI steps (`STEPS` in `studio.js`), seven server steps (`STEPS` in
  `jobs.py`, which adds `skeleton`). Do not assume they match.
- Marker edits invalidate the bind (`invalidate_bind`): they delete
  `animations.json`, clear rig/animations, and may leave `rig_stale`. Runtime
  preferences are not pose edits and must not invalidate the bind.
- `jobs/<id>/` is the source of truth for a character: `job.json`,
  `markers.json` (dots, joints, envelopes, tags, finger tips), `mesh.glb`,
  `rig/`, `animations.json`, `export/`.
- The bind gate is `deform_gate` in `app/pipeline/blender/wear.py`. A `FAIL`
  still writes the GLB. Do not hide it.
- Frontend modules are cache-busted with `?v=...` in `index.html` and the
  `stage.js` import in `studio.js`. Bump both when those files change.
- `runtime/`, `jobs/`, and `dist/` are not in Git. The repo is app code only.

## Map

| Path | What it is |
|---|---|
| `app/app.py` | window + HTTP API |
| `app/agent_drive.py` | HTTP client shared by CLI/MCP (auto headless) |
| `app/cs_cli.py` | agent CLI (`ensure`, `jobs`, `run`, `weights`, …) |
| `app/mcp_server.py` | MCP stdio server (`cs_*` tools) |
| `app/static/studio.js` | step panels, jobs sidebar, API calls |
| `app/static/stage.js` | Three.js viewport: mesh, dots, bones, envelopes, playback |
| `app/pipeline/jobs.py` | job state, step runner, markers/anim settings |
| `app/pipeline/blender/` | Blender scripts: markers, bind (`wear.py`), export |
| `app/workflows/` | Comfy API graphs |
| `library/mesh2motion/` | skeleton + motion clips |
| `.cursor/rules/agent-drive-mcp-cli.mdc` | always-on MCP/CLI how-to for agents |
| `CharacterStudio-*.md` | build notes / specs / fix checklists |
