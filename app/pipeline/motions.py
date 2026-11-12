"""Motion library and per-clip fit. The pose files stay in library/mesh2motion."""
import json
import re
from pathlib import Path

from . import runtime as rt

LIBRARY = rt.PKG / "library" / "mesh2motion"
PREVIEWS = LIBRARY / "preview_index.json"

BUILTIN = (
    {"id": "idle", "label": "Idle", "file": "idle-subtle.glb", "frame": 30},
    {"id": "walk", "label": "Walk", "file": "walk.glb", "frame": 9},
    {"id": "mild_crouch", "label": "Mild crouch", "file": "crouch-idle.glb", "frame": 20},
    {"id": "wave", "label": "Wave", "file": "greeting.glb", "frame": 26},
    {"id": "farm_harvest", "label": "Farm harvest", "file": "farm-harvest.glb", "frame": 18},
    {"id": "run", "label": "Run", "file": "jog.glb", "frame": 8},
    {"id": "jump", "label": "Jump", "file": "jump-2.glb", "frame": 20},
    {"id": "sit", "label": "Sit", "file": "sitting-idle.glb", "frame": 30},
    {"id": "cheer", "label": "Cheer", "file": "victory-fist-pump.glb", "frame": 24},
    {"id": "bow", "label": "Bow", "file": "bow.glb", "frame": 24},
    {"id": "clap", "label": "Clap", "file": "clapping.glb", "frame": 18},
    {"id": "point", "label": "Point", "file": "interact.glb", "frame": 22},
)


def default_fit():
    return {
        "hip": 0.0, "arms": 1.0, "legs": 1.0,
        "arm_space": 0.0, "arm_fwd": 0.0, "turn": 0.0, "leg_space": 0.0,
    }


def _clip(value, lo, hi, fallback):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(lo, min(hi, value))


def fit_from(payload):
    base = default_fit()
    payload = payload or {}
    if "arm_raise" in payload and "arm_space" not in payload:
        payload = dict(payload)
        payload["arm_space"] = payload["arm_raise"]
    base["hip"] = _clip(payload.get("hip", 0), -0.25, 0.25, 0)
    base["arms"] = _clip(payload.get("arms", 1), 0, 1.5, 1)
    base["legs"] = _clip(payload.get("legs", 1), 0, 1.5, 1)
    base["arm_space"] = _clip(payload.get("arm_space", 0), -120, 120, 0)
    base["arm_fwd"] = _clip(payload.get("arm_fwd", 0), -120, 120, 0)
    base["turn"] = _clip(payload.get("turn", 0), -45, 45, 0)
    base["leg_space"] = _clip(payload.get("leg_space", 0), -80, 80, 0)
    return base


def fresh_settings():
    clips = {}
    for clip in BUILTIN:
        clips[clip["id"]] = {
            "enabled": True,
            "speed": 1.0,
            "label": clip["label"],
            "frame": clip["frame"],
            "source": "builtin",
            "fit": default_fit(),
        }
    return {"selected": "walk", "clips": clips}


def read_settings(folder: Path):
    path = folder / "animations.json"
    if not path.is_file():
        return fresh_settings()
    data = json.loads(path.read_text(encoding="utf-8"))
    data.setdefault("selected", "walk")
    data.setdefault("clips", {})
    return data


def write_settings(folder: Path, settings):
    (folder / "animations.json").write_text(json.dumps(settings, indent=1), encoding="utf-8")


def label_of(stem: str) -> str:
    return stem.replace("-", " ").replace("_", " ").strip().title()


def library_clips():
    preview = {}
    if PREVIEWS.is_file():
        preview = json.loads(PREVIEWS.read_text(encoding="utf-8")).get("urls") or {}
    clips = []
    listing = LIBRARY / "clip_list.txt"
    names = [ln.strip() for ln in listing.read_text(encoding="utf-8").splitlines() if ln.strip()]
    for name in names:
        stem = Path(name).stem
        family = stem.split("-")[0]
        clips.append({
            "id": stem,
            "label": label_of(stem),
            "family": family,
            "preview": preview.get(stem),
            "file": f"animations/{stem}.glb",
        })
    return clips


def safe_id(name: str) -> str:
    token = re.sub(r"[^A-Za-z0-9_-]+", "_", (name or "motion").strip()).strip("_").lower()
    return (token or "motion")[:48]
