"""LowPoly UltraTex mesh graph (workflows/mesh_api.json) prepared for one job.

Template is the Desktop AF-clean optimize API export:
  ``low poly optimized ultraTexturing_Pixal3D_LowPoly.json``
  - Trellis2RemeshWithQuad (368) between CuMesh fills
  - Quad 1536 → WTiVo → 6M LODTailor
  - A · LODTailor ~60k + voxel_rebuild (slider overrides tris)
  - no HP Fast Merge / no A2 seal
  - UltraTex uv_mode = keep_existing
  - lighter Trellis steps (12)
"""
import copy
import json
import random

from . import runtime as rt

TEMPLATE = rt.WORKFLOWS / "mesh_api.json"
SAVE_DIRS = ("finalmesh", "lowpoly_prerig", "watertight", "base mesh", "lowpoly_ultratex")
RIG_PREFERENCE = ("finalmesh", "lowpoly_ultratex", "lowpoly_prerig")

DEFAULT_TARGET_TRIS = 60000
SIMPLE_TARGET_TRIS = 12000
MIN_TARGET_TRIS = 8000
MAX_TARGET_TRIS = 80000

PRESETS = {
    "optimized": DEFAULT_TARGET_TRIS,
    "simple": SIMPLE_TARGET_TRIS,
}

# Sparse shape seed from the Desktop green-girl API export.
DEFAULT_SEED = 156863899
SEED_MODES = ("default", "random", "lock")
MIN_SEED = 0
MAX_SEED = 2**31 - 1

# Fill level for the mesh-step silhouette as each stage GLB appears under output/3d/.
# Current Desktop optimize API export only saves lowpoly_prerig + finalmesh.
STAGE_FILL = (
    ("lowpoly_prerig", 0.62, "cutting the low poly"),
    ("finalmesh", 0.92, "assembling the mesh"),
)


def clamp_tris(n):
    try:
        n = int(n)
    except (TypeError, ValueError):
        n = DEFAULT_TARGET_TRIS
    return max(MIN_TARGET_TRIS, min(MAX_TARGET_TRIS, n))


def clamp_seed(n):
    try:
        n = int(n)
    except (TypeError, ValueError):
        n = DEFAULT_SEED
    return max(MIN_SEED, min(MAX_SEED, n))


def settings_from(payload=None):
    """Normalize UI/API mesh settings. Default = optimized 60k + Desktop seed."""
    payload = payload or {}
    preset = str(payload.get("preset") or "").lower().strip()
    if preset in PRESETS and "target_tris" not in payload:
        tris = PRESETS[preset]
    else:
        tris = clamp_tris(payload.get("target_tris", DEFAULT_TARGET_TRIS))
    if tris == DEFAULT_TARGET_TRIS:
        preset = "optimized"
    elif tris == SIMPLE_TARGET_TRIS:
        preset = "simple"
    else:
        preset = "custom"

    seed_mode = str(payload.get("seed_mode") or "default").lower().strip()
    if seed_mode not in SEED_MODES:
        seed_mode = "default"
    if seed_mode == "default":
        seed = DEFAULT_SEED
    else:
        seed = clamp_seed(payload.get("seed", DEFAULT_SEED))
    return {
        "preset": preset,
        "target_tris": tris,
        "seed_mode": seed_mode,
        "seed": seed,
    }


def resolve_seed(settings):
    """Seed used for this mesh run. Random picks a new value each call."""
    settings = settings_from(settings)
    if settings["seed_mode"] == "random":
        return random.randint(MIN_SEED, MAX_SEED)
    if settings["seed_mode"] == "lock":
        return settings["seed"]
    return DEFAULT_SEED


def stage_progress(output_dir, elapsed_sec=None):
    """(fill 0..1, label, stage_name) from stage GLBs, with a soft time ramp before them."""
    best = (0.08, "building the shape", None)
    root = output_dir / "3d"
    if root.is_dir():
        for name, fill, label in STAGE_FILL:
            if any((root / name).glob("*.glb")):
                best = (fill, label, name)
    # Until the first saved stage lands, ease the fill up so the status scene isn't stuck.
    if best[2] is None and elapsed_sec is not None:
        try:
            t = max(0.0, float(elapsed_sec))
        except (TypeError, ValueError):
            t = 0.0
        soft = min(0.48, 0.08 + t / 1800.0)  # ~0.48 after 30 min of shape work
        if soft > best[0]:
            best = (soft, "building the shape", None)
    return best


def _apply_lowpoly(prompt, target_tris):
    """A · LODTailor is where face count is set; seal via voxel_rebuild."""
    node = prompt.get("311:408")
    if not node:
        raise RuntimeError("mesh template missing A · LODTailor (311:408)")
    inp = node["inputs"]
    inp["target_tris"] = int(target_tris)
    inp["voxel_rebuild"] = True
    inp["seal_keep_trying"] = True
    inp["passes"] = 3
    node["_meta"]["title"] = f"A · LODTailor low-poly ({target_tris // 1000}k)"


def _assert_optimize_wiring(prompt):
    """Sanity-check the Desktop optimize path is intact."""
    if prompt.get("311:335", {}).get("inputs", {}).get("mesh") != ["311:368", 0]:
        raise RuntimeError("mesh template: CuMesh 335 must take Trellis2RemeshWithQuad 368")
    if prompt.get("311:353", {}).get("inputs", {}).get("mesh") != ["311:335", 0]:
        raise RuntimeError("mesh template: bridge must take CuMesh 335")
    if prompt.get("311:392", {}).get("inputs", {}).get("uv_mode") != "keep_existing":
        raise RuntimeError("mesh template: UltraTex uv_mode must be keep_existing")
    if "311:343" in prompt or "311:409" in prompt:
        raise RuntimeError("mesh template: HP Fast Merge / A2 seal must stay out")


# Desktop optimize API model pins (must match Comfy loaders in mesh_api.json).
EXPECTED_MODELS = (
    ("319", "modelname", "TencentARC/Pixal3D-T", ("models/TencentARC/Pixal3D-T",)),
    ("311:373", "unet_name", "flux-2-klein-base-9b-Q4_0.gguf", ("models/diffusion_models/flux-2-klein-base-9b-Q4_0.gguf",)),
    ("311:374", "vae_name", "flux2-vae.safetensors", ("models/vae/flux2-vae.safetensors",)),
    ("311:375", "clip_name", "Qwen3-8B-Q4_K_M.gguf", ("models/text_encoders/Qwen3-8B-Q4_K_M.gguf",)),
    ("311:377", "lora_name", "ultratex_flux2.safetensors", ("models/loras/ultratex_flux2.safetensors",)),
    ("311:377", "decoder_name", "ultratex_flux2_decoder.pt", ("models/ultratex/ultratex_flux2_decoder.pt",)),
    ("311:382", "lora_name", "ultratex_flux2_mr.safetensors", ("models/loras/ultratex_flux2_mr.safetensors",)),
    ("311:382", "decoder_name", "ultratex_flux2_decoder.pt", ("models/ultratex/ultratex_flux2_decoder.pt",)),
    ("311:386", "bg_removal_name", "birefnet.safetensors", ("models/background_removal/birefnet.safetensors",)),
    ("303", "rem_mode", "RMBG-1.4", ("models/rembg/RMBG-1.4.pth",)),
)


def model_pins(prompt=None):
    """Return [(node_id, field, expected_value, ok_on_disk)]."""
    prompt = prompt or json.loads(TEMPLATE.read_text(encoding="utf-8"))["prompt"]
    out = []
    for node_id, field, expected, rels in EXPECTED_MODELS:
        node = prompt.get(node_id) or {}
        got = node.get("inputs", {}).get(field)
        disk_ok = any((rt.COMFY / rel).exists() for rel in rels)
        if field == "modelname" and not disk_ok and rt.HF_HOME:
            # HF cache layout models--org--name
            slug = "models--" + expected.replace("/", "--")
            disk_ok = (rt.HF_HOME / "hub" / slug).exists()
        out.append((node_id, field, expected, got == expected, disk_ok, got))
    return out


def missing_models(prompt=None):
    """Human-readable missing/mismatched model pins."""
    bad = []
    for node_id, field, expected, match, disk_ok, got in model_pins(prompt):
        if not match:
            bad.append(f"{node_id}.{field} want {expected!r} got {got!r}")
        elif not disk_ok:
            bad.append(f"{node_id}.{field} {expected!r} not found under Comfy models")
    return bad


def build(image_name, target_tris=DEFAULT_TARGET_TRIS, seed=None):
    target_tris = clamp_tris(target_tris)
    if seed is None:
        seed = DEFAULT_SEED
    else:
        seed = clamp_seed(seed)
    prompt = copy.deepcopy(json.loads(TEMPLATE.read_text(encoding="utf-8"))["prompt"])
    _assert_optimize_wiring(prompt)
    _apply_lowpoly(prompt, target_tris)
    sparse = prompt.get("311:272")
    if sparse and "seed" in sparse.get("inputs", {}):
        sparse["inputs"]["seed"] = int(seed)
    for node in prompt.values():
        ct, inp = node["class_type"], node["inputs"]
        if ct == "Trellis2LoadImageWithTransparency":
            inp["image"] = image_name
        elif ct == "Save3DAdvanced":
            fp = str(inp.get("filename_prefix", "")).lower()
            for d in SAVE_DIRS:
                if d in fp:
                    inp["filename_prefix"] = f"3d/{d.replace(' ', '_')}/{d.replace(' ', '_')}"
                    break
        elif ct == "PrimitiveString" and str(inp.get("value")) in ("blender", "confirm_full"):
            if str(inp.get("value")) == "blender" or node.get("_meta", {}).get("title", "").lower().startswith("blender"):
                inp["value"] = str(rt.BLENDER)
    # Blender path node is usually a PrimitiveString titled for Blender, value may already be 'blender'
    for node in prompt.values():
        if node["class_type"] != "PrimitiveString":
            continue
        title = str(node.get("_meta", {}).get("title", "")).lower()
        if "blender" in title:
            node["inputs"]["value"] = str(rt.BLENDER)
    mode = prompt.get("219", {}).get("inputs", {}).get("value")
    if mode != "confirm_full":
        raise RuntimeError(f"mesh template mode is {mode!r}, expected 'confirm_full'")
    return prompt


def pick_for_rig(output_dir):
    """Newest GLB from the most finished stage."""
    for d in RIG_PREFERENCE:
        found = sorted((output_dir / "3d" / d).glob("*.glb"), key=lambda p: p.stat().st_mtime)
        if found:
            return found[-1], d
    return None, None
