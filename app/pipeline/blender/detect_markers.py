"""Auto-place markers + derived skeleton joints.

blender -b -P detect_markers.py -- <in.glb> <markers.json>
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common
import markers as mk

import numpy as np

glb, out = common.args()[:2]
body, _ = common.load_body(glb)
P = common.surface_points(body)
det = mk.detect(P)
det["auto"] = {k: list(v) for k, v in det["markers"].items()}
det["off_body"] = mk.off_body(P, det)
det["joints"] = mk.joints_from_markers(P, det)
det["joints_auto"] = {k: list(v) for k, v in det["joints"].items()}
common.write_json(out, det)
# surface samples so Studio can recompute / gate joints without Blender
outdir = os.path.dirname(out)
np.save(os.path.join(outdir, "markers_xz.npy"), P[:, [0, 2]].astype(np.float32))
np.save(os.path.join(outdir, "markers_pts.npy"), P.astype(np.float32))
print("MARKERS", "off_body:", det["off_body"], "joints:", len(det["joints"]))
