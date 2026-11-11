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

**Rule:** Never treat the UI (`app.js`, `index.html`) as an isolated web page. Any frontend change must respect the underlying background Python job threads (`pipeline/jobs.py`), file pipelines, and native OS execution constraints.

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

1. **Perform a Cross-File Audit:** Inspect `index.html`, `app/static/app.js`, `app/static/viewer.js`, `app/app.py`, and `app/pipeline/jobs.py` to identify dependent IDs, API routes, and event bindings.
2. **Generate a Written Execution Plan:** Explicitly list what files will be changed and how data/DOM contracts will be maintained.
3. **Verify Contracts:** Confirm that:
   - DOM element IDs and classes match across `index.html` and `app.js`.
   - `window.__viewer` method signatures remain intact.
   - Backend JSON return keys match frontend `fetch()` expectations.
   - Event listeners (`oninput`, `onchange`, `onclick`) are safely bound.
4. **Execute & Self-Review:** Apply the changes uniformly across all affected subsystems.