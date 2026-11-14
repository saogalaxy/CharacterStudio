"""Character Studio window and job API. New file, not a patch of the old server."""
import argparse
import os
import sys
import threading
from pathlib import Path

# The portable runtime's path file does not add the script folder.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from aiohttp import web

from pipeline import motions
from pipeline.jobs import STEPS, Studio

studio = Studio()
ROOT = Path(__file__).resolve().parent / "static"


def _job(request):
    try:
        return studio.get(request.match_info["job"])
    except KeyError:
        raise web.HTTPNotFound(text="no such job")


async def index(_request):
    return web.FileResponse(ROOT / "index.html")


async def library(_request):
    clips = motions.library_clips()
    return web.json_response({"count": len(clips), "clips": clips})


async def library_file(request):
    clip = request.match_info["clip"]
    if clip != motions.safe_id(clip):
        raise web.HTTPBadRequest(text="unknown motion")
    path = motions.LIBRARY / "animations" / f"{clip}.glb"
    if not path.is_file():
        raise web.HTTPNotFound(text="unknown motion")
    return web.FileResponse(path)


async def job_list(_request):
    return web.json_response({"jobs": [job.state() for job in studio.jobs.values()]})


async def job_create(request):
    body = await request.json()
    job = studio.create((body or {}).get("name") or "Character")
    return web.json_response(job.state())


async def job_state(request):
    return web.json_response(_job(request).state())


async def job_delete(request):
    try:
        studio.delete(request.match_info["job"])
    except KeyError:
        raise web.HTTPNotFound(text="no such job")
    except RuntimeError as exc:
        raise web.HTTPConflict(text=str(exc))
    return web.json_response({"ok": True})


async def job_run(request):
    step = request.match_info["step"]
    if step not in STEPS:
        raise web.HTTPBadRequest(text=f"unknown step {step}")
    payload = {}
    if request.body_exists:
        try:
            payload = await request.json()
        except Exception:
            payload = {}
    if not isinstance(payload, dict):
        payload = {}
    return web.json_response(studio.run(_job(request), step, payload))


async def job_stop(request):
    return web.json_response(studio.stop(_job(request)))


async def job_upload(request):
    job = _job(request)
    step = request.match_info["step"]
    raw = await request.read()
    try:
        if step in ("source", "tpose"):
            state = studio.put_image(job, step, raw)
        elif step == "mesh":
            state = studio.put_mesh(job, raw)
        elif step == "motion":
            name = request.headers.get("X-Filename") or "motion.glb"
            state = studio.put_motion(job, name, raw)
        else:
            raise ValueError(f"you can't upload a {step}")
    except ValueError as exc:
        raise web.HTTPBadRequest(text=str(exc))
    return web.json_response(state)


async def tpose_settings(request):
    return web.json_response(studio.set_tpose_settings(_job(request), await request.json()))


async def mesh_settings(request):
    return web.json_response(studio.set_mesh_settings(_job(request), await request.json()))


async def markers(request):
    job = _job(request)
    body = await request.json()
    try:
        state = studio.put_markers(
            job,
            markers=body.get("markers"),
            joints=body.get("joints"),
            reset=bool(body.get("reset")),
            moved=body.get("moved"),
            envelopes=body.get("envelopes"),
            tags=body.get("tags"),
            jiggle=body.get("jiggle"),
            fingers=body.get("fingers"),
            finger_tips=body.get("finger_tips"),
        )
    except ValueError as exc:
        raise web.HTTPBadRequest(text=str(exc))
    return web.json_response(state)


async def see_skeleton(request):
    return web.json_response(studio.see_skeleton(_job(request)))


async def anim_settings(request):
    return web.json_response(studio.set_anim(_job(request), await request.json()))


async def apply_library(request):
    body = await request.json()
    try:
        state = studio.add_library_clip(_job(request), body.get("clip") or "")
    except ValueError as exc:
        raise web.HTTPBadRequest(text=str(exc))
    return web.json_response(state)


async def remove_clip(request):
    body = await request.json()
    return web.json_response(studio.remove_clip(_job(request), body.get("clip") or ""))


async def clear_clips(request):
    return web.json_response(studio.clear_clips(_job(request)))


async def export_package(request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    formats = body.get("formats") if isinstance(body, dict) else None
    try:
        state = studio.export_package(_job(request), formats=formats)
    except (RuntimeError, ValueError) as exc:
        raise web.HTTPConflict(text=str(exc))
    return web.json_response(state)


async def reveal_export(request):
    try:
        state = studio.reveal_export(_job(request))
    except RuntimeError as exc:
        raise web.HTTPConflict(text=str(exc))
    return web.json_response(state)


async def job_file(request):
    job = _job(request)
    rel = request.match_info["name"]
    if ".." in rel or rel.startswith(("/", "\\")):
        raise web.HTTPForbidden()
    path = (job.dir / rel).resolve()
    root = job.dir.resolve()
    if path != root and root not in path.parents:
        raise web.HTTPForbidden()
    if not path.is_file():
        raise web.HTTPNotFound()
    return web.FileResponse(path)


def make_app():
    app = web.Application(client_max_size=1024 ** 3)
    app.router.add_get("/", index)
    app.router.add_static("/static/", ROOT, show_index=False)
    app.router.add_get("/api/motion-library", library)
    app.router.add_get("/api/motion-library/{clip}/file", library_file)
    app.router.add_get("/api/jobs", job_list)
    app.router.add_post("/api/jobs", job_create)
    app.router.add_get("/api/jobs/{job}", job_state)
    app.router.add_delete("/api/jobs/{job}", job_delete)
    app.router.add_post("/api/jobs/{job}/run/{step}", job_run)
    app.router.add_post("/api/jobs/{job}/stop", job_stop)
    app.router.add_post("/api/jobs/{job}/upload/{step}", job_upload)
    app.router.add_post("/api/jobs/{job}/tpose-settings", tpose_settings)
    app.router.add_post("/api/jobs/{job}/mesh-settings", mesh_settings)
    app.router.add_post("/api/jobs/{job}/markers", markers)
    app.router.add_post("/api/jobs/{job}/skeleton/seen", see_skeleton)
    app.router.add_post("/api/jobs/{job}/anim-settings", anim_settings)
    app.router.add_post("/api/jobs/{job}/apply-library", apply_library)
    app.router.add_post("/api/jobs/{job}/remove-clip", remove_clip)
    app.router.add_post("/api/jobs/{job}/clear-clips", clear_clips)
    app.router.add_post("/api/jobs/{job}/export", export_package)
    app.router.add_post("/api/jobs/{job}/export/reveal", reveal_export)
    app.router.add_get("/api/jobs/{job}/file/{name:.*}", job_file)
    return app


def serve(port):
    web.run_app(make_app(), host="127.0.0.1", port=port, print=None)


def _on_window_closed():
    # The X button closes the WebView window, then pywebview waits for
    # WebView2 to finish shutting down. That wait often never returns, so
    # pythonw.exe and the API on port 8765 stay up. End them here.
    try:
        studio.stop_for_exit()
    except Exception:
        pass
    try:
        from pipeline.runtime import kill_descendants
        kill_descendants()
    except Exception:
        pass
    os._exit(0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if args.headless:
        serve(args.port)
        return
    threading.Thread(target=serve, args=(args.port,), daemon=True).start()
    import webview
    window = webview.create_window(
        "Character Studio",
        f"http://127.0.0.1:{args.port}/",
        width=1500,
        height=950,
        min_size=(1100, 700),
    )
    window.events.closed += _on_window_closed
    icon = Path(__file__).resolve().parents[1] / "CharacterStudio.ico"
    webview.start(icon=str(icon) if icon.is_file() else None)
    _on_window_closed()


if __name__ == "__main__":
    main()
