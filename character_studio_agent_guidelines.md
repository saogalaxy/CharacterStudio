# Character Studio — Master Agent Instructions & Architecture Guide

**Owner:** Chris  
**App root:** `D:\CharacterStudio`  
**Target Platform:** Native Windows Desktop Application (`Character Studio.exe` / `pythonw app/app.py` running local runtimes with a WebView2 window wrapper).

---

## 1. Native Desktop Architecture & Process Boundaries

Character Studio is a **native Windows desktop application**, not a standard web app. It relies on:
- A local **aiohttp** backend server running as a background daemon process (`app/app.py`).
- Headless **Blender** and portable **Python/ComfyUI** runtimes located in `runtime/`.
- A frontend UI rendered via `pywebview` / WebView2 (`app/static/`).

**Agent drive:** Prefer the local API / MCP / CLI over desktop computer-use.
Full how-to (tool names, CLI examples, Cursor `mcp.json`) lives in
`AGENTS.md` § **Agent drive (MCP + CLI)** and `.cursor/rules/agent-drive-mcp-cli.mdc`.

- Client: `app/agent_drive.py` → `http://127.0.0.1:8765` (auto-starts `--headless`)
- CLI: `runtime\python\python.exe app\cs_cli.py …` (`ensure`, `jobs`, `run … --wait`, `weights`, `tears`, …)
- MCP: `app/mcp_server.py` → tools `cs_ensure`, `cs_list_jobs`, `cs_get_job`, `cs_run_step`, `cs_see_skeleton`, `cs_get_markers`, `cs_put_markers`, `cs_weights`, `cs_tears`, `cs_poses`, `cs_rig_report`, `cs_stop`
- Inspect bind without clicking: `cs_weights` / `cs_tears` / `jobs/<id>/rig/poses/*.png`

**Rule:** Never treat the UI (`app.js`, `index.html`) as an isolated web page. Any frontend change must respect the underlying background Python job threads (`pipeline/jobs.py`), file pipelines, and native OS execution constraints.

---

## 1b. Marker + skeleton/rig zoom checks (before bind or wear)

**Order:** markers (zoomed) → skeleton/rig joints (zoomed on mesh) → bind → only then wear/paint. Never “fix” a bad chin, crown, or floating joint with paint.

**Do not bind or call `see_skeleton` from numbers alone.** Auto chin used to land mid-face on big-hair anime; defaults were tightened toward the jaw, but **prefer the user’s hand-placed chin / neck_base / clavicles when they disagree**. `off_body` empty is not enough without close-ups.

### Markers (eight dots) — zoom each

| Dot | Must sit on |
|-----|-------------|
| Chin | Jaw tip / under lip — **not** mouth, nose, or mid-face |
| Groin | Crotch height — not mid-belly or mid-thigh |
| Elbows / wrists / knees | True joint crease — not mid-limb |

### Skeleton / Rig — zoom joints on the mesh

In Skeleton (or Rig with bones on), orbit/zoom so each bone end fills the frame. Confirm the joint is **on/inside the mesh** (not floating in hair, off the skin, or in the wrong limb):

| Joint | Must sit |
|-------|----------|
| neck / neck_base | Neck column, above shoulders |
| head / head_top | Skull center and crown near mesh top — not mid-face / ponytail-only |
| clavicle / upperarm / hand | Collarbone and inside arm / mitt volume |
| spine_01..03 / pelvis | Torso core depth — not breast tip or back hair |
| thigh / calf / foot | Inside leg; knee at crease |

Check L/R symmetry in close-up when both sides matter.

### How

- Prefer **joint close-ups** over full-body frames.
- Studio open: zoom Markers, then Skeleton/Rig; screenshot; **read the image**.
- Headless: mesh/`off_body` checks **plus** zoomed Markers and Skeleton/Rig shots of head, shoulders, hips, knees before bind.
- After edits: recompute joints from the eight markers; re-zoom marker **and** driven skeleton joints; keep **mitten** when hands are not T-pose finger-ready.

---

## 2. UI ↔ Backend IPC & State Protocol

- **REST / JSON Polling:** The frontend communicates with the Python backend via structured REST endpoints and JSON payloads.
- **State Separation:** Background worker threads manage heavy processes (rigging, motion retargeting, mesh generation). The frontend polls job states asynchronously.
- **Defensive Parsing:** UI scripts must gracefully handle missing or optional backend properties without crashing the rendering loop or throwing unhandled exceptions in the WebView2 console.

---

## 3. Frontend DOM Management & Event Binding Contracts

- **Centralized DOM Cache:** `app.js` must utilize a clean, centralized DOM element reference pattern to avoid scattered, unverified `document.getElementById` calls.
- **Explicit Event Bindings:** Do not rely on native inline `on*` string assignments. Use explicit event listener attachment helpers that verify element existence (`if (!elem) return;`) before binding `oninput`, `onchange`, or `onclick`.
- **WebView2 Layout Safety:** Gallery tiles, sidebars, and custom rails in `style.css` **must** enforce explicit heights (e.g., `grid-auto-rows: 158px`). Never rely solely on CSS `aspect-ratio`, as WebView2 collapses flex/grid containers under aspect-ratio-only rules.

---

## 4. Three.js Viewport Bridge (`window.__viewer`)

- **Strict API Contract:** All interactions between the main UI (`app.js`) and the 3D viewport (`viewer.js`) must go exclusively through the formalized `window.__viewer` or `window.studio.viewer` API.
- **Shared Parameters:** Element IDs and control hooks affecting the 3D space (such as animation docks, skeleton toggles, and Fit sliders) must match identically across `index.html`, `app.js`, and `viewer.js`.

---

## 5. Fit Controls & Animation Retargeting Semantics

- **Action Forge Alignment:** 
  - **Arm-Space °**: Range `-120...+120`, neutral `0`. Additive rotation on `upperarm_l` (Z-axis) and mirrored on `upperarm_r`.
  - **Arms ↔ °**: Range `-120...+120`. Additive rotation on axis `[0, -1, 0]` and mirrored.
- **Mixer Pose Isolation:** Real-time calculations in `viewer.js` must always sample a clean baseline mixer pose before applying degree offsets to prevent runaway rotation stacking across frame ticks.
- **Export Parity:** Any degree/axis math adjustments made in `viewer.js` must be synchronized in the same edit step with Blender's export baking script (`app/pipeline/blender/export_pack.py`).
- **Legacy Fallback:** Always fall back to `default_fit()` if encountering legacy 0–100 scalar fit values in older `animations.json` files.

---

## 6. Prohibited Actions (Anti-Regression Guardrails)

- **No Isolated UI Edits:** Never modify `app.js`, `style.css`, or `index.html` without checking dependent backend keys and Three.js viewer methods.
- **No Dead Bindings:** Never write raw event handlers without validating that the target DOM element exists and that input events (`oninput`/`onchange`) are properly hooked.
- **No Silent Refactoring:** Do not rename CSS classes, element IDs, or API JSON keys without updating all referencing files in the exact same transaction.

---

## 7. Mandatory Planning & Pre-Execution Audit Protocol

Before writing or modifying any code in Character Studio, you **MUST** follow this protocol:

1. **Perform a Cross-File Audit:** Inspect `index.html`, `app/static/studio.js`,
   `app/static/stage.js`, `app/app.py`, and `app/pipeline/jobs.py` to identify
   dependent IDs, API routes, and event bindings.
2. **Generate a Written Execution Plan:** Post the plan in the reply before the
   first edit. List the files and the functions/sections, the contracts that
   cross a file boundary, the exact change, how it will be verified by running,
   and what is out of scope. If the user suggested the change, restate it
   first. See `.cursor/rules/explain-before-change.mdc`.
3. **Verify Contracts:** Confirm that:
   - DOM element IDs and classes match across `index.html` and `app.js`.
   - `window.__viewer` method signatures remain intact.
   - Backend JSON return keys match frontend `fetch()` expectations.
   - Event listeners (`oninput`, `onchange`, `onclick`) are safely bound.
4. **Execute & Self-Review:** Apply the changes uniformly across all affected subsystems.