"""Studio motion library — built-in clips (like idle/walk/…) plus imports & edits.

Mesh2Motion human pack (CC0, same UE5 bones AF uses) lives at:
  <pkg>/library/mesh2motion/animations/*.glb
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from . import runtime as rt

# Mesh2Motion pack — Action Forge's motion library, owned by Studio on disk.
LIBRARY_ROOT = rt.PKG / "library" / "mesh2motion"
LIBRARY_ANIMS = LIBRARY_ROOT / "animations"

# Built-in library Rig bakes. frame = contact-sheet / thumb pose.
# Keep the original five, then AF-style extras owned by Studio (not AF folder sync).
CLIPS = (
    {"id": "idle", "label": "Idle", "frame": 30, "builtin": True},
    {"id": "walk", "label": "Walk", "frame": 9, "builtin": True},
    {"id": "mild_crouch", "label": "Mild crouch", "frame": 20, "builtin": True},
    {"id": "wave", "label": "Wave", "frame": 26, "builtin": True},
    {"id": "farm_harvest", "label": "Farm harvest", "frame": 18, "builtin": True},
    {"id": "run", "label": "Run", "frame": 8, "builtin": True},
    {"id": "jump", "label": "Jump", "frame": 20, "builtin": True},
    {"id": "sit", "label": "Sit", "frame": 30, "builtin": True},
    {"id": "cheer", "label": "Cheer", "frame": 24, "builtin": True},
    {"id": "bow", "label": "Bow", "frame": 24, "builtin": True},
    {"id": "clap", "label": "Clap", "frame": 18, "builtin": True},
    {"id": "point", "label": "Point", "frame": 22, "builtin": True},
)

DEFAULT_SELECTED = "walk"
BUILTIN_IDS = {c["id"] for c in CLIPS}

# Studio builtin id → Mesh2Motion clip stem (real AF pack). Procedural rig.py
# motions are placeholders; Rig replaces these when the pack is on disk.
BUILTIN_MESH2MOTION = {
    "idle": "idle-subtle",
    "walk": "walk",
    "mild_crouch": "crouch-idle",
    "wave": "greeting",          # no dedicated wave; greeting is the hand raise
    "farm_harvest": "farm-harvest",
    "run": "jog",                 # milder than run-anime on stylized bodies
    "jump": "jump-2",
    "sit": "sitting-idle",
    "cheer": "victory-fist-pump",
    "bow": "bow",
    "clap": "clapping",
    "point": "interact",
}


def default_fit():
    # Action Forge offset table (armSpace / armFwd): additive degrees, neutral 0.
    # arms/legs: overdrive / stance motion amount (1 = authored)
    # hip/turn: pelvis offset + yaw
    return {
        "hip": 0.0,
        "arms": 1.0,
        "legs": 1.0,
        "arm_space": 0.0,
        "arm_fwd": 0.0,
        "turn": 0.0,
    }


def _clip_meta(c, enabled=True, speed=1.0, source="builtin"):
    return {
        "enabled": bool(enabled),
        "speed": float(speed),
        "label": c.get("label") or c["id"].replace("_", " ").title(),
        "frame": int(c.get("frame") or 1),
        "source": source,
        "builtin": bool(c.get("builtin")),
        "duration": c.get("duration"),
        "fit": default_fit(),
    }


def defaults() -> dict:
    return {
        "selected": DEFAULT_SELECTED,
        "clips": {c["id"]: _clip_meta(c) for c in CLIPS},
    }


def settings_from(payload=None) -> dict:
    base = defaults()
    if not payload:
        return base
    src = payload.get("clips") or {}
    out_clips = {}
    for cid, meta in base["clips"].items():
        cur = dict(meta)
        got = src.get(cid) or {}
        cur["enabled"] = bool(got.get("enabled", True))
        try:
            speed = float(got.get("speed", 1.0))
        except (TypeError, ValueError):
            speed = 1.0
        cur["speed"] = max(0.25, min(3.0, speed))
        if got.get("label"):
            cur["label"] = str(got["label"])
        if got.get("frame") is not None:
            try:
                cur["frame"] = int(got["frame"])
            except (TypeError, ValueError):
                pass
        if got.get("duration") is not None:
            try:
                cur["duration"] = float(got["duration"])
            except (TypeError, ValueError):
                pass
        cur["fit"] = _fit_from(got.get("fit"))
        # Preserve Mesh2Motion / import provenance (defaults say builtin)
        if got.get("source"):
            cur["source"] = str(got["source"])
        if "builtin" in got:
            cur["builtin"] = bool(got["builtin"])
        out_clips[cid] = cur
    # keep imported / custom clips
    for cid, got in src.items():
        if cid in out_clips:
            continue
        try:
            speed = float(got.get("speed", 1.0))
        except (TypeError, ValueError):
            speed = 1.0
        out_clips[cid] = {
            "enabled": bool(got.get("enabled", True)),
            "speed": max(0.25, min(3.0, speed)),
            "label": str(got.get("label") or cid.replace("_", " ")),
            "frame": int(got.get("frame") or 1),
            "source": str(got.get("source") or "import"),
            "builtin": False,
            "duration": got.get("duration"),
            "fit": _fit_from(got.get("fit")),
        }
    sel = payload.get("selected") or base["selected"]
    if sel not in out_clips:
        sel = base["selected"] if base["selected"] in out_clips else next(iter(out_clips))
    return {"selected": sel, "clips": out_clips}


def write(job_dir: Path, payload=None) -> dict:
    settings = settings_from(payload)
    path = job_dir / "animations.json"
    path.write_text(json.dumps(settings, indent=1), encoding="utf-8")
    return settings


def read(job_dir: Path) -> dict:
    path = job_dir / "animations.json"
    if path.is_file():
        try:
            return settings_from(json.loads(path.read_text(encoding="utf-8")))
        except Exception:
            pass
    return write(job_dir)


_FIT_LIMITS = {
    "hip": 0.25,
    "arms": 1.5,
    "legs": 1.5,
    "arm_space": 120.0,
    "arm_fwd": 120.0,
    "arm_raise": 120.0,
    "turn": 45.0,
}


def _legacy_fit(raw) -> bool:
    """Old files stored 0–100 slider scalars. Those are outside the current ranges."""
    if isinstance(raw, bool) or raw is None:
        return False
    if isinstance(raw, (int, float)):
        return True
    if not isinstance(raw, dict):
        return True
    for key, limit in _FIT_LIMITS.items():
        if key not in raw or raw[key] is None:
            continue
        try:
            value = float(raw[key])
        except (TypeError, ValueError):
            return True
        if abs(value) > limit + 1e-6:
            return True
    return False


def _fit_from(raw) -> dict:
    if _legacy_fit(raw):
        return default_fit()
    base = default_fit()
    if not isinstance(raw, dict):
        return base
    try:
        base["hip"] = max(-0.25, min(0.25, float(raw.get("hip", 0))))
    except (TypeError, ValueError):
        pass
    for k in ("arms", "legs"):
        try:
            base[k] = max(0.0, min(1.5, float(raw.get(k, 1))))
        except (TypeError, ValueError):
            pass
    # AF armSpace / armFwd: −120…120°, neutral 0. Legacy arm_raise → arm_space.
    try:
        if "arm_space" in raw:
            base["arm_space"] = max(-120.0, min(120.0, float(raw.get("arm_space", 0))))
        elif "arm_raise" in raw:
            base["arm_space"] = max(-120.0, min(120.0, float(raw.get("arm_raise", 0))))
    except (TypeError, ValueError):
        pass
    try:
        base["arm_fwd"] = max(-120.0, min(120.0, float(raw.get("arm_fwd", 0))))
    except (TypeError, ValueError):
        pass
    try:
        base["turn"] = max(-45.0, min(45.0, float(raw.get("turn", 0))))
    except (TypeError, ValueError):
        pass
    return base


def fit_is_default(fit: dict | None) -> bool:
    d = default_fit()
    f = _fit_from(fit)
    return all(abs(f[k] - d[k]) < 1e-6 for k in d)


def catalog(settings: dict | None = None, available: set[str] | list[str] | None = None) -> list[dict]:
    """UI list: builtins first, then imports. If available is set, only those clips."""
    settings = settings or defaults()
    clips = settings.get("clips") or {}
    avail = set(available) if available is not None else None
    out = []
    seen = set()
    for c in CLIPS:
        if avail is not None and c["id"] not in avail:
            continue
        meta = clips.get(c["id"]) or _clip_meta(c)
        entry = {"id": c["id"], **meta}
        prev = library_preview_url(c["id"])
        if prev:
            entry["preview"] = prev
        out.append(entry)
        seen.add(c["id"])
    for cid, meta in clips.items():
        if cid in seen:
            continue
        if avail is not None and cid not in avail:
            continue
        entry = {"id": cid, **meta}
        prev = library_preview_url(cid)
        if prev:
            entry["preview"] = prev
        out.append(entry)
    return out


def thumb_rel(clip_id: str) -> str:
    return f"rig/poses/{clip_id}_front.png"


def pose_shots(settings: dict | None = None) -> list[str]:
    """Shots for render_poses — builtins + any custom with a frame."""
    shots = []
    for c in catalog(settings):
        shots.append(f"{c['id']}:{int(c.get('frame') or 1)}")
    return shots


def safe_clip_id(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9_-]+", "_", (name or "motion").strip()).strip("_").lower()
    return (s or "motion")[:48]


def _label_from_id(cid: str) -> str:
    return cid.replace("-", " ").replace("_", " ").strip().title()


def library_dir() -> Path:
    return LIBRARY_ANIMS


def library_clip_path(clip_id: str) -> Path | None:
    """Resolve a Mesh2Motion GLB by clip id (stem)."""
    cid = safe_clip_id(clip_id)
    if not cid:
        return None
    # Prefer exact stem; also try hyphen/underscore swap
    candidates = [
        LIBRARY_ANIMS / f"{cid}.glb",
        LIBRARY_ANIMS / f"{cid.replace('_', '-')}.glb",
        LIBRARY_ANIMS / f"{cid.replace('-', '_')}.glb",
    ]
    for p in candidates:
        if p.is_file() and p.stat().st_size > 1000:
            return p
    return None


def _preview_index() -> dict[str, str]:
    """clip id → looping MP4 preview URL (Mesh2Motion animpreviews)."""
    path = LIBRARY_ROOT / "preview_index.json"
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return dict(data.get("urls") or {})
    except Exception:
        return {}


def library_preview_url(clip_id: str) -> str | None:
    urls = _preview_index()
    cid = safe_clip_id(clip_id)
    if cid in urls:
        return urls[cid]
    # Builtin Studio ids map through BUILTIN_MESH2MOTION first
    m2m = BUILTIN_MESH2MOTION.get(cid)
    if m2m and m2m in urls:
        return urls[m2m]
    return None


# Families that share a gallery card and expand into sibling poses (AF-style tree).
_FAMILY_ALIASES = {
    "ledge": "climb",
    "climbup": "climb",
    "ninjajump": "jump",
}


def clip_family(clip_id: str) -> str:
    """Family key for expandable gallery trees (climb, dance, sword…)."""
    cid = safe_clip_id(clip_id) or ""
    head = cid.split("-", 1)[0]
    return _FAMILY_ALIASES.get(head, head or cid)


def library_clips() -> list[dict]:
    """Full Mesh2Motion human catalog from disk (not yet on a character)."""
    if not LIBRARY_ANIMS.is_dir():
        return []
    previews = _preview_index()
    raw = []
    for p in sorted(LIBRARY_ANIMS.glob("*.glb")):
        if p.stat().st_size < 1000:
            continue
        cid = safe_clip_id(p.stem)
        fam = clip_family(cid)
        entry = {
            "id": cid,
            "label": _label_from_id(cid),
            "source": "mesh2motion",
            "file": p.name,
            "family": fam,
        }
        if cid in previews:
            entry["preview"] = previews[cid]
        raw.append(entry)
    # Mark siblings so the UI can expand a root card into its pose tree
    by_fam: dict[str, list[dict]] = {}
    for e in raw:
        by_fam.setdefault(e["family"], []).append(e)
    out = []
    for e in raw:
        sibs = by_fam.get(e["family"]) or [e]
        entry = dict(e)
        if len(sibs) > 1:
            entry["siblings"] = [
                {"id": s["id"], "label": s["label"], "preview": s.get("preview")}
                for s in sibs
            ]
            # Prefer a short name as the family's root tile when listing collapsed
            root = min(sibs, key=lambda s: (len(s["id"]), s["id"]))
            entry["family_root"] = root["id"]
        out.append(entry)
    return out


def library_ids() -> set[str]:
    return {c["id"] for c in library_clips()}


def builtin_library_sources() -> dict[str, Path]:
    """Studio builtin id → on-disk Mesh2Motion GLB, only where the file exists."""
    out = {}
    for cid, m2m in BUILTIN_MESH2MOTION.items():
        path = library_clip_path(m2m)
        if path is not None:
            out[cid] = path
    return out
