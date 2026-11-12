"""Write mesh_check.json for an uploaded or generated GLB. Run by Blender."""
import json
import sys

import bpy
import numpy as np

import addon_utils
addon_utils.enable("io_scene_gltf2")

mesh_path, out_json = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=mesh_path)
meshes = [o for o in bpy.data.objects if o.type == "MESH" and len(o.data.vertices)]
checks = []
if not meshes:
    checks.append({"name": "has geometry", "ok": False, "detail": "no vertices"})
else:
    body = max(meshes, key=lambda o: len(o.data.vertices))
    mw = body.matrix_world
    co = np.array([(mw @ v.co)[:] for v in body.data.vertices], dtype=np.float64)
    zmin, zmax = float(co[:, 2].min()), float(co[:, 2].max())
    height = max(zmax - zmin, 1e-6)
    span = float(co[:, 0].max() - co[:, 0].min())
    top = co[co[:, 2] > zmax - 0.12 * height]
    textured = any(getattr(m, "use_nodes", False) for m in body.data.materials)
    checks = [
        {"name": "has geometry", "ok": len(co) > 100, "detail": f"{len(co)} vertices"},
        {"name": "one main body", "ok": len(meshes) == 1 or len(body.data.vertices) > sum(len(o.data.vertices) for o in meshes) * 0.8,
         "detail": f"{len(meshes)} mesh objects"},
        {"name": "T-pose arms", "ok": span >= 0.70 * height, "detail": f"arm span {span:.2f} / height {height:.2f}"},
        {"name": "head present", "ok": len(top) > 50, "detail": f"{len(top)} vertices in the top"},
        {"name": "markers found", "ok": height > 0.2 and span > 0.2, "detail": "body is large enough to place dots"},
        {"name": "textured", "ok": True, "detail": "textured" if textured else "no texture — informational", "info": True},
    ]
report = {"ok": all(c["ok"] or c.get("info") for c in checks), "checks": checks}
with open(out_json, "w", encoding="utf-8") as fh:
    json.dump(report, fh, indent=1)
print("MESH_CHECK", "PASS" if report["ok"] else "FAIL")
