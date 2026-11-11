"""Shared Blender helpers. One import path for check, markers and rig keeps coordinates identical."""
import json
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)


def args():
    return sys.argv[sys.argv.index("--") + 1:]


def load_body(glb):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("the file has no mesh")
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    body = meshes[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in list(bpy.context.scene.objects):
        if o is not body:
            bpy.data.objects.remove(o, do_unlink=True)
    body.name = "Body"
    V = np.array([v.co[:] for v in body.data.vertices])
    return body, V


def surface_points(body, n=200000, seed=0):
    """Area-uniform samples of the surface plus the vertices.

    Low-poly meshes have few, large triangles on the torso, so vertex slices miss most of
    the body's width; landmark detection needs the surface itself.
    """
    me = body.data
    me.calc_loop_triangles()
    co = np.array([v.co[:] for v in me.vertices])
    tri = np.array([t.vertices[:] for t in me.loop_triangles])
    a, b, c = co[tri[:, 0]], co[tri[:, 1]], co[tri[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    rng = np.random.default_rng(seed)
    pick = rng.choice(len(tri), size=n, p=area / area.sum())
    u, v = rng.random(n), rng.random(n)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    pts = a[pick] + u[:, None] * (b[pick] - a[pick]) + v[:, None] * (c[pick] - a[pick])
    return np.vstack([co, pts])


def write_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1)


def action_fcurves(action):
    """Yield fcurves from a Blender action (legacy or 4.4+/5.x layered)."""
    if action is None:
        return
    if hasattr(action, "fcurves"):
        try:
            for fc in action.fcurves:
                yield fc
            return
        except Exception:
            pass
    # Layered actions (Blender 4.4+ / 5.x): fcurves live on channelbags
    for layer in getattr(action, "layers", []) or []:
        for strip in getattr(layer, "strips", []) or []:
            for bag in getattr(strip, "channelbags", []) or []:
                for fc in getattr(bag, "fcurves", []) or []:
                    yield fc


def action_has_keys(action):
    return any(True for _ in action_fcurves(action))


def action_new_fcurve(action, data_path, index=0, datablock=None):
    """Create an fcurve on legacy or layered actions."""
    if hasattr(action, "fcurves") and hasattr(action.fcurves, "new"):
        try:
            return action.fcurves.new(data_path=data_path, index=index)
        except Exception:
            pass
    ensure = getattr(action, "fcurve_ensure_for_datablock", None)
    if ensure and datablock is not None:
        return ensure(datablock=datablock, data_path=data_path, index=index)
    # Fall back: ensure a channelbag exists via keyframe on datablock, then new there
    for layer in getattr(action, "layers", []) or []:
        for strip in getattr(layer, "strips", []) or []:
            bags = getattr(strip, "channelbags", None)
            if bags is None:
                continue
            if len(bags) == 0 and hasattr(strip, "channelbag"):
                # can't easily create without a slot; caller should keyframe_insert first
                continue
            for bag in bags:
                if hasattr(bag.fcurves, "new"):
                    return bag.fcurves.new(data_path=data_path, index=index)
    raise RuntimeError("could not create fcurve on this Blender action")
