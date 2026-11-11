"""Jobs and steps.

A job is a folder. Each step owns one artifact; a step can run when the previous step's
artifact exists, so the user can jump in anywhere by supplying that artifact.
Changing a step's artifact clears everything after it.

    source  -> source.png
    tpose   -> tpose.png
    mesh        -> mesh.glb   (+ mesh_check.json, export/ for Mixamo + AF)
    markers     -> markers.json
    rig         -> rig/rigged_animated.glb (+ report, poses, glb check)
    animations  -> animations.json (AF-style clip pick / speed / export)
"""
import json
import queue
import re
import shutil
import subprocess
import threading
import time
import traceback
import uuid
from pathlib import Path

from . import animations as anims, comfy, mesh, normals, runtime as rt, tpose

STEPS = ["source", "tpose", "mesh", "markers", "rig", "animations"]
ARTIFACT = {"source": "source.png", "tpose": "tpose.png", "mesh": "mesh.glb",
            "markers": "markers.json", "rig": "rig/rigged_animated.glb",
            "animations": "animations.json"}
EXTRA = {"mesh": ["mesh_check.json", "mesh_stages", "export"], "rig": ["rig", "export"],
         "tpose": [], "source": [], "markers": ["markers_xz.npy", "markers_pts.npy"],
         "animations": ["export", "motions"]}


_META_LOCK = threading.RLock()


def _now():
    return time.strftime("%Y-%m-%d %H:%M:%S")


class Job:
    def __init__(self, folder):
        self.dir = Path(folder)
        self.meta_path = self.dir / "job.json"
        self.meta = json.loads(self.meta_path.read_text(encoding="utf-8"))

    @property
    def id(self):
        return self.meta["id"]

    def path(self, step):
        return self.dir / ARTIFACT[step]

    def has(self, step):
        return self.path(step).is_file()

    def save(self):
        tmp = self.meta_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.meta, indent=1), encoding="utf-8")
        tmp.replace(self.meta_path)

    def set_step(self, step, replace=False, **kw):
        with _META_LOCK:
            self.meta = json.loads(self.meta_path.read_text(encoding="utf-8"))
            s = {} if replace else self.meta["steps"].setdefault(step, {})
            s.update(kw, updated=_now())
            self.meta["steps"][step] = s
            self.save()

    def clear_after(self, step):
        for later in STEPS[STEPS.index(step) + 1:]:
            self.clear(later)

    def clear(self, step):
        p = self.path(step)
        if p.is_file():
            p.unlink()
        for extra in EXTRA[step]:
            e = self.dir / extra
            if e.is_dir():
                shutil.rmtree(e, ignore_errors=True)
            elif e.is_file():
                e.unlink()
        self.set_step(step, replace=True, state="empty")

    def state(self):
        out = dict(self.meta)
        out["steps"] = {}
        for i, step in enumerate(STEPS):
            s = dict(self.meta["steps"].get(step, {}))
            if s.get("state") not in ("queued", "running", "error"):
                s["state"] = "done" if self.has(step) else "empty"
            # the artifact alone isn't enough: a mesh that failed its check still has mesh.glb
            prev = STEPS[i - 1] if i else None
            s["can_run"] = (prev is not None and self.has(prev)
                            and out["steps"][prev].get("state") == "done")
            if step == "rig" and s["can_run"]:
                mk = json.loads(self.path("markers").read_text(encoding="utf-8"))
                ensure_joints(self, mk)
                s["can_run"] = not mk.get("off_body") and not mk.get("joints_off_body")
            out["steps"][step] = s
        for name in ("mesh_check.json", "markers.json", "rig/report.json", "rig/glb_check.json"):
            p = self.dir / name
            if p.is_file():
                data = json.loads(p.read_text(encoding="utf-8"))
                if name == "markers.json":
                    ensure_joints(self, data)
                out[name.replace("/", "_").replace(".json", "")] = data
        out["files"] = {s: (ARTIFACT[s] if self.has(s) else None) for s in STEPS}
        if (self.dir / "rig" / "poses.png").is_file():
            out["files"]["poses"] = "rig/poses.png"
        pose_dir = self.dir / "rig" / "poses"
        if pose_dir.is_dir():
            out["files"]["pose_thumbs"] = {
                p.stem.replace("_front", ""): f"rig/poses/{p.name}"
                for p in sorted(pose_dir.glob("*_front.png"))
            }
        exp = self.dir / "export"
        if exp.is_dir():
            out["export"] = sorted(p.name for p in exp.iterdir() if p.is_file())
        out["tpose_settings"] = tpose.settings_from(self.meta.get("tpose_settings"))
        out["mesh_settings"] = mesh.settings_from(self.meta.get("mesh_settings"))
        available = set()
        if self.has("rig"):
            if not self.has("animations"):
                anims.write(self.dir)
                self.set_step("animations", state="done", message="ready to preview", origin="ready")
            out["anim_settings"] = anims.read(self.dir)
            out["files"]["animations"] = ARTIFACT["animations"]
            ast = out["steps"]["animations"]
            if ast.get("state") not in ("running", "queued", "error"):
                ast["state"] = "done"
                ast.setdefault("message", "ready to preview")
            # only list clips that actually exist on the rigged character
            rep = self.dir / "rig" / "report.json"
            chk = self.dir / "rig" / "glb_check.json"
            if rep.is_file():
                try:
                    available |= set((json.loads(rep.read_text(encoding="utf-8"))
                                      .get("steps", {}).get("motions") or {}).keys())
                except Exception:
                    pass
            if chk.is_file():
                try:
                    available |= set((json.loads(chk.read_text(encoding="utf-8"))
                                      .get("animations") or {}).keys())
                except Exception:
                    pass
            for cid, meta in (out["anim_settings"].get("clips") or {}).items():
                if meta.get("source") in ("import", "mesh2motion"):
                    available.add(cid)
            # drop phantom builtin entries from settings that aren't on the GLB yet
            if available:
                clipped = {k: v for k, v in out["anim_settings"]["clips"].items()
                           if k in available or v.get("source") in ("import", "mesh2motion")}
                if clipped and clipped != out["anim_settings"]["clips"]:
                    out["anim_settings"]["clips"] = clipped
                    if out["anim_settings"].get("selected") not in clipped:
                        out["anim_settings"]["selected"] = next(iter(clipped))
        else:
            out["anim_settings"] = anims.defaults()
        out["anim_available"] = sorted(available)
        out["anim_clips"] = anims.catalog(out.get("anim_settings"), available or None)
        lib = anims.library_clips()
        out["motion_library"] = lib
        out["motion_library_count"] = len(lib)
        return out


def _slug(name):
    s = re.sub(r"[^A-Za-z0-9_-]+", "_", name.strip()).strip("_")[:40]
    return s or "character"


class Studio:
    def __init__(self, root=None):
        self.root = Path(root or rt.JOBS)
        self.root.mkdir(parents=True, exist_ok=True)
        self.q = queue.Queue()
        self.cancel = threading.Event()
        self.current = None
        self.lock = threading.Lock()
        # leftover Comfy from a killed window holds comfy.db and breaks the next mesh run
        rt.kill_comfy_orphans(self.root)
        threading.Thread(target=self._worker, daemon=True).start()
        for j in self.list():
            for step, s in j.meta["steps"].items():
                if s.get("state") in ("queued", "running"):
                    j.set_step(step, state="error", message="the app was closed while this step ran")

    # ------------------------------------------------------------------ jobs
    def list(self):
        jobs = []
        for d in sorted(self.root.iterdir()):
            if (d / "job.json").is_file():
                try:
                    jobs.append(Job(d))
                except Exception:
                    pass
        return sorted(jobs, key=lambda j: j.meta.get("created", ""), reverse=True)

    def get(self, job_id):
        d = self.root / job_id
        if not (d / "job.json").is_file():
            raise KeyError(job_id)
        return Job(d)

    def create(self, name):
        job_id = f"{_slug(name)}_{uuid.uuid4().hex[:6]}"
        d = self.root / job_id
        d.mkdir(parents=True)
        (d / "job.json").write_text(json.dumps({
            "id": job_id,
            "name": name.strip() or job_id,
            "created": _now(),
            "tpose_settings": tpose.settings_from(),
            "mesh_settings": mesh.settings_from(),
            "anim_settings": anims.defaults(),
            "steps": {s: {"state": "empty"} for s in STEPS},
        }, indent=1))
        return Job(d)

    def delete(self, job_id):
        if self.current and self.current[0] == job_id:
            raise RuntimeError("this character has a step running; cancel it first")
        shutil.rmtree(self.root / job_id)

    # ------------------------------------------------------------- artifacts
    def put_image(self, job, step, data):
        """Source or T-pose image supplied by the user: square-pad to 1024."""
        from io import BytesIO
        from PIL import Image
        im = Image.open(BytesIO(data))
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(bg, im).convert("RGB")
        side = int(max(im.size) * (1.1 if step == "source" else 1.0))
        canvas = Image.new("RGB", (side, side), (255, 255, 255))
        canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
        job.clear_after(step)
        canvas.resize((1024, 1024), Image.LANCZOS).save(job.path(step))
        job.set_step(step, state="done", message="supplied by you", origin="upload")

    def put_mesh(self, job, data):
        job.clear_after("mesh")
        job.path("mesh").write_bytes(data)
        normals.repair(job.path("mesh"))
        job.set_step("mesh", state="done", message="supplied by you, checking…", origin="upload")
        self.enqueue(job, "mesh_check", chain=False)

    def set_mesh_settings(self, job, payload):
        with _META_LOCK:
            job.meta = json.loads(job.meta_path.read_text(encoding="utf-8"))
            cur = dict(job.meta.get("mesh_settings") or {})
            cur.update(payload or {})
            settings = mesh.settings_from(cur)
            job.meta["mesh_settings"] = settings
            job.save()
        return settings

    def set_tpose_settings(self, job, payload):
        with _META_LOCK:
            job.meta = json.loads(job.meta_path.read_text(encoding="utf-8"))
            cur = dict(job.meta.get("tpose_settings") or {})
            merged = dict(payload or {})
            if not merged.get("custom_prompt"):
                if cur.get("custom_prompt"):
                    merged["custom_prompt"] = cur["custom_prompt"]
                elif cur.get("method") == "custom" and cur.get("prompt") and "prompt" not in merged:
                    merged["custom_prompt"] = cur["prompt"]
            settings = tpose.settings_from(merged)
            job.meta["tpose_settings"] = settings
            job.save()
        return settings

    def set_anim_settings(self, job, payload):
        settings = anims.write(job.dir, payload)
        with _META_LOCK:
            job.meta = json.loads(job.meta_path.read_text(encoding="utf-8"))
            job.meta["anim_settings"] = settings
            job.set_step("animations", state="done", message="clips adjusted", origin="edited")
            job.save()
        return settings

    def export_animations(self, job):
        """Re-export Mixamo/AF pack using the current clip enable + speed picks."""
        if not job.has("rig"):
            raise RuntimeError("rig the character first")
        settings = anims.read(job.dir)
        with _META_LOCK:
            job.meta = json.loads(job.meta_path.read_text(encoding="utf-8"))
            job.meta["anim_settings"] = settings
            job.set_step("animations", state="running", message="exporting selected clips", started=_now())
            job.save()
        try:
            self._export_pack(job, with_rig=True, anim_settings=True)
            job.set_step("animations", state="done", message="export ready", origin="exported", finished=_now())
        except Exception:
            job.set_step("animations", state="error", message="export failed")
            raise
        return job.state()

    def import_motion(self, job, data, filename):
        """Append a motion file (FBX/GLB) onto the rigged character as a new clip."""
        if not job.has("rig"):
            raise RuntimeError("rig the character first")
        ext = Path(filename).suffix.lower()
        if ext not in (".fbx", ".glb", ".gltf"):
            raise ValueError("motion must be .fbx or .glb")
        clip_id = anims.safe_clip_id(Path(filename).stem)
        motions = job.dir / "motions"
        motions.mkdir(exist_ok=True)
        src = motions / f"{clip_id}{ext}"
        src.write_bytes(data)
        return self._bake_motion_file(job, src, clip_id, source="import")

    def apply_library_motion(self, job, clip_id):
        """Retarget a Mesh2Motion library clip onto this character (UE5 bones match)."""
        if not job.has("rig"):
            raise RuntimeError("rig the character first")
        src = anims.library_clip_path(clip_id)
        if not src:
            raise ValueError(f"no Mesh2Motion clip named {clip_id}")
        cid = anims.safe_clip_id(clip_id)
        motions = job.dir / "motions"
        motions.mkdir(exist_ok=True)
        # keep a job-local copy so re-rig / pack stays self-contained
        local = motions / f"{cid}.glb"
        if not local.is_file() or local.stat().st_size != src.stat().st_size:
            shutil.copy2(src, local)
        return self._bake_motion_file(job, local, cid, source="mesh2motion",
                                      label=anims._label_from_id(cid))

    def _bake_motion_file(self, job, src, clip_id, source="import", label=None):
        """Run Blender retarget + thumb for a motion file already on disk."""
        blend = job.dir / "rig" / "rigged.blend"
        out = job.dir / "rig"
        job.set_step("animations", state="running",
                     message=f"{'adding' if source == 'mesh2motion' else 'importing'} {clip_id}",
                     started=_now())
        rc = rt.blender("import_motion.py", [blend, src, clip_id, out],
                        self._log(job, "animations"), self.cancel, 900)
        if rc:
            job.set_step("animations", state="error", message="motion import failed")
            raise RuntimeError("motion import failed; see the animations log")
        meta = {}
        mp = out / "import_last.json"
        if mp.is_file():
            meta = json.loads(mp.read_text(encoding="utf-8"))
        frame = int(meta.get("thumb_frame") or meta.get("duration", 30) // 2 or 1)
        rt.blender("render_poses.py", [blend, out / "poses", f"{clip_id}:{frame}"],
                   self._log(job, "animations"), self.cancel, 600)
        settings = anims.read(job.dir)
        settings["clips"][clip_id] = {
            "enabled": True, "speed": 1.0,
            "label": label or clip_id.replace("_", " ").replace("-", " "),
            "frame": frame, "source": source, "builtin": False,
            "duration": meta.get("duration"),
            "fit": anims.default_fit(),
        }
        settings["selected"] = clip_id
        anims.write(job.dir, settings)
        with _META_LOCK:
            job.meta = json.loads(job.meta_path.read_text(encoding="utf-8"))
            job.meta["anim_settings"] = settings
            job.set_step("animations", state="done",
                         message=f"{'added' if source == 'mesh2motion' else 'imported'} {clip_id}",
                         origin=source, finished=_now())
            job.save()
        return job.state()

    def key_clip(self, job, clip_id, frame, pose):
        """Bake a posed key into the selected clip and refresh the preview GLB."""
        if not job.has("rig"):
            raise RuntimeError("rig the character first")
        settings = anims.read(job.dir)
        if clip_id not in settings["clips"]:
            raise ValueError(f"unknown clip {clip_id}")
        blend = job.dir / "rig" / "rigged.blend"
        out = job.dir / "rig"
        pose_path = out / "edit_pose.json"
        pose_path.write_text(json.dumps(pose), encoding="utf-8")
        job.set_step("animations", state="running", message=f"keying {clip_id}@{frame}", started=_now())
        rc = rt.blender("key_clip.py", [blend, out, clip_id, int(frame), pose_path],
                        self._log(job, "animations"), self.cancel, 900)
        if rc:
            job.set_step("animations", state="error", message="key failed")
            raise RuntimeError("could not key this frame; see the animations log")
        meta = {}
        if (out / "key_last.json").is_file():
            meta = json.loads((out / "key_last.json").read_text(encoding="utf-8"))
        thumb_frame = int(settings["clips"][clip_id].get("frame") or frame)
        rt.blender("render_poses.py", [blend, out / "poses", f"{clip_id}:{thumb_frame}"],
                   self._log(job, "animations"), self.cancel, 600)
        settings["clips"][clip_id]["duration"] = meta.get("duration") or settings["clips"][clip_id].get("duration")
        settings["selected"] = clip_id
        anims.write(job.dir, settings)
        with _META_LOCK:
            job.meta = json.loads(job.meta_path.read_text(encoding="utf-8"))
            job.meta["anim_settings"] = settings
            job.set_step("animations", state="done", message=f"keyed {clip_id} frame {frame}",
                         origin="edited", finished=_now())
            job.save()
        return job.state()

    def put_markers(self, job, markers=None, joints=None, reset=False):
        """Update markers and/or skeleton joints (AF-style check before Rig)."""
        det = json.loads(job.path("markers").read_text(encoding="utf-8"))
        if reset:
            markers = {k: list(v) for k, v in det["auto"].items()}
            joints = None
        if not reset and markers is None and joints is None:
            raise ValueError("expected markers or joints")
        if markers is not None:
            from_names = set(det["markers"])
            if set(markers) != from_names:
                raise ValueError(f"expected markers {sorted(from_names)}")
            det["markers"] = {k: [float(c) for c in v] for k, v in markers.items()}
            det["joints"] = _joints_from_pts(job, det)
            if det.get("joints"):
                det["joints_auto"] = {k: list(v) for k, v in det["joints"].items()}
        if joints is not None:
            if not det.get("joints"):
                computed = _joints_from_pts(job, det)
                if not computed:
                    raise ValueError("no skeleton joints yet — run Place markers first")
                det["joints"] = computed
            base = dict(det["joints"])
            for k, v in joints.items():
                if k not in base:
                    raise ValueError(f"unknown joint {k}")
                base[k] = [float(c) for c in v]
            det["joints"] = base
            _sync_markers_from_joints(det)
        ensure_joints(job, det)
        det["off_body"] = off_body(job, det)
        det["joints_off_body"] = joints_off_body(job, det)
        job.clear_after("markers")
        job.path("markers").write_text(json.dumps(det, indent=1), encoding="utf-8")
        job.set_step("markers", state="done",
                     message="skeleton adjusted" if joints is not None else "adjusted by you",
                     origin="edited")
        return det

    # ----------------------------------------------------------------- queue
    def enqueue(self, job, step, chain=False):
        if step not in STEPS + ["mesh_check", "export_anims"]:
            raise ValueError(step)
        if step == "export_anims":
            self.q.put((job.id, step, False))
            return
        if step == "animations":
            # Animations is a review tab — opening/running just refreshes defaults from the rig.
            if not job.has("rig"):
                raise RuntimeError("rig the character first")
            anims.write(job.dir)
            job.set_step("animations", state="done", message="ready to preview", origin="ready")
            return
        if step != "mesh_check":
            steps = job.state()["steps"]
            if not steps[step]["can_run"]:
                prev = STEPS[STEPS.index(step) - 1]
                if step == "rig" and steps[prev]["state"] == "done":
                    raise RuntimeError("move every skeleton joint onto the body first")
                if steps[prev]["state"] == "error":
                    raise RuntimeError(f"{step} can't run: the {prev} step failed - "
                                       f"{steps[prev].get('message', '')}")
                raise RuntimeError(f"{step} can't run yet: finish the {prev} step first")
            kw = {"state": "queued", "message": "waiting for the GPU"}
            # drop leftover fill from a previous mesh so the status scene starts empty
            if step == "mesh":
                kw.update(progress=0.02, phase="queued", stage="")
            job.set_step(step, **kw)
        self.q.put((job.id, step, chain))

    def cancel_current(self, job_id):
        hit = False
        if self.current and self.current[0] == job_id:
            step = self.current[1]
            owner = "mesh" if step == "mesh_check" else step
            self.cancel.set()
            try:
                self.get(job_id).set_step(owner, message="cancelling…")
            except KeyError:
                pass
            hit = True
        # drop queued entries for this job (including chained follow-ups)
        kept = []
        while not self.q.empty():
            item = self.q.get_nowait()
            if item[0] != job_id:
                kept.append(item)
            else:
                self.get(job_id).set_step(item[1], state="empty", message="cancelled")
                hit = True
        for item in kept:
            self.q.put(item)
        return hit

    def _worker(self):
        while True:
            job_id, step, chain = self.q.get()
            try:
                job = self.get(job_id)
            except KeyError:
                continue
            self.cancel.clear()
            self.current = (job_id, step)
            owner = "mesh" if step == "mesh_check" else ("animations" if step == "export_anims" else step)
            try:
                if step == "mesh_check":
                    self._mesh_check(job)
                    continue
                if step == "export_anims":
                    self.export_animations(job)
                    continue
                start_kw = {"state": "running", "message": "starting", "started": _now()}
                if step == "mesh":
                    start_kw.update(progress=0.02, phase="starting", stage="")
                job.set_step(step, **start_kw)
                job.clear_after(step)
                getattr(self, "_run_" + step)(job)
                job.set_step(step, state="done", finished=_now())
                nxt = STEPS[STEPS.index(step) + 1] if step != "animations" else None
                # Stop on the dots. Bind & wear is the button after the joints are moved.
                if chain and nxt == "rig":
                    pass
                elif chain and nxt == "animations" and job.has("rig"):
                    anims.write(job.dir)
                    job.set_step("animations", state="done", message="ready to preview", origin="ready")
                elif chain and nxt and job.state()["steps"][nxt]["can_run"]:
                    self.enqueue(job, nxt, chain=True)
            except rt.Cancelled:
                job.set_step(owner, state="empty", message="cancelled", progress=0, phase="")
                if owner == "tpose":
                    rt.reclaim_workdir(job.dir / "comfy_tpose")
                elif owner == "mesh":
                    rt.reclaim_workdir(job.dir / "comfy_mesh")
            except Exception as e:
                (job.dir / "logs").mkdir(exist_ok=True)
                with open(job.dir / "logs" / f"{owner}.txt", "a", encoding="utf-8") as f:
                    f.write("\n" + traceback.format_exc())
                job.set_step(owner, state="error", message=str(e)[:1200])
            finally:
                self.current = None

    def _log(self, job, step):
        return job.dir / "logs" / f"{step}.txt"

    def _progress(self, job, step):
        return lambda msg: job.set_step(step, message=msg)

    # ----------------------------------------------------------------- steps
    def _run_tpose(self, job):
        work = job.dir / "comfy_tpose"
        rt.reclaim_workdir(work)
        settings = tpose.settings_from(job.meta.get("tpose_settings"))
        with _META_LOCK:
            job.meta = json.loads(job.meta_path.read_text(encoding="utf-8"))
            job.meta["tpose_settings"] = settings
            job.save()
        label = {"standard": "standard", "2_5d": "2.5D", "custom": "custom"}[settings["method"]]
        job.set_step("tpose", message=f"starting Comfy · {label}",
                     method=settings["method"])
        with comfy.Comfy(work, self._log(job, "tpose"), flash=False, cancel=self.cancel) as c:
            shutil.copy(job.path("source"), c.input / "source.png")
            graph = tpose.build_prompt(
                "source.png",
                method=settings["method"],
                prompt=settings["prompt"],
            )["prompt"]
            entry = c.run(graph, 1800, self._progress(job, "tpose"))
        imgs = [i for o in (entry.get("outputs") or {}).values() for i in o.get("images") or []
                if i.get("type") == "output"]
        if not imgs:
            raise RuntimeError("Comfy finished but saved no T-pose image")
        src = work / "output" / imgs[0].get("subfolder", "") / imgs[0]["filename"]
        # Mesh still expects a square RGB tpose; keep alpha-free copy in the job folder.
        from PIL import Image
        Image.open(src).convert("RGB").save(job.path("tpose"))
        shutil.rmtree(work, ignore_errors=True)
        job.set_step("tpose", message=f"T-pose ready · {label}", origin="generated",
                     method=settings["method"])

    def _run_mesh(self, job):
        from PIL import Image
        work = job.dir / "comfy_mesh"
        rt.reclaim_workdir(work)
        settings = mesh.settings_from(job.meta.get("mesh_settings"))
        with _META_LOCK:
            job.meta = json.loads(job.meta_path.read_text(encoding="utf-8"))
            job.meta["mesh_settings"] = settings
            job.save()
        seed = mesh.resolve_seed(settings)
        # Remember the seed actually used (esp. important for random runs).
        settings = dict(settings)
        settings["seed"] = seed
        with _META_LOCK:
            job.meta = json.loads(job.meta_path.read_text(encoding="utf-8"))
            job.meta["mesh_settings"] = settings
            job.save()
        job.set_step("mesh", message=f"starting Comfy · {settings['target_tris'] // 1000}k",
                     progress=0.04, phase="starting Comfy",
                     target_tris=settings["target_tris"], preset=settings["preset"],
                     seed=seed, seed_mode=settings["seed_mode"])

        def on_mesh_progress(msg):
            elapsed = None
            secs = ""
            if "Comfy," in msg:
                secs = " · " + msg.split("Comfy,", 1)[1].strip()
                try:
                    elapsed = float(secs.replace("·", "").replace("s", "").strip().split()[0])
                except (TypeError, ValueError, IndexError):
                    elapsed = None
            fill, label, stage = mesh.stage_progress(work / "output", elapsed_sec=elapsed)
            kw = {"message": label + secs, "progress": fill, "phase": label}
            if stage:
                kw["stage"] = stage
            job.set_step("mesh", **kw)

        with comfy.Comfy(work, self._log(job, "mesh"), flash=True, cancel=self.cancel) as c:
            # Match Desktop: feed the T-pose as-is into Trellis2LoadImageWithTransparency
            # → rembg. Do not flatten to RGB or pre-crush size; preprocess max_size=1536.
            im = Image.open(job.path("tpose"))
            if im.mode not in ("RGBA", "RGB"):
                im = im.convert("RGBA")
            im.save(c.input / "tpose.png")
            prompt = mesh.build("tpose.png", target_tris=settings["target_tris"], seed=seed)
            missing = mesh.missing_models(prompt)
            if missing:
                raise RuntimeError("mesh models missing: " + "; ".join(missing))
            c.run(prompt, 7200, on_mesh_progress)
        glb, stage = mesh.pick_for_rig(work / "output")
        if not glb:
            raise RuntimeError("Comfy finished but saved no mesh")
        shutil.copy(glb, job.path("mesh"))
        normals.repair(job.path("mesh"))
        keep = job.dir / "mesh_stages"
        shutil.rmtree(keep, ignore_errors=True)
        shutil.copytree(work / "output" / "3d", keep)
        shutil.rmtree(work, ignore_errors=True)
        job.set_step("mesh", origin="generated", stage=stage, progress=0.95, phase="checking the mesh")
        self._mesh_check(job, inside_step=True)

    def _mesh_check(self, job, inside_step=False):
        job.set_step("mesh", state="running", message="checking the mesh")
        rc = rt.blender("mesh_check.py", [job.path("mesh"), job.dir / "mesh_check.json"],
                        self._log(job, "mesh"), self.cancel, 600)
        if rc:
            raise RuntimeError("the mesh check could not read this file")
        mc = json.loads((job.dir / "mesh_check.json").read_text(encoding="utf-8"))
        bad = [c["detail"] for c in mc["checks"] if not c["ok"] and c["name"] != "textured"]
        if bad:
            msg = "mesh is not riggable: " + "; ".join(bad)
            if inside_step:
                raise RuntimeError(msg)
            job.set_step("mesh", state="error", message=msg, progress=0, phase="")
        else:
            job.set_step("mesh", state="done", message="mesh check passed", progress=1, phase="done")
            self._export_pack(job, with_rig=False)

    def _export_pack(self, job, with_rig, anim_settings=False):
        """Mixamo FBX + Action Forge mesh GLB; with_rig also writes rigged GLB/FBX."""
        out = job.dir / "export"
        out.mkdir(exist_ok=True)
        args = [job.path("mesh"), out]
        blend = job.dir / "rig" / "rigged.blend"
        if with_rig and blend.is_file():
            args.append(blend)
            if anim_settings:
                anims.read(job.dir)  # ensure file exists
                args.append(job.dir / "animations.json")
        log_step = "animations" if anim_settings else ("rig" if with_rig else "mesh")
        if with_rig and not anim_settings:
            job.set_step("rig", message="writing Mixamo / Action Forge exports")
        rc = rt.blender("export_pack.py", args, self._log(job, log_step), self.cancel, 900)
        if rc:
            raise RuntimeError("export pack failed; see the log")

    def _run_markers(self, job):
        rc = rt.blender("detect_markers.py", [job.path("mesh"), job.path("markers")],
                        self._log(job, "markers"), self.cancel, 600)
        if rc:
            raise RuntimeError("could not place markers on this mesh")
        det = json.loads(job.path("markers").read_text(encoding="utf-8"))
        det["joints_off_body"] = joints_off_body(job, det)
        job.path("markers").write_text(json.dumps(det, indent=1), encoding="utf-8")
        bad = det.get("off_body") or []
        jbad = det.get("joints_off_body") or []
        note = ""
        if bad or jbad:
            note = "; off the body: " + ", ".join(bad + [f"joint:{n}" for n in jbad])
        job.set_step("markers", origin="auto",
                     message=("skeleton placed" if det.get("joints") else "placed automatically") + note)

    def _run_rig(self, job):
        out = job.dir / "rig"
        shutil.rmtree(out, ignore_errors=True)
        job.set_step("rig", message="fitting the skeleton, then weighting each limb on its own")
        rc = rt.blender("rig.py", [job.path("mesh"), out, job.path("markers")], self._log(job, "rig"),
                        self.cancel, 3600)
        if rc or not job.path("rig").is_file():
            raise RuntimeError("rigging failed: " + _last_error(self._log(job, "rig")))
        rep = json.loads((out / "report.json").read_text(encoding="utf-8"))
        copied = rep.get("steps", {}).get("library_clips") or {}
        needed = set(anims.builtin_library_sources())
        if not (needed and needed <= set(copied) and all(copied[k] for k in needed)):
            self._bake_builtin_library(job)
        job.set_step("rig", message="rendering poses")
        rt.blender("render_poses.py", [out / "rigged.blend", out / "poses", *anims.pose_shots()],
                   self._log(job, "rig"), self.cancel, 600)
        chk = subprocess.run([rt.PYTHON, rt.APP / "pipeline" / "glb_check.py", job.path("rig")],
                             capture_output=True, text=True, creationflags=rt.NO_WINDOW)
        m = re.search(r"\{.*\}", chk.stdout, re.S)
        if m:
            (out / "glb_check.json").write_text(m.group(0), encoding="utf-8")
        rep = json.loads((out / "report.json").read_text(encoding="utf-8"))
        gate = rep["steps"]["deform_qa"]["gate"]
        self._export_pack(job, with_rig=True)
        settings = anims.write(job.dir)
        # Mark builtins that came from Mesh2Motion
        for cid in anims.builtin_library_sources():
            if cid in settings["clips"]:
                settings["clips"][cid]["source"] = "mesh2motion"
                settings["clips"][cid]["builtin"] = True
        anims.write(job.dir, settings)
        job.set_step("animations", state="done", message="ready to preview", origin="ready")
        job.set_step("rig", message=f"deformation check {gate}", gate=gate)

    def _bake_builtin_library(self, job, step="rig"):
        """Replace procedural Rig actions with Mesh2Motion clips copied in local bone space."""
        sources = anims.builtin_library_sources()
        if not sources:
            return 0
        blend = job.dir / "rig" / "rigged.blend"
        out = job.dir / "rig"
        motions = job.dir / "motions"
        motions.mkdir(exist_ok=True)
        n = len(sources)
        ok = 0
        for i, (cid, src) in enumerate(sources.items(), 1):
            job.set_step(step, message=f"Mesh2Motion {cid} ({i}/{n})")
            local = motions / f"{cid}.glb"
            shutil.copy2(src, local)
            rc = rt.blender("import_motion.py", [blend, local, cid, out],
                            self._log(job, step), self.cancel, 900)
            if rc:
                # keep procedural action for this clip; continue others
                continue
            ok += 1
        return ok

    def replace_builtins_from_library(self, job):
        """Re-bake Studio builtins from Mesh2Motion onto an already-rigged character."""
        if not job.has("rig"):
            raise RuntimeError("rig the character first")
        sources = anims.builtin_library_sources()
        if not sources:
            raise RuntimeError("Mesh2Motion pack not found under library/mesh2motion")
        job.set_step("animations", state="running",
                     message=f"replacing {len(sources)} builtins from Mesh2Motion", started=_now())
        try:
            ok = self._bake_builtin_library(job, step="animations")
            blend = job.dir / "rig" / "rigged.blend"
            out = job.dir / "rig"
            settings = anims.read(job.dir)
            for cid in sources:
                meta = settings["clips"].setdefault(cid, anims._clip_meta(
                    next((c for c in anims.CLIPS if c["id"] == cid), {"id": cid})))
                meta["source"] = "mesh2motion"
                meta["builtin"] = True
                meta["label"] = next((c["label"] for c in anims.CLIPS if c["id"] == cid), cid)
            anims.write(job.dir, settings)
            rt.blender("render_poses.py", [blend, out / "poses", *anims.pose_shots(settings)],
                       self._log(job, "animations"), self.cancel, 900)
            # refresh clip list so Animations gallery sees the new actions
            chk = subprocess.run([rt.PYTHON, rt.APP / "pipeline" / "glb_check.py", job.path("rig")],
                                 capture_output=True, text=True, creationflags=rt.NO_WINDOW)
            m = re.search(r"\{.*\}", chk.stdout, re.S)
            if m:
                (out / "glb_check.json").write_text(m.group(0), encoding="utf-8")
            with _META_LOCK:
                job.meta = json.loads(job.meta_path.read_text(encoding="utf-8"))
                job.meta["anim_settings"] = settings
                job.set_step("animations", state="done",
                             message=f"replaced {ok}/{len(sources)} builtins with Mesh2Motion",
                             origin="mesh2motion", finished=_now())
                job.save()
        except Exception:
            job.set_step("animations", state="error", message="Mesh2Motion builtin replace failed")
            raise
        return job.state()


# Joints that map back onto the 8 AF markers when the user nudges the skeleton.
_JOINT_MARKER = {
    "lowerarm_l": "elbow_l", "lowerarm_r": "elbow_r",
    "hand_l": "wrist_l", "hand_r": "wrist_r",
    "calf_l": "knee_l", "calf_r": "knee_r",
}
# Key deform joints that must sit on the body before Rig.
_JOINT_GATE = (
    "pelvis", "neck", "head",
    "upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r", "hand_l", "hand_r",
    "thigh_l", "thigh_r", "calf_l", "calf_r", "foot_l", "foot_r",
)


def _mk():
    from .blender import markers as mk
    return mk


def _pts(job):
    import numpy as np
    p = job.dir / "markers_pts.npy"
    return np.load(p) if p.is_file() else None


def _joints_from_pts(job, det):
    P = _pts(job)
    if P is None:
        return det.get("joints")
    return _mk().joints_from_markers(P, det)


def _sync_markers_from_joints(det):
    J, M, H = det.get("joints") or {}, det["markers"], float(det["height"])
    for jn, mn in _JOINT_MARKER.items():
        if jn in J:
            M[mn] = [float(c) for c in J[jn]]
    if "neck" in J:
        n = J["neck"]
        M["chin"] = [float(n[0]), float(n[1]), float(n[2] + 0.025 * H)]
    if "pelvis" in J:
        p = J["pelvis"]
        M["groin"] = [float(p[0]), float(p[1]), float(p[2] - 0.05 * H)]


def ensure_joints(job, det):
    """Fill joints / joints_off_body on older marker files that predate the skeleton step."""
    changed = False
    if not det.get("joints"):
        J = _joints_from_pts(job, det)
        if J:
            det["joints"] = J
            det.setdefault("joints_auto", {k: list(v) for k, v in J.items()})
            changed = True
    if "joints_off_body" not in det and det.get("joints") and (job.dir / "markers_xz.npy").is_file():
        det["joints_off_body"] = joints_off_body(job, det)
        changed = True
    if changed and job.path("markers").is_file():
        job.path("markers").write_text(json.dumps(det, indent=1), encoding="utf-8")
    return det


def off_body(job, det, tol=0.015):
    """Same rule as markers.off_body: mesh must exist under the marker in the front view."""
    import numpy as np
    P = np.load(job.dir / "markers_xz.npy")
    H = det["height"]
    return [k for k, m in det["markers"].items()
            if np.min(np.hypot(P[:, 0] - m[0], P[:, 1] - m[2])) > tol * H]


def joints_off_body(job, det, tol=0.02):
    """Front-view gate for the skeleton joints the user is checking."""
    import numpy as np
    J = det.get("joints") or {}
    if not J or not (job.dir / "markers_xz.npy").is_file():
        return []
    P = np.load(job.dir / "markers_xz.npy")
    H = float(det["height"])
    bad = []
    for name in _JOINT_GATE:
        m = J.get(name)
        if m is None:
            continue
        if np.min(np.hypot(P[:, 0] - m[0], P[:, 1] - m[2])) > tol * H:
            bad.append(name)
    return bad


def _last_error(log):
    try:
        lines = [l for l in Path(log).read_text(encoding="utf-8", errors="replace").splitlines() if l.strip()]
    except OSError:
        return "no log"
    for l in reversed(lines):
        if "Error" in l and not l.startswith("Error: script failed"):
            return l.strip()[:400]
    return lines[-1][:400] if lines else "no log"
