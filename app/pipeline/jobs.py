"""Job steps for the clean build. New file.

markers.json lives in the job folder. A write accepts the eight dot names
or a joints dict. Shoulder, hip, and ankle persist only as joints.
A pose edit clears the skeleton check, the rig, and the animations.
"""
import json
import shutil
import threading
import time
import uuid
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

from . import bodymath, desk, mesh, motions, runtime as rt, tpose

STEPS = ["source", "tpose", "mesh", "markers", "skeleton", "rig", "animations"]
ORDER = {name: i for i, name in enumerate(STEPS)}


def _now():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _slug(name):
    token = "".join(ch.lower() if ch.isalnum() else "_" for ch in (name or "character")).strip("_")
    return (token or "character")[:24]


class Job:
    def __init__(self, folder: Path):
        self.dir = folder
        self.meta_path = folder / "job.json"
        self.meta = json.loads(self.meta_path.read_text(encoding="utf-8")) if self.meta_path.is_file() else {}
        self.meta.setdefault("id", folder.name)
        self.meta.setdefault("name", folder.name)
        self.meta.setdefault("created", _now())
        self.meta.setdefault("tpose_settings", tpose.settings_from({}))
        self.meta.setdefault("mesh_settings", mesh.settings_from({}))
        self.meta.setdefault("skeleton_seen", False)
        self.meta.setdefault("steps", {})
        for step in STEPS:
            self.meta["steps"].setdefault(step, {"state": "empty"})
        self._cloud = None

    def save(self):
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self.meta_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.meta, indent=1), encoding="utf-8")
        tmp.replace(self.meta_path)

    def path(self, name):
        return {
            "source": self.dir / "source.png",
            "tpose": self.dir / "tpose.png",
            "mesh": self.dir / "mesh.glb",
            "markers": self.dir / "markers.json",
            "surface": self.dir / "surface.npy",
            "rig": self.dir / "rig" / "rigged_animated.glb",
            "blend": self.dir / "rig" / "rigged.blend",
            "animations": self.dir / "animations.json",
            "check": self.dir / "mesh_check.json",
        }[name]

    def set_step(self, step, **fields):
        row = self.meta["steps"].setdefault(step, {})
        row.update(fields)
        row["updated"] = _now()
        self.save()

    def clear_after(self, step):
        for name in STEPS:
            if ORDER[name] <= ORDER[step]:
                continue
            row = self.meta["steps"].setdefault(name, {})
            row.clear()
            row["state"] = "empty"
            if name == "markers":
                self.path("markers").unlink(missing_ok=True)
                self.path("surface").unlink(missing_ok=True)
            elif name == "rig":
                shutil.rmtree(self.dir / "rig", ignore_errors=True)
                shutil.rmtree(self.dir / "export", ignore_errors=True)
            elif name == "animations":
                self.path("animations").unlink(missing_ok=True)
            elif name == "skeleton":
                self.meta["skeleton_seen"] = False
        if step == "markers":
            self.meta["skeleton_seen"] = False
            self.meta["steps"]["skeleton"] = {"state": "empty"}
            shutil.rmtree(self.dir / "rig", ignore_errors=True)
            shutil.rmtree(self.dir / "export", ignore_errors=True)
            self.path("animations").unlink(missing_ok=True)
        self.save()

    def cloud(self):
        if self._cloud is None and self.path("surface").is_file():
            self._cloud = np.load(self.path("surface"))
        return self._cloud

    def markers(self):
        path = self.path("markers")
        if not path.is_file():
            return None
        det = json.loads(path.read_text(encoding="utf-8"))
        cloud = self.cloud()
        if cloud is not None and det.get("markers"):
            bad_m, bad_j = bodymath.listed_off(cloud, det)
            det["off_body"] = bad_m
            det["joints_off_body"] = bad_j
        return det

    def state(self):
        files = {
            "source": self.path("source").is_file(),
            "tpose": self.path("tpose").is_file(),
            "mesh": self.path("mesh").is_file(),
            "markers": self.path("markers").is_file(),
            "rig": self.path("rig").is_file(),
            "animations": self.path("animations").is_file(),
        }
        det = self.markers()
        off = (det or {}).get("off_body") or []
        joff = (det or {}).get("joints_off_body") or []
        seen = bool(self.meta.get("skeleton_seen"))
        running = next((s for s in STEPS if self.meta["steps"][s].get("state") == "running"), None)
        can = {
            "source": running is None,
            "tpose": running is None and files["source"],
            "mesh": running is None and files["tpose"],
            "markers": running is None and files["mesh"],
            "skeleton": running is None and files["markers"],
            "rig": running is None and files["markers"] and seen and not off and not joff,
            "animations": running is None and files["rig"],
        }
        check = None
        if self.path("check").is_file():
            check = json.loads(self.path("check").read_text(encoding="utf-8"))
        anim = motions.read_settings(self.dir) if files["rig"] or files["animations"] else None
        return {
            "id": self.meta["id"],
            "name": self.meta["name"],
            "steps": self.meta["steps"],
            "files": files,
            "can_run": can,
            "running": running,
            "tpose_settings": self.meta.get("tpose_settings"),
            "mesh_settings": self.meta.get("mesh_settings"),
            "mesh_check": check,
            "markers": det,
            "off_body": off,
            "joints_off_body": joff,
            "skeleton_seen": seen,
            "animations": anim,
            "motion_library_count": len(motions.library_clips()),
        }


class Studio:
    def __init__(self):
        rt.JOBS.mkdir(parents=True, exist_ok=True)
        self.jobs = {}
        for folder in sorted(p for p in rt.JOBS.iterdir() if p.is_dir()):
            if (folder / "job.json").is_file():
                job = Job(folder)
                self.jobs[job.meta["id"]] = job

    def create(self, name):
        ident = f"{_slug(name)}_{uuid.uuid4().hex[:6]}"
        folder = rt.JOBS / ident
        folder.mkdir(parents=True)
        job = Job(folder)
        job.meta["id"] = ident
        job.meta["name"] = name or "Character"
        job.save()
        self.jobs[ident] = job
        return job

    def get(self, ident):
        job = self.jobs.get(ident)
        if job is None:
            raise KeyError(ident)
        return job

    def delete(self, ident):
        job = self.get(ident)
        running = next((s for s in STEPS if job.meta["steps"][s].get("state") == "running"), None)
        if running:
            raise RuntimeError(f"{job.meta['name']} is still running {running}")
        folder = job.dir.resolve()
        root = rt.JOBS.resolve()
        if folder != root and root not in folder.parents:
            raise RuntimeError("job folder is outside the jobs directory")
        rt.kill_comfy_orphans(folder)
        self.jobs.pop(ident, None)
        shutil.rmtree(folder, ignore_errors=True)
        if folder.exists():
            raise RuntimeError("could not remove the job folder")

    def run(self, job, step):
        if step not in STEPS:
            raise ValueError(f"unknown step {step}")
        if job.meta["steps"][step].get("state") == "running":
            return job.state()
        threading.Thread(target=self._execute, args=(job, step), daemon=True).start()
        return job.state()

    def _execute(self, job, step):
        job.set_step(step, state="running", message=f"running {step}", started=_now())
        try:
            if step == "source":
                raise RuntimeError("source is an upload — choose an image")
            if step == "tpose":
                self._tpose(job)
            elif step == "mesh":
                self._mesh(job)
            elif step == "markers":
                self._markers(job)
            elif step == "skeleton":
                job.meta["skeleton_seen"] = True
                job.set_step("skeleton", state="done", message="skeleton ready to check")
                return
            elif step == "rig":
                self._rig(job)
            elif step == "animations":
                if not job.path("animations").is_file():
                    motions.write_settings(job.dir, motions.fresh_settings())
                job.set_step("animations", state="done", message="motions ready")
                return
            job.set_step(step, state="done", message=job.meta["steps"][step].get("message") or "done", finished=_now())
        except Exception as exc:
            job.set_step(step, state="error", message=str(exc), finished=_now())

    def _tpose(self, job):
        settings = tpose.settings_from(job.meta.get("tpose_settings"))
        image = desk.upload_image(job.path("source"))
        built = tpose.build_prompt(
            image, method=settings["method"], prompt=settings["prompt"],
            filename_prefix=f"studio_{job.meta['id']}_tpose",
        )
        desk.queue(built["prompt"], built.get("client_id") or "character-studio", timeout=1800)
        found = desk.newest(rt.COMFY / "output", f"studio_{job.meta['id']}_tpose*.png")
        if found is None:
            raise RuntimeError("T-pose image was not written")
        shutil.copyfile(found, job.path("tpose"))
        job.clear_after("tpose")
        job.set_step("tpose", state="running", message="T-pose ready")

    def _mesh(self, job):
        settings = mesh.settings_from(job.meta.get("mesh_settings"))
        seed = mesh.resolve_seed(settings)
        settings["seed_used"] = seed
        job.meta["mesh_settings"] = settings
        image = desk.upload_image(job.path("tpose"))
        prompt = mesh.build(image, target_tris=settings["target_tris"], seed=seed)
        desk.queue(prompt, "character-studio", timeout=7200)
        found, _stage = mesh.pick_for_rig(rt.COMFY / "output")
        if found is None:
            raise RuntimeError("mesh was not written")
        shutil.copyfile(found, job.path("mesh"))
        self._check_mesh(job)
        job.clear_after("mesh")
        job.set_step("mesh", state="running", message="mesh check passed")

    def _check_mesh(self, job):
        log = job.dir / "logs" / "mesh_check.txt"
        log.parent.mkdir(exist_ok=True)
        code = rt.blender("check_mesh.py", [str(job.path("mesh")), str(job.path("check"))], log, None, 600)
        if code != 0 or not job.path("check").is_file():
            raise RuntimeError("mesh check failed")

    def _markers(self, job):
        log = job.dir / "logs" / "markers.txt"
        log.parent.mkdir(exist_ok=True)
        code = rt.blender(
            "place_dots.py",
            [str(job.path("mesh")), str(job.path("markers")), str(job.path("surface"))],
            log, None, 900,
        )
        if code != 0 or not job.path("markers").is_file():
            raise RuntimeError("could not place dots on this mesh")
        job._cloud = None
        det = job.markers() or {}
        bad = (det.get("off_body") or []) + (det.get("joints_off_body") or [])
        note = ("; off the body: " + ", ".join(bad)) if bad else ""
        job.clear_after("markers")
        job.set_step("markers", state="running", message="dots placed" + note, origin="auto")

    def _rig(self, job):
        det = job.markers()
        if not det or not det.get("joints"):
            raise RuntimeError("place the dots and check the skeleton first")
        bad = (det.get("off_body") or []) + [f"joint {n}" for n in (det.get("joints_off_body") or [])]
        if bad:
            raise RuntimeError("still off the body: " + ", ".join(bad))
        if not job.meta.get("skeleton_seen"):
            raise RuntimeError("open the skeleton and check it before binding")
        out = job.dir / "rig"
        shutil.rmtree(out, ignore_errors=True)
        out.mkdir()
        log = job.dir / "logs" / "rig.txt"
        log.parent.mkdir(exist_ok=True)
        library = str(rt.PKG / "library" / "mesh2motion")
        code = rt.blender(
            "wear.py",
            [str(job.path("mesh")), str(job.path("markers")), str(out), library],
            log, None, 3600,
        )
        if code != 0 or not job.path("rig").is_file():
            raise RuntimeError("binding failed")
        if not job.path("animations").is_file():
            motions.write_settings(job.dir, motions.fresh_settings())
        shots = [f"{c['id']}:{c['frame']}" for c in motions.BUILTIN]
        rt.blender("stills.py", [str(job.path("blend")), str(out / "poses"), *shots], log, None, 900)
        export = job.dir / "export"
        export.mkdir(exist_ok=True)
        shutil.copyfile(job.path("rig"), export / "rigged_animated.glb")
        report = {}
        report_path = out / "report.json"
        if report_path.is_file():
            report = json.loads(report_path.read_text(encoding="utf-8"))
        gate = ((report.get("steps") or {}).get("deform_qa") or {}).get("gate") or "PASS"
        job.set_step("rig", state="running", message=f"deformation check {gate}", gate=gate)

    def put_image(self, job, step, raw: bytes):
        if step not in ("source", "tpose"):
            raise ValueError(f"you can't upload a {step}")
        _square(raw, job.path(step), 1.1 if step == "source" else 1.0)
        job.clear_after(step)
        job.set_step(step, state="done", message="uploaded", origin="upload", finished=_now())
        return job.state()

    def put_mesh(self, job, raw: bytes):
        if raw[:4] != b"glTF":
            raise ValueError("mesh upload is .glb only")
        job.path("mesh").write_bytes(raw)
        self._check_mesh(job)
        job.clear_after("mesh")
        job.set_step("mesh", state="done", message="mesh check passed", origin="upload", finished=_now())
        return job.state()

    def set_tpose_settings(self, job, payload):
        current = job.meta.get("tpose_settings") or {}
        job.meta["tpose_settings"] = tpose.settings_from({**current, **(payload or {})})
        job.save()
        return job.state()

    def set_mesh_settings(self, job, payload):
        current = job.meta.get("mesh_settings") or {}
        job.meta["mesh_settings"] = mesh.settings_from({**current, **(payload or {})})
        job.save()
        return job.state()

    def see_skeleton(self, job):
        job.meta["skeleton_seen"] = True
        if job.path("markers").is_file():
            job.set_step("skeleton", state="done", message="skeleton on the mesh")
        else:
            job.save()
        return job.state()

    def put_markers(self, job, markers=None, joints=None, reset=False, moved=None,
                    envelopes=None, tags=None, fingers=None, finger_tips=None):
        det = json.loads(job.path("markers").read_text(encoding="utf-8"))
        cloud = job.cloud()
        if reset:
            markers = {k: list(v) for k, v in det["auto"].items()}
            joints = None
        if markers is not None:
            if set(markers) != set(det["markers"]):
                raise ValueError("expected the eight dots")
            det["markers"] = {k: [float(c) for c in v] for k, v in markers.items()}
            if cloud is None:
                raise ValueError("surface sample missing — place the dots again")
            det["joints"] = bodymath.joints_from_markers(cloud, det)
            det["joints_auto"] = {k: list(v) for k, v in det["joints"].items()}
        if joints is not None:
            base = dict(det.get("joints") or {})
            for key, value in joints.items():
                if key not in base:
                    raise ValueError(f"unknown joint {key}")
                base[key] = [float(c) for c in value]
            det["joints"] = base
            _sync_markers(det)
            if cloud is not None and moved in ("chin", "groin") and markers is None:
                bodymath._place_spine(cloud, det["joints"], float(det["height"]))
        if envelopes is not None:
            stored = dict(det.get("envelopes") or {})
            for key, value in envelopes.items():
                if key not in bodymath.ENVELOPE_BONES:
                    continue
                scale = float(value)
                if not 0.5 <= scale <= 2:
                    raise ValueError(f"envelope {key} out of range")
                stored[key] = scale
            det["envelopes"] = stored
        if tags is not None:
            stored = dict(det.get("tags") or {})
            for key, value in tags.items():
                if value not in ("body", "cloth", "prop"):
                    raise ValueError(f"unknown tag {value}")
                if value == "body":
                    stored.pop(key, None)
                else:
                    stored[key] = value
            det["tags"] = stored
        if fingers is not None:
            if fingers not in ("five", "four", "three", "mitten"):
                raise ValueError("fingers must be five, four, three, or mitten")
            det["fingers"] = fingers
        if finger_tips is not None:
            if not isinstance(finger_tips, dict):
                raise ValueError("finger tips must be a map")
            clean = {}
            for key, value in finger_tips.items():
                digit, _, side = str(key).partition("_")
                if digit not in ("index", "middle", "ring", "pinky", "thumb") or side not in ("l", "r"):
                    raise ValueError(f"unknown finger {key}")
                if not isinstance(value, (list, tuple)) or len(value) != 3:
                    raise ValueError(f"finger {key} needs three numbers")
                clean[key] = [float(c) for c in value]
            det["finger_tips"] = clean
        if cloud is not None:
            bad_m, bad_j = bodymath.listed_off(cloud, det)
            det["off_body"] = bad_m
            det["joints_off_body"] = bad_j
        pose_edit = reset or markers is not None or joints is not None or finger_tips is not None
        if pose_edit:
            job.meta["skeleton_seen"] = False
        if pose_edit or envelopes is not None or tags is not None or fingers is not None:
            job.clear_after("skeleton")
        job.path("markers").write_text(json.dumps(det, indent=1), encoding="utf-8")
        job._cloud = None
        label = (moved or "").strip().replace("_", " ")
        if not label or len(label) > 24 or not label.replace(" ", "").isalnum():
            label = ""
        if label:
            message = f"{label} adjusted"
        elif envelopes is not None:
            message = "envelopes adjusted"
        elif tags is not None:
            message = "cloth and props adjusted"
        elif fingers is not None:
            message = "fingers adjusted"
        elif reset:
            message = "dots reset"
        else:
            message = "skeleton adjusted"
        job.set_step("markers", state="done", message=message, origin="edited")
        return job.state()

    def set_anim(self, job, payload):
        settings = motions.read_settings(job.dir)
        clips = settings.setdefault("clips", {})
        if payload.get("selected"):
            settings["selected"] = str(payload["selected"])
        for cid, patch in (payload.get("clips") or {}).items():
            row = clips.setdefault(cid, {
                "enabled": True, "speed": 1, "label": cid, "fit": motions.default_fit(),
            })
            if "enabled" in patch:
                row["enabled"] = bool(patch["enabled"])
            if "speed" in patch:
                row["speed"] = max(0.25, min(3.0, float(patch["speed"])))
            if "fit" in patch:
                row["fit"] = motions.fit_from(patch["fit"])
            if "label" in patch:
                row["label"] = str(patch["label"])[:48]
        motions.write_settings(job.dir, settings)
        job.set_step("animations", state="done", message="clips adjusted", origin="edited")
        return job.state()

    def put_motion(self, job, filename, raw: bytes):
        stem = Path(filename or "motion").name
        ext = Path(stem).suffix.lower()
        if ext not in {".glb", ".gltf"}:
            raise ValueError("import a .glb or .gltf motion")
        if ext == ".glb" and raw[:4] != b"glTF":
            raise ValueError("that file is not a glb motion")
        if ext == ".gltf" and not raw.lstrip().startswith(b"{"):
            raise ValueError("that file is not a gltf motion")
        clip_id = motions.safe_id("import_" + Path(stem).stem)
        folder = job.dir / "motions"
        folder.mkdir(exist_ok=True)
        rel = f"motions/{clip_id}{ext}"
        (job.dir / rel).write_bytes(raw)
        settings = motions.read_settings(job.dir)
        settings.setdefault("clips", {})[clip_id] = {
            "enabled": True,
            "speed": 1,
            "label": motions.label_of(Path(stem).stem),
            "frame": 1,
            "source": "import",
            "file": rel,
            "fit": motions.default_fit(),
        }
        settings["selected"] = clip_id
        motions.write_settings(job.dir, settings)
        job.set_step("animations", state="done", message="motion imported", origin="upload")
        return job.state()

    def add_library_clip(self, job, clip_id):
        settings = motions.read_settings(job.dir)
        if clip_id not in settings["clips"]:
            match = next((c for c in motions.library_clips() if c["id"] == clip_id), None)
            if match is None:
                raise ValueError(f"unknown motion {clip_id}")
            settings["clips"][clip_id] = {
                "enabled": True, "speed": 1, "label": match["label"], "frame": 1,
                "source": "library", "fit": motions.default_fit(),
            }
        settings["selected"] = clip_id
        motions.write_settings(job.dir, settings)
        job.set_step("animations", state="done", message=f"added {clip_id}", origin="edited")
        return job.state()

    def remove_clip(self, job, clip_id):
        settings = motions.read_settings(job.dir)
        clips = settings.setdefault("clips", {})
        row = clips.pop(str(clip_id), None)
        self._drop_import(job, row)
        motions.write_settings(job.dir, settings)
        job.set_step("animations", state="done", message="motion removed", origin="edited")
        return job.state()

    def _drop_import(self, job, row):
        if not row or row.get("source") != "import" or not row.get("file"):
            return
        path = (job.dir / row["file"]).resolve()
        root = (job.dir / "motions").resolve()
        if root in path.parents:
            path.unlink(missing_ok=True)

    def clear_clips(self, job):
        settings = motions.read_settings(job.dir)
        for row in (settings.get("clips") or {}).values():
            self._drop_import(job, row)
        settings["clips"] = {}
        settings["selected"] = ""
        motions.write_settings(job.dir, settings)
        job.set_step("animations", state="done", message="saved motions cleared", origin="edited")
        return job.state()

    def _clip_file(self, job, clip_id, row):
        if row.get("source") == "import" and row.get("file"):
            path = job.dir / row["file"]
            if path.is_file():
                return path
        builtin = next((clip for clip in motions.BUILTIN if clip["id"] == clip_id), None)
        if builtin:
            path = motions.LIBRARY / "animations" / builtin["file"]
            if path.is_file():
                return path
        path = motions.LIBRARY / "animations" / f"{clip_id}.glb"
        if path.is_file():
            return path
        return None

    def export_package(self, job):
        if not job.path("rig").is_file():
            raise RuntimeError("bind the character before export")
        settings = motions.read_settings(job.dir)
        clips = settings.get("clips") or {}
        if not clips:
            raise RuntimeError("add a motion before export")
        manifest = []
        for clip_id, row in clips.items():
            src = self._clip_file(job, clip_id, row)
            manifest.append({"id": clip_id, "file": str(src) if src else ""})
        export_dir = job.dir / "export"
        export_dir.mkdir(exist_ok=True)
        manifest_path = export_dir / "pack.json"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        slug = "".join(ch.lower() if ch.isalnum() else "_" for ch in (job.meta.get("name") or "character")).strip("_") or "character"
        out = export_dir / f"{slug}.glb"
        log = job.dir / "logs" / "export.txt"
        log.parent.mkdir(exist_ok=True)
        code = rt.blender("pack.py", [str(job.path("rig")), str(manifest_path), str(out)], log, None, 3600)
        if code != 0 or not out.is_file():
            raise RuntimeError("export failed")
        job.set_step("animations", state="done", message="export ready", origin="edited")
        state = job.state()
        state["download"] = f"export/{out.name}"
        return state


def _sync_markers(det):
    joints = det.get("joints") or {}
    markers = det["markers"]
    height = float(det["height"])
    link = {
        "lowerarm_l": "elbow_l", "lowerarm_r": "elbow_r",
        "hand_l": "wrist_l", "hand_r": "wrist_r",
        "calf_l": "knee_l", "calf_r": "knee_r",
    }
    for joint_name, marker_name in link.items():
        if joint_name in joints:
            markers[marker_name] = [float(c) for c in joints[joint_name]]
    if "neck" in joints:
        neck = joints["neck"]
        markers["chin"] = [float(neck[0]), float(neck[1]), float(neck[2] + 0.025 * height)]
    if "pelvis" in joints:
        pelvis = joints["pelvis"]
        markers["groin"] = [float(pelvis[0]), float(pelvis[1]), float(pelvis[2] - 0.05 * height)]


def _square(raw: bytes, dest: Path, pad: float):
    image = Image.open(BytesIO(raw)).convert("RGB")
    side = int(max(image.size) * pad)
    canvas = Image.new("RGB", (side, side), (18, 18, 20))
    canvas.paste(image, ((side - image.width) // 2, (side - image.height) // 2))
    canvas.resize((1024, 1024), Image.Resampling.LANCZOS).save(dest, "PNG")
