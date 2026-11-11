"""Character Studio: one window, no consoles.

    pythonw app.py              native window
    python  app.py --headless   server only (tests); prints the URL
"""
import asyncio
import json
import socket
import sys
import threading
from pathlib import Path

from aiohttp import web

APP = Path(__file__).resolve().parent
sys.path.insert(0, str(APP))
from pipeline import jobs, runtime as rt  # noqa: E402

STATIC = APP / "static"
studio = None  # created after the single-instance check, so a second copy can't touch running jobs


def _job(req):
    try:
        return studio.get(req.match_info["job"])
    except KeyError:
        raise web.HTTPNotFound(text="no such character")


def _err(e, status=400):
    return web.json_response({"error": str(e)}, status=status)


async def index(_):
    return web.FileResponse(STATIC / "index.html")


async def info(_):
    return web.json_response({"portable": rt.PORTABLE, "jobs": str(studio.root),
                              "engines": {"comfy": str(rt.COMFY), "blender": str(rt.BLENDER),
                                          "python": str(rt.PYTHON)},
                              "engines_ok": all(p.exists() for p in (rt.COMFY / "main.py", rt.BLENDER, rt.PYTHON)),
                              "busy": studio.current})


async def list_jobs(_):
    out = []
    for j in studio.list():
        s = j.state()
        out.append({"id": j.id, "name": j.meta["name"], "created": j.meta["created"],
                    "steps": {k: v["state"] for k, v in s["steps"].items()}})
    return web.json_response(out)


async def create_job(req):
    body = await req.json()
    j = studio.create(body.get("name") or "character")
    return web.json_response(j.state())


async def get_job(req):
    return web.json_response(_job(req).state())


async def delete_job(req):
    try:
        studio.delete(req.match_info["job"])
    except Exception as e:
        return _err(e)
    return web.json_response({"ok": True})


async def upload(req):
    j, step = _job(req), req.match_info["step"]
    data = await req.read()
    if not data:
        return _err("empty upload")
    try:
        if step in ("source", "tpose"):
            studio.put_image(j, step, data)
        elif step == "mesh":
            if data[:4] != b"glTF":
                return _err("the mesh must be a .glb file")
            studio.put_mesh(j, data)
        else:
            return _err(f"you can't upload a {step}")
    except Exception as e:
        return _err(e)
    return web.json_response(studio.get(j.id).state())


async def run(req):
    j, step = _job(req), req.match_info["step"]
    chain = req.query.get("chain") == "1"
    try:
        studio.enqueue(j, step, chain=chain)
    except Exception as e:
        return _err(e)
    return web.json_response(studio.get(j.id).state())


async def mesh_settings(req):
    j = _job(req)
    try:
        body = await req.json()
        settings = studio.set_mesh_settings(j, body)
    except Exception as e:
        return _err(e)
    return web.json_response(settings)


async def tpose_settings(req):
    j = _job(req)
    try:
        body = await req.json()
        settings = studio.set_tpose_settings(j, body)
    except Exception as e:
        return _err(e)
    return web.json_response(settings)


async def anim_settings(req):
    j = _job(req)
    try:
        body = await req.json()
        settings = studio.set_anim_settings(j, body)
    except Exception as e:
        return _err(e)
    return web.json_response(settings)


async def export_anims(req):
    j = _job(req)
    try:
        studio.enqueue(j, "export_anims")
    except Exception as e:
        return _err(e)
    return web.json_response(studio.get(j.id).state())


async def import_motion(req):
    j = _job(req)
    name = req.query.get("name") or "motion.fbx"
    data = await req.read()
    if not data:
        return _err("empty upload")
    try:
        state = studio.import_motion(j, data, name)
    except Exception as e:
        return _err(e)
    return web.json_response(state)


async def motion_library(_):
    from pipeline import animations as anims
    clips = anims.library_clips()
    return web.json_response({"count": len(clips), "clips": clips,
                              "root": str(anims.LIBRARY_ROOT)})


async def library_clip(req):
    """Bone-only Mesh2Motion GLB used as the demo mannequin before a character exists."""
    from pipeline import animations as anims
    clip = req.match_info["clip"]
    if clip == "skeleton":
        p = anims.LIBRARY_ROOT / "skeleton.glb"
    else:
        p = anims.library_clip_path(clip)
    if p is None or not p.is_file():
        raise web.HTTPNotFound()
    root = anims.LIBRARY_ROOT.resolve()
    resolved = p.resolve()
    if resolved != root and root not in resolved.parents:
        raise web.HTTPNotFound()
    return web.FileResponse(p, headers={"Cache-Control": "no-store"})


async def apply_library(req):
    j = _job(req)
    try:
        body = await req.json()
    except Exception:
        body = {}
    clip = (body.get("clip") or req.query.get("clip") or "").strip()
    if not clip:
        return _err("clip id required")
    try:
        state = studio.apply_library_motion(j, clip)
    except Exception as e:
        return _err(e)
    return web.json_response(state)


async def replace_builtins(req):
    j = _job(req)
    try:
        state = studio.replace_builtins_from_library(j)
    except Exception as e:
        return _err(e)
    return web.json_response(state)


async def key_clip(req):
    j = _job(req)
    body = await req.json()
    try:
        state = studio.key_clip(
            j,
            body.get("clip") or "",
            int(body.get("frame") or 1),
            body.get("pose") or {},
        )
    except Exception as e:
        return _err(e)
    return web.json_response(state)


async def cancel(req):
    studio.cancel_current(req.match_info["job"])
    return web.json_response({"ok": True})


async def markers(req):
    j = _job(req)
    body = await req.json()
    try:
        det = studio.put_markers(
            j,
            markers=body.get("markers"),
            joints=body.get("joints"),
            reset=bool(body.get("reset")),
        )
    except Exception as e:
        return _err(e)
    return web.json_response({
        "markers": det["markers"],
        "off_body": det.get("off_body") or [],
        "joints": det.get("joints") or {},
        "joints_off_body": det.get("joints_off_body") or [],
    })


async def file(req):
    j = _job(req)
    p = (j.dir / req.match_info["path"]).resolve()
    if j.dir.resolve() not in p.parents or not p.is_file():
        raise web.HTTPNotFound()
    return web.FileResponse(p, headers={"Cache-Control": "no-store"})


async def log(req):
    j = _job(req)
    p = j.dir / "logs" / f"{req.match_info['step']}.txt"
    text = p.read_text(encoding="utf-8", errors="replace")[-20000:] if p.is_file() else ""
    return web.Response(text=text)


async def open_folder(req):
    import os
    os.startfile(_job(req).dir)
    return web.json_response({"ok": True})


def make_app():
    app = web.Application(client_max_size=1024 ** 3)
    r = app.router
    r.add_get("/", index)
    r.add_get("/api/info", info)
    r.add_get("/api/jobs", list_jobs)
    r.add_post("/api/jobs", create_job)
    r.add_get("/api/jobs/{job}", get_job)
    r.add_delete("/api/jobs/{job}", delete_job)
    r.add_post("/api/jobs/{job}/upload/{step}", upload)
    r.add_post("/api/jobs/{job}/run/{step}", run)
    r.add_post("/api/jobs/{job}/mesh-settings", mesh_settings)
    r.add_post("/api/jobs/{job}/tpose-settings", tpose_settings)
    r.add_post("/api/jobs/{job}/anim-settings", anim_settings)
    r.add_post("/api/jobs/{job}/export-anims", export_anims)
    r.add_post("/api/jobs/{job}/import-motion", import_motion)
    r.add_get("/api/motion-library", motion_library)
    r.add_get("/api/library/{clip}", library_clip)
    r.add_post("/api/jobs/{job}/apply-library", apply_library)
    r.add_post("/api/jobs/{job}/replace-builtins", replace_builtins)
    r.add_post("/api/jobs/{job}/key-clip", key_clip)
    r.add_post("/api/jobs/{job}/cancel", cancel)
    r.add_post("/api/jobs/{job}/markers", markers)
    r.add_get("/api/jobs/{job}/file/{path:.+}", file)
    r.add_get("/api/jobs/{job}/log/{step}", log)
    r.add_post("/api/jobs/{job}/open", open_folder)
    r.add_static("/static/", STATIC)
    return app


def serve(port):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    runner = web.AppRunner(make_app())
    loop.run_until_complete(runner.setup())
    loop.run_until_complete(web.TCPSite(runner, "127.0.0.1", port).start())
    loop.run_forever()


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def set_window_icon(title):
    """pythonw.exe's icon would otherwise show on the title bar and taskbar."""
    import ctypes
    u32 = ctypes.windll.user32
    ico = str(STATIC / "app.ico")
    hwnd = u32.FindWindowW(None, title)
    if not hwnd:
        return
    for size, which in ((16, 0), (256, 1)):  # ICON_SMALL, ICON_BIG
        h = u32.LoadImageW(None, ico, 1, size, size, 0x10)  # IMAGE_ICON, LR_LOADFROMFILE
        if h:
            u32.SendMessageW(hwnd, 0x80, which, h)  # WM_SETICON


def shutdown():
    if studio and studio.current:
        studio.cancel.set()


if __name__ == "__main__":
    headless = "--headless" in sys.argv
    port = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else free_port()
    url = f"http://127.0.0.1:{port}/"
    if headless:
        studio = jobs.Studio()
        print("SERVING", url, flush=True)
        serve(port)
    else:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("CharacterStudio.App")
        k32 = ctypes.windll.kernel32
        k32.CreateMutexW(None, False, "CharacterStudio.SingleInstance")
        if k32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
            ctypes.windll.user32.MessageBoxW(None, "Character Studio is already open.", "Character Studio", 0x40)
            sys.exit(0)
        studio = jobs.Studio()
        threading.Thread(target=serve, args=(port,), daemon=True).start()
        import webview
        win = webview.create_window("Character Studio", url, width=1500, height=950, min_size=(1100, 700))
        win.events.closing += shutdown
        win.events.shown += lambda: set_window_icon("Character Studio")
        webview.start()
        shutdown()
        import time
        for _ in range(40):
            if not studio.current:
                break
            time.sleep(0.25)
