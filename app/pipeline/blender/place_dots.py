"""Measure a mesh and write markers.json plus a surface sample. Run by Blender."""
import json
import os
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
mesh_path, out_json, out_npy = argv
APP = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, APP)

import addon_utils
addon_utils.enable("io_scene_gltf2")

from pipeline.bodymath import detect, joints_from_markers, listed_off

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=mesh_path)
body = next(o for o in bpy.data.objects if o.type == "MESH")
mw = body.matrix_world
cloud = np.array([(mw @ v.co)[:] for v in body.data.vertices], dtype=np.float64)

det = detect(cloud)
det["joints"] = joints_from_markers(cloud, det)
det["auto"] = {k: list(v) for k, v in det["markers"].items()}
det["joints_auto"] = {k: list(v) for k, v in det["joints"].items()}
det["envelopes"] = {}
det["tags"] = {}
det["fingers"] = "five"
sample = cloud[::max(1, len(cloud) // 60000)]
bad_m, bad_j = listed_off(sample, det)
det["off_body"] = bad_m
det["joints_off_body"] = bad_j
np.save(out_npy, sample.astype(np.float32))
with open(out_json, "w", encoding="utf-8") as fh:
    json.dump(det, fh, indent=1)
print("DOTS", len(det["joints"]), "off", ",".join(bad_m + bad_j) or "none")
