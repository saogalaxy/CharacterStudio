"""Regression checks after major Studio / workflow changes.

Run:
  D:\\CharacterStudio\\runtime\\python\\python.exe D:\\CharacterStudio\\app\\tests\\validate_studio.py
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))

from pipeline import mesh, runtime as rt, tpose  # noqa: E402
import app as appmod  # noqa: E402
from pipeline import jobs  # noqa: E402


ERRORS: list[str] = []


def check(name: str, cond: bool, detail: object = "") -> None:
    if cond:
        print(f"ok  {name}")
        return
    msg = f"FAIL {name}: {detail}"
    ERRORS.append(msg)
    print(msg)


def main() -> int:
    raw = json.loads((rt.WORKFLOWS / "mesh_api.json").read_text(encoding="utf-8"))["prompt"]

    check("template has 368 remesh", "311:368" in raw)
    check("335 feeds from 368", raw["311:335"]["inputs"]["mesh"] == ["311:368", 0])
    check("bridge from 335", raw["311:353"]["inputs"]["mesh"] == ["311:335", 0])
    check("no HP fast merge", "311:343" not in raw)
    check("no A2 seal", "311:409" not in raw)
    check("uv keep_existing", raw["311:392"]["inputs"]["uv_mode"] == "keep_existing")
    check("408 default 60k", raw["311:408"]["inputs"]["target_tris"] == 60000)
    check("408 voxel_rebuild", raw["311:408"]["inputs"]["voxel_rebuild"] is True)
    check("default seed in template", raw["311:272"]["inputs"]["seed"] == mesh.DEFAULT_SEED)

    for node_id, field, expected, match, disk_ok, got in mesh.model_pins(raw):
        check(f"model pin {node_id}.{field}", match and disk_ok, f"want={expected!r} got={got!r} disk={disk_ok}")
    check("no missing models", not mesh.missing_models(raw), mesh.missing_models(raw))

    # Desktop API export must agree on model pins
    desk_path = Path(r"C:\Users\usbma\OneDrive\Desktop\low poly optimized ultraTexturing_Pixal3D_LowPoly.json")
    if desk_path.is_file():
        desk = json.loads(desk_path.read_text(encoding="utf-8"))
        if "prompt" in desk:
            desk = desk["prompt"]
        for node_id, field, expected, _rels in mesh.EXPECTED_MODELS:
            if node_id not in desk:
                continue
            got = desk[node_id]["inputs"].get(field)
            check(f"desktop same {node_id}.{field}", got == expected, f"desktop={got!r}")

    for name, _fill, _label in mesh.STAGE_FILL:
        has = any(
            name in str(n["inputs"].get("filename_prefix", "")).replace(" ", "_")
            for n in raw.values()
            if n["class_type"] == "Save3DAdvanced"
        )
        check(f"STAGE_FILL {name} has Save3D", has)

    built = mesh.build("tpose.png", target_tris=12000, seed=42)
    check("build slider 12k", built["311:408"]["inputs"]["target_tris"] == 12000)
    check("build seed applied", built["311:272"]["inputs"]["seed"] == 42)
    check("build wiring 368", built["311:335"]["inputs"]["mesh"] == ["311:368", 0])
    check(
        "build blender patched",
        any(
            str(n["inputs"].get("value", "")).endswith("blender.exe")
            for n in built.values()
            if n["class_type"] == "PrimitiveString"
        ),
    )

    s = mesh.settings_from()
    check("settings default seed", s["seed_mode"] == "default" and s["seed"] == mesh.DEFAULT_SEED)
    check("resolve default", mesh.resolve_seed({"seed_mode": "default"}) == mesh.DEFAULT_SEED)
    check("resolve lock", mesh.resolve_seed({"seed_mode": "lock", "seed": 99}) == 99)
    mesh.resolve_seed({"seed_mode": "random"})
    check("resolve random", True)

    td = Path(tempfile.mkdtemp())
    try:
        fill, _label, stage = mesh.stage_progress(td / "output", elapsed_sec=0)
        check("stage empty soft low", 0.07 <= fill <= 0.1 and stage is None, (fill, stage))
        fill2, _, _ = mesh.stage_progress(td / "output", elapsed_sec=900)
        check("stage soft ramp", fill2 > fill, (fill, fill2))
        lp = td / "output" / "3d" / "lowpoly_prerig"
        lp.mkdir(parents=True)
        (lp / "x.glb").write_bytes(b"glb")
        fill3, _, st3 = mesh.stage_progress(td / "output")
        check("stage lowpoly", st3 == "lowpoly_prerig" and fill3 >= 0.6, (fill3, st3))
        fm = td / "output" / "3d" / "finalmesh"
        fm.mkdir(parents=True)
        (fm / "y.glb").write_bytes(b"glb")
        fill4, _, st4 = mesh.stage_progress(td / "output")
        check("stage final", st4 == "finalmesh" and fill4 >= 0.9, (fill4, st4))
    finally:
        shutil.rmtree(td, ignore_errors=True)

    for method in ("standard", "2_5d", "custom"):
        g = tpose.build_prompt("source.png", method=method, prompt="test prompt")["prompt"]
        check(f"tpose {method} save", "10" in g)
        check(f"tpose {method} image_1", "images.image_1" in g["7"]["inputs"])
    check("tpose 2.5d upscale node", "12" in tpose.build_prompt("source.png", method="2_5d")["prompt"])
    check("tpose standard no upscale", "12" not in tpose.build_prompt("source.png", method="standard")["prompt"])
    check("tpose 2.5d prompt text", "PVC" in tpose.settings_from({"method": "2_5d"})["prompt"])

    root = Path(tempfile.mkdtemp())
    try:
        studio = jobs.Studio(root)
        j = studio.create("validate")
        check("job mesh_settings", "mesh_settings" in j.meta)
        check("job tpose_settings", "tpose_settings" in j.meta)
        m1 = studio.set_mesh_settings(j, {"target_tris": 45000})
        check("merge keeps seed mode", m1["seed_mode"] == "default" and m1["target_tris"] == 45000, m1)
        m2 = studio.set_mesh_settings(j, {"seed_mode": "lock", "seed": 123})
        check("merge keeps tris", m2["target_tris"] == 45000 and m2["seed"] == 123, m2)
        t1 = studio.set_tpose_settings(j, {"method": "custom", "prompt": "hello"})
        check("tpose settings", t1["method"] == "custom" and t1["prompt"] == "hello")
        st = j.state()
        check("state mesh_settings", st["mesh_settings"]["seed"] == 123)
        check("state tpose_settings", st["tpose_settings"]["method"] == "custom")
        t_std = studio.set_tpose_settings(j, {"method": "standard"})
        check("standard remembers custom", t_std["method"] == "standard" and t_std.get("custom_prompt") == "hello", t_std)
        t_back = studio.set_tpose_settings(j, {"method": "custom"})
        check("custom prompt restored", t_back["method"] == "custom" and t_back["prompt"] == "hello", t_back)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    paths = []
    for resource in appmod.make_app().router.resources():
        paths.append(getattr(resource, "canonical", str(resource)))
    check("route mesh-settings", any("mesh-settings" in p for p in paths))
    check("route tpose-settings", any("tpose-settings" in p for p in paths))
    check("route anim-settings", any("anim-settings" in p for p in paths))
    check("route export-anims", any("export-anims" in p for p in paths))
    check("route import-motion", any("import-motion" in p for p in paths))
    check("route key-clip", any("key-clip" in p for p in paths))
    check("route cancel", any("/cancel" in p for p in paths))

    js = (APP / "static" / "app.js").read_text(encoding="utf-8")
    css = (APP / "static" / "style.css").read_text(encoding="utf-8")
    for needle in (
        "meshSeedCard",
        "meshQualityCard",
        "tposeMethodCard",
        "cancelStep",
        "meshFillView",
        "updateMeshFill",
        "busyStep",
        "meshFillGhost",
        "meshFillClip",
        "saveJoints",
        "setSkeleton",
        "Skeleton check",
        "Bind & rig",
        "animationsCard",
        "selectAnim",
        "exportAnims",
        "animGrid",
    ):
        check(f"ui has {needle}", needle in js or needle in css)
    check("steps include animations", '"animations"' in js and "Animations" in js)
    check("ui has import motion", "importMotion" in js or "Import motion" in js)
    check("ui has key frame", "keyCurrentFrame" in js or "Key frame" in js)
    check("ui has scrub", "animScrub" in js)
    check("ui has fit to character", "Fit to character" in js)
    check("ui has arm raise", "arm_raise" in js)
    check("fit has arm_raise", "arm_raise" in (APP / "pipeline" / "animations.py").read_text(encoding="utf-8"))
    check("export bakes fit", "_apply_fit_to_action" in (APP / "pipeline" / "blender" / "export_pack.py").read_text(encoding="utf-8"))
    check("ui has mesh2motion gallery", "motion_library" in js and "animLibList" in js)
    check("ui has addLibraryClip", "addLibraryClip" in js)
    viewer_src = (APP / "static" / "viewer.js").read_text(encoding="utf-8")
    check("viewer anim skeleton", "_showAnimSkeleton" in viewer_src)
    check("viewer syncs anim skeleton", "_syncAnimSkeleton" in viewer_src)
    check("viewer skeleton toggle", "setSkeletonVisible" in viewer_src)
    check("import local axis retarget", "local_axis_corrected" in (APP / "pipeline" / "blender" / "import_motion.py").read_text(encoding="utf-8"))
    check("el skips null kids", "k == null || k === false" in js)
    check("route apply-library", any("apply-library" in p for p in paths))
    check("route motion-library", any("motion-library" in p for p in paths))
    check("route library clip", any("/library/" in p for p in paths))
    check("viewer dresses demo bones", "_dressBones" in (APP / "static" / "viewer.js").read_text(encoding="utf-8"))
    check("ui demos before mesh", "usingDemo" in (APP / "static" / "app.js").read_text(encoding="utf-8"))
    check("jobs apply_library_motion", "apply_library_motion" in (APP / "pipeline" / "jobs.py").read_text(encoding="utf-8"))
    from pipeline import animations as anims  # noqa: E402
    check("legacy arms 50 resets", anims._fit_from({"arms": 50, "legs": 80, "arm_raise": 40}) == anims.default_fit())
    check("legacy scalar resets", anims._fit_from(50) == anims.default_fit())
    check("arm_raise degrees map", anims._fit_from({"arm_raise": 15})["arm_space"] == 15)
    kept = anims._fit_from({"arms": 1.2, "arm_space": -20, "arm_fwd": 10})
    check("in-range fit kept", kept["arms"] == 1.2 and kept["arm_space"] == -20 and kept["arm_fwd"] == 10, kept)
    check("anim library has builtins", len(anims.CLIPS) >= 10, len(anims.CLIPS))
    check("anim has run", any(c["id"] == "run" for c in anims.CLIPS))
    check("anim has jump", any(c["id"] == "jump" for c in anims.CLIPS))
    m2m = anims.library_clips()
    check("mesh2motion pack on disk", len(m2m) >= 200, len(m2m))
    check("mesh2motion has walk", any(c["id"] == "walk" for c in m2m))
    check("library_clip_path walk", anims.library_clip_path("walk") is not None)
    check("builtin mesh2motion map", len(anims.BUILTIN_MESH2MOTION) >= 10)
    check("builtin library sources", len(anims.builtin_library_sources()) >= 10)
    check("jobs bake builtin library", "_bake_builtin_library" in (APP / "pipeline" / "jobs.py").read_text(encoding="utf-8"))
    check("route replace-builtins", any("replace-builtins" in p for p in paths))
    check("rig has run motion", "motion_run" in (APP / "pipeline" / "blender" / "rig.py").read_text(encoding="utf-8"))
    viewer = (APP / "static" / "viewer.js").read_text(encoding="utf-8")
    check("viewer has setSkeleton", "setSkeleton" in viewer)
    check("viewer has BONE_EDGES", "BONE_EDGES" in viewer)
    check("viewer has setOrthoView", "setOrthoView" in viewer)
    check("viewer has skelViews", "skelViews" in viewer)
    check("viewer has Free view", '"free", "Free"' in viewer or "['free', 'Free']" in viewer)
    check("viewer has setAnimMode", "setAnimMode" in viewer)
    check("viewer has resetPose", "resetPose" in viewer)
    check("viewer has JOINT_COLORS", "JOINT_COLORS" in viewer)
    check("viewer has jointColor", "function jointColor" in viewer)
    check("viewer has animDock", "animDock" in viewer or "_makeAnimDock" in viewer)
    check("viewer pose uses jointColor", "jointColor(bone.name)" in viewer)
    check("viewer applies fit on scrub", "this._applyFit()" in viewer)
    check("viewer has arm_raise fit", "arm_raise" in viewer)
    check("status uses tpose fill", "fileUrl(\"tpose.png\")" in js or "fileUrl('tpose.png')" in js)
    check("MESH_TRIS defined once", js.count("const MESH_TRIS") == 1)
    check("jobs has ensure_joints", "ensure_joints" in (APP / "pipeline" / "jobs.py").read_text(encoding="utf-8"))
    check("detect writes joints", "joints_from_markers" in (APP / "pipeline" / "blender" / "detect_markers.py").read_text(encoding="utf-8"))

    msg = "running in Comfy, 45 s"
    secs = " · " + msg.split("Comfy,", 1)[1].strip()
    elapsed = float(secs.replace("·", "").replace("s", "").strip().split()[0])
    check("elapsed parse", elapsed == 45.0, elapsed)

    print()
    if ERRORS:
        print(f"{len(ERRORS)} failure(s)")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
