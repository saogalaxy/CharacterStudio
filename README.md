# Character Studio

A **Windows desktop app** that turns a character image into a rigged, animated 3D character you can export as a `.glb`.

It is not a website. Double-click `CharacterStudio.exe` (or the desktop shortcut) and a native window opens. Under the hood a local Python API talks to **ComfyUI** and **Blender** on this machine.

---

## What you get

1. **Source** — drop in a character image  
2. **T-pose** — AI edit into a clean standing T-pose  
3. **Mesh** — image → textured low-poly 3D mesh  
4. **Markers** — joint dots on the body (drag to fix)  
5. **Rig** — bind skin weights, envelopes, weight paint, Blender-style bones  
6. **Animations** — play Mesh2Motion clips, fit the motion, export `.glb`

Jobs live under `jobs/`. Each character is its own folder.

---

## Quick start (packaged machine)

You need the full package: this repo **plus** a `runtime/` folder next to it (Python, ComfyUI + models, Blender). `runtime/` is large and is **not** in Git.

```
CharacterStudio/
  CharacterStudio.exe   ← start here
  app/                  ← UI + pipeline (this repo)
  library/mesh2motion/  ← skeleton + motion clips
  runtime/              ← engines + AI weights (local only)
  jobs/                 ← your characters
```

1. Put the package on disk (example: `D:\CharacterStudio`).
2. Confirm `runtime\python\pythonw.exe`, `runtime\ComfyUI\main.py`, and `runtime\blender\blender.exe` exist.
3. Double-click **CharacterStudio.exe**.
4. Create a job with **+ New**, then walk the steps left to right.

Optional launcher script: `Launch-CharacterStudio.cmd` starts the same app via portable Python.

### Installers (two kinds — names tell them apart)

| | **Offline** | **Online** (Git share) |
|---|---|---|
| Folder | `dist\CharacterStudio-Offline-Install\` | `dist\CharacterStudio-Online-Install\` |
| Exe | `Offline-Setup.exe` | `Online-Setup.exe` |
| Runtime | Inside `payload\` | Downloads zip on install |
| Use when | USB / zip to a friend | Sharing this repo on Git |

**Offline** (local zip / USB — no download):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer\Build-OfflinePackage.ps1 -SkipRuntimeConfirm
```

**Online** (small setup; host the runtime zip first):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer\Publish-RuntimeBundle.ps1 -SkipConfirm
# upload dist\CharacterStudio-Runtime.zip → set URL in installer\online-manifest.json
powershell -NoProfile -ExecutionPolicy Bypass -File installer\Build-OnlineSetup.ps1
```

Uninstall from Settings → Apps, or run `Uninstall.exe`. Details: [`installer/README.md`](installer/README.md).

---

## How it works

| Layer | Role |
|--------|------|
| **WebView2 window** (`pywebview`) | Desktop UI |
| **Local API** (`app/app.py` on `127.0.0.1:8765`) | Jobs, uploads, step runners |
| **ComfyUI** | T-pose image edit + mesh generation |
| **Blender** (headless) | Markers, bind / skin weights, motion bake, export |
| **Three.js stage** | Viewport: mesh, skeleton, envelopes, weights, playback |

The UI never talks to the internet for generation. Weights are loaded from `runtime/`.

---

## Agent drive (CLI + MCP)

AI agents can run the same local API the window uses — including **headless** (no WebView).
**Models/agents:** start at `AGENTS.md` § **Agent drive (MCP + CLI)** and
`.cursor/rules/agent-drive-mcp-cli.mdc` (always-on Cursor rule).

| Piece | Path |
|--------|------|
| HTTP API | `http://127.0.0.1:8765/api/...` (`app/app.py --headless`) |
| Client | `app/agent_drive.py` |
| CLI | `runtime\python\python.exe app\cs_cli.py …` |
| MCP | `app/mcp_server.py` → tools `cs_*` (Cursor `mcp.json` name `character-studio`) |
| Headless launch | `Launch-CharacterStudio-Headless.cmd` |

```powershell
cd D:\CharacterStudio\app
..\runtime\python\python.exe cs_cli.py ensure
..\runtime\python\python.exe cs_cli.py jobs
..\runtime\python\python.exe cs_cli.py weights <job_id>
..\runtime\python\python.exe cs_cli.py tears <job_id>
..\runtime\python\python.exe cs_cli.py run <job_id> rig --wait
```

`cs_ensure` / `ensure` starts `--headless` if nothing is listening. Reload MCP in Cursor after adding the server so tools like `cs_list_jobs` / `cs_tears` appear.

**Marker + skeleton placement:** Before bind, zoom close-ups of Markers dots **and** Skeleton/Rig joints on the mesh (chin, head/crown, neck, clavicles, spine, pelvis, knees) — see `character_studio_agent_guidelines.md` §1b and `.cursor/rules/marker-placement.mdc`. Do not trust full-body views, empty `off_body`, or auto chin on big-hair meshes.

---

## Models & engines

Pinned by the pipeline (names must match files under Comfy’s `models/` or the HF cache in `runtime/hf`).

### T-pose (Qwen Image 2.1)

| Piece | File / id |
|--------|-----------|
| UNet | `qwen_image_2.1_int8_convrot.safetensors` |
| CLIP | `qwen3vl_8b_int8_convrot.safetensors` |
| VAE | `qwen_image_2.1_vae_bf16.safetensors` |
| Upscale (2.5D path, optional) | `4x-UltraSharp.pth` |

Methods in the UI: **standard**, **2.5d**, **custom** prompt.

### Mesh (LowPoly + UltraTex)

| Piece | File / id |
|--------|-----------|
| Shape | `TencentARC/Pixal3D-T` |
| Texture diffusion | `flux-2-klein-base-9b-Q4_0.gguf` |
| VAE | `flux2-vae.safetensors` |
| Text encoder | `Qwen3-8B-Q4_K_M.gguf` |
| UltraTex | `ultratex_flux2*.safetensors` + `ultratex_flux2_decoder.pt` |
| Background removal | `birefnet.safetensors`, `RMBG-1.4` |

Default target is about **60k** triangles (optimized). Workflow templates live in `app/workflows/`.

### Rig & motion

- Skeleton / clip library: **[Mesh2Motion](https://github.com/Mesh2Motion/mesh2motion-app)** human pack (UE5 bone names) under `library/mesh2motion/`
- Bind & wear: Blender script `app/pipeline/blender/wear.py` (envelope skin weights)
- Export: character + saved motions as one `.glb`

---

## Requirements

- **Windows 10/11** with WebView2  
- **GPU** strong enough for the Comfy graphs above (VRAM depends on which models you keep loaded)  
- Full **`runtime/`** tree beside the app (not shipped in this Git repo)

Developer fallback (no `runtime/`): the code can point at a local Comfy Easy-Install and a system Blender install — see `app/pipeline/runtime.py`.

---

## Repo map

| Path | What it is |
|------|------------|
| `app/app.py` | Window + HTTP API |
| `app/static/` | UI (`studio.js`, `stage.js`, CSS) |
| `app/pipeline/` | Job runner, Comfy clients, Blender scripts |
| `app/workflows/` | Comfy API graphs |
| `library/mesh2motion/` | Reference skeleton + motion GLBs |
| `launcher/Program.cs` | Source for `CharacterStudio.exe` |
| `installer/` | Setup.exe sources, Build-Payload, uninstaller |
| `jobs/` | Local work (gitignored) |
| `runtime/` | Engines + models (gitignored) |
| `dist/` | Built install payload (gitignored) |

Markdown files named `CharacterStudio-*.md` are build notes / fix checklists, not the product manual.

---

## Rebuild the exe

From the app root (Visual C# compiler):

```bat
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /reference:System.Windows.Forms.dll /win32icon:CharacterStudio.ico /out:CharacterStudio.exe launcher\Program.cs
```

The exe only starts portable Python → `app/app.py`. It does not bundle Comfy or Blender.

---

## Status

Active desktop tool. Clone this repo for the **app code**. Pair it with your local `runtime/` package to actually generate characters. If the GitHub page looked like a black box before, that was because the engines and weights live outside Git — this README is the map.
