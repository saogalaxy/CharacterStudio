"""Is this mesh riggable?  blender -b -P mesh_check.py -- <in.glb> <out.json>"""
import bmesh
import bpy
import numpy as np

import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common
import markers as mk

glb, out = common.args()[:2]
body, V = common.load_body(glb)
checks, stats = [], {}


def check(name, ok, detail):
    checks.append({"name": name, "ok": bool(ok), "detail": detail})


zmin, zmax = V[:, 2].min(), V[:, 2].max()
H = float(zmax - zmin)
stats.update(verts=len(V), faces=len(body.data.polygons), height=round(H, 4))
check("has geometry", len(V) > 500 and H > 0, f"{len(V)} vertices, {len(body.data.polygons)} faces")

bm = bmesh.new()
bm.from_mesh(body.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=max(H, 1e-6) * 2e-4)
bm.verts.ensure_lookup_table()
seen, sizes = set(), []
for v in bm.verts:
    if v.index in seen:
        continue
    stack, n = [v], 0
    seen.add(v.index)
    while stack:
        x = stack.pop()
        n += 1
        for e in x.link_edges:
            o = e.other_vert(x)
            if o.index not in seen:
                seen.add(o.index)
                stack.append(o)
    sizes.append(n)
bm.free()
sizes.sort(reverse=True)
main = sizes[0] / max(1, sum(sizes))
stats.update(parts=len(sizes), main_part_share=round(main, 3))
check("one main body", main >= 0.9, f"largest piece holds {main:.0%} of the mesh ({len(sizes)} pieces)")

width = float(V[:, 0].max() - V[:, 0].min())
check("T-pose arms", width >= 0.7 * H, f"arm span is {width / H:.2f}x the height (needs 0.70+)")

top = V[V[:, 2] > zmin + 0.9 * H]
top_w = float(np.abs(top[:, 0]).max() / H) if len(top) else 0.0
check("head present", len(top) > 20 and top_w < 0.2,
      f"no head on top: the top tenth of the model is {2 * top_w:.2f}x the height wide (a head is under 0.40)"
      if len(top) > 20 and top_w >= 0.2 else
      f"the top tenth of the model is {2 * top_w:.2f}x the height wide" if len(top) > 20 else
      "nothing in the top tenth of the model")

try:
    P = common.surface_points(body)
    det = mk.detect(P)
    off = mk.off_body(P, det)
    check("markers found", not off, "all markers on the body" if not off else f"off the body: {', '.join(off)}")
except Exception as e:
    check("markers found", False, str(e))

imgs = [i for i in bpy.data.images if i.size[0] > 0]
stats["textures"] = len(imgs)
check("textured", len(imgs) > 0, f"{len(imgs)} texture(s)")

ok = all(c["ok"] for c in checks if c["name"] != "textured")
common.write_json(out, {"ok": ok, "checks": checks, "stats": stats})
print("MESH_CHECK", "PASS" if ok else "FAIL")
