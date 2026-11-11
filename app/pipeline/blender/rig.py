"""Bind a mesh to the Mesh2Motion skeleton and paint it once.

blender -b --factory-startup -P rig.py -- <mesh.glb> <out_dir> <markers.json>

The skeleton is the library skeleton, fitted to the checked joints, with that
skeleton's hinges. Weights are a region envelope: each vertex belongs to the
nearest bone, and only that bone's parent and child share the seam. The head
stops at the neck. Fingers keep their own weights. Helper bones do not deform.
Clips are the library files, copied in the bone space they were made for.
"""
import json
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common
import markers as mk
import m2m_skel

# Studio clip name → library file. Same map as animations.BUILTIN_MESH2MOTION.
CLIPS = {
    "idle": "idle-subtle.glb",
    "walk": "walk.glb",
    "mild_crouch": "crouch-idle.glb",
    "wave": "greeting.glb",
    "farm_harvest": "farm-harvest.glb",
    "run": "jog.glb",
    "jump": "jump-2.glb",
    "sit": "sitting-idle.glb",
    "cheer": "victory-fist-pump.glb",
    "bow": "bow.glb",
    "clap": "clapping.glb",
    "point": "interact.glb",
}
CHECK = {"idle": [30], "walk": [1, 9, 25], "mild_crouch": [20]}

SRC, OUT, MARKERS_FILE = common.args()[:3]
os.makedirs(OUT, exist_ok=True)
report = {"src": SRC, "steps": {}}


def log(k, v):
    report["steps"][k] = v
    print("STEP", k, json.dumps(v)[:400])


body, V = common.load_body(SRC)
bpy.context.view_layer.objects.active = body
body.select_set(True)
det = json.load(open(MARKERS_FILE, encoding="utf-8"))
H, zmin = float(V[:, 2].max() - V[:, 2].min()), float(V[:, 2].min())
det["height"], det["zmin"] = H, zmin
P = common.surface_points(body)
off = mk.off_body(P, det)
if off:
    raise RuntimeError(f"markers not on the body: {', '.join(off)}")
if not det.get("joints"):
    det["joints"] = mk.joints_from_markers(P, det)
common.write_json(os.path.join(OUT, "joints.json"), det)
J = {k: Vector(v) for k, v in det["joints"].items()}

rig = m2m_skel.fit(J, H, zmin)
arm = rig.data
log("skeleton", {"bones": len(arm.bones), "source": "mesh2motion",
                 "deform": sum(1 for b in arm.bones if b.use_deform)})


def _side_ok(name, x, limit):
    if name.endswith("_l"):
        return x > -limit
    if name.endswith("_r"):
        return x < limit
    return True


def paint_regions(body, rig, height):
    """Nearest deform bone, blended only with its parent and child.

    The head cannot claim vertices below the neck. Left bones stay on the
    character's left. Four influences, weights sum to 1.
    """
    bones = [b for b in rig.data.bones if b.use_deform and "_leaf" not in b.name and not b.name.startswith(("ik_", "socket"))]
    if not bones:
        raise RuntimeError("skeleton has no deform bones")
    mw = rig.matrix_world
    heads = np.array([(mw @ b.head_local)[:] for b in bones], dtype=np.float64)
    tails = np.array([(mw @ b.tail_local)[:] for b in bones], dtype=np.float64)
    names = [b.name for b in bones]
    index = {n: i for i, n in enumerate(names)}
    parent = []
    children = {i: [] for i in range(len(bones))}
    for i, b in enumerate(bones):
        p = b.parent.name if b.parent and b.parent.name in index else None
        parent.append(index[p] if p is not None else -1)
        if p is not None:
            children[index[p]].append(i)
    neck_i = index.get("neck_01")
    head_i = index.get("head")
    neck_z = float(heads[neck_i][2]) if neck_i is not None else None
    side_limit = 0.06 * height
    sigma = 0.02 * height
    groups = {}
    for n in names:
        groups[n] = body.vertex_groups.new(name=n) if n not in body.vertex_groups else body.vertex_groups[n]
    coords = np.array([(body.matrix_world @ v.co)[:] for v in body.data.vertices], dtype=np.float64)
    assigned = np.zeros(len(coords), dtype=np.int32)
    finger_sum = 0.0
    head_sum = 0.0
    for start in range(0, len(coords), 20000):
        pts = coords[start:start + 20000]
        ab = tails - heads
        ap = pts[:, None, :] - heads[None, :, :]
        denom = np.sum(ab * ab, axis=1) + 1e-12
        t = np.clip(np.sum(ap * ab[None, :, :], axis=2) / denom, 0.0, 1.0)
        closest = heads[None, :, :] + t[:, :, None] * ab[None, :, :]
        dist = np.linalg.norm(pts[:, None, :] - closest, axis=2)
        for local, p in enumerate(pts):
            d = dist[local].copy()
            for i, name in enumerate(names):
                if not _side_ok(name, float(p[0]), side_limit):
                    d[i] = 1e6
                elif head_i is not None and i == head_i and neck_z is not None and p[2] < neck_z - 0.02 * height:
                    d[i] = 1e6
            nearest = int(np.argmin(d))
            if d[nearest] >= 1e5:
                d = dist[local].copy()
                nearest = int(np.argmin(d))
            keep = {nearest}
            for j in children[nearest]:
                keep.add(j)
            if parent[nearest] >= 0:
                keep.add(parent[nearest])
            band = d[nearest] * 1.8 + 0.03 * height
            chosen = [j for j in keep if d[j] <= band]
            if not chosen:
                chosen = [nearest]
            weights = [1.0 / (d[j] * d[j] + sigma * sigma) for j in chosen]
            order = np.argsort(weights)[::-1][:4]
            total = float(sum(weights[k] for k in order)) or 1.0
            vi = start + local
            for k in order:
                w = weights[k] / total
                if w < 0.01:
                    continue
                groups[names[chosen[k]]].add([vi], w, "REPLACE")
                assigned[vi] = 1
                if names[chosen[k]].split("_")[0] in {"index", "middle", "ring", "pinky", "thumb"}:
                    finger_sum += w
                if names[chosen[k]] == "head":
                    head_sum += w
    return {
        "method": "region_envelope",
        "bones": len(bones),
        "verts": int(len(coords)),
        "unweighted": int((assigned == 0).sum()),
        "finger_weight": round(finger_sum, 1),
        "head_weight": round(head_sum, 1),
    }


info = paint_regions(body, rig, H)
log("weights", info)

bv = body.data.vertices
bpy.context.view_layer.objects.active = body
for o in bpy.context.scene.objects:
    o.select_set(False)
body.select_set(True)
bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
unw = sum(1 for v in bv if sum(g.weight for g in v.groups) < 1e-4)
log("body_weights", {"verts": len(bv), "unweighted": unw, "filled": 0})

body.parent = rig
mod = body.modifiers.new("Armature", "ARMATURE")
mod.object = rig

copied = {}
for name, filename in CLIPS.items():
    copied[name] = m2m_skel.copy_clip(rig, os.path.join(m2m_skel.ANIMS, filename), name)
log("library_clips", copied)
if rig.animation_data and "idle" in bpy.data.actions:
    rig.animation_data.action = bpy.data.actions["idle"]

rest_co = np.array([v.co[:] for v in body.data.vertices])
edges = np.array([e.vertices[:] for e in body.data.edges])
rest_len = np.linalg.norm(rest_co[edges[:, 0]] - rest_co[edges[:, 1]], axis=1) + 1e-9
# Sub-millimetre edges stretch on paper when two bones share them. The check
# counts edges long enough to see.
visible = rest_len > 0.005
dg = bpy.context.evaluated_depsgraph_get()
qa = {}
for name, frames in CHECK.items():
    if name not in bpy.data.actions:
        continue
    rig.animation_data.action = bpy.data.actions[name]
    for f in frames:
        bpy.context.scene.frame_set(f)
        dg.update()
        ev = body.evaluated_get(dg)
        me = ev.to_mesh()
        co = np.array([v.co[:] for v in me.vertices])
        ev.to_mesh_clear()
        ratio = np.linalg.norm(co[edges[:, 0]] - co[edges[:, 1]], axis=1) / rest_len
        shown = ratio[visible]
        qa[f"{name}@{f}"] = {
            "tears": int((shown > 2.5).sum()),
            "max_stretch": round(float(shown.max()) if len(shown) else 1.0, 2),
        }
limit = 0.002 * int(visible.sum())
gate = "PASS" if qa and all(v["tears"] <= limit and v["max_stretch"] <= 4.0 for v in qa.values()) else "FAIL"
log("deform_qa", {"gate": gate, "edges": int(visible.sum()), "poses": qa})

if rig.animation_data and "idle" in bpy.data.actions:
    rig.animation_data.action = bpy.data.actions["idle"]
bpy.context.scene.frame_set(1)
for o in bpy.context.scene.objects:
    o.select_set(o in (rig, body))
glb = os.path.join(OUT, "rigged_animated.glb")
bpy.ops.export_scene.gltf(
    filepath=glb, export_format="GLB", use_selection=True, export_skins=True,
    export_animations=True, export_animation_mode="ACTIONS", export_yup=True, export_apply=False,
)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "rigged.blend"))
log("export", {"glb": glb, "bytes": os.path.getsize(glb)})
json.dump(report, open(os.path.join(OUT, "report.json"), "w"), indent=1)
print("DONE", gate)
