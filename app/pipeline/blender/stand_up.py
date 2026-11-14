"""Straighten a leaning T-pose GLB so the torso runs up +Z.

Pixel3D often exports a forward lean. Markers and bodymath assume Z-up,
character faces -Y, character-left is +X. This script only corrects lean
(pitch/roll); it keeps facing when possible, then re-grounds the feet.

Usage (Blender): stand_up.py <in.glb> <out.glb>
"""
import math
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

import addon_utils
addon_utils.enable("io_scene_gltf2")

in_path, out_path = sys.argv[sys.argv.index("--") + 1:]


def _main_body():
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and len(o.data.vertices)]
    if not meshes:
        raise RuntimeError("no mesh geometry")
    return max(meshes, key=lambda o: len(o.data.vertices))


def _world_coords(obj):
    mw = obj.matrix_world
    return np.array([(mw @ v.co)[:] for v in obj.data.vertices], dtype=np.float64)


def _torso_axis(co):
    """Principal axis of the central column — the lean direction of the body.

    Anime chests / big hair bias a tall band toward upright even when the
    spine still leans. Use a narrow mid-torso slab so PCA tracks the trunk.
    """
    xmin, xmax = float(co[:, 0].min()), float(co[:, 0].max())
    zmin, zmax = float(co[:, 2].min()), float(co[:, 2].max())
    height = max(zmax - zmin, 1e-6)
    width = max(xmax - xmin, 1e-6)
    cx = 0.5 * (xmin + xmax)
    # Narrow central band so arms / breast tips do not dominate PCA.
    half = max(0.08 * width, 0.035 * height)
    band = co[np.abs(co[:, 0] - cx) < half]
    # Mid-trunk only: skip hips/skirt and chest/shoulder shelf.
    lo = zmin + 0.30 * height
    hi = zmin + 0.65 * height
    torso = band[(band[:, 2] >= lo) & (band[:, 2] <= hi)]
    if len(torso) < 80:
        # Fallback: slightly wider height, still skip crown/feet.
        lo2 = zmin + 0.22 * height
        hi2 = zmin + 0.72 * height
        torso = band[(band[:, 2] >= lo2) & (band[:, 2] <= hi2)]
    if len(torso) < 40:
        torso = band
    if len(torso) < 40:
        torso = co
    centered = torso - torso.mean(axis=0)
    cov = centered.T @ centered / max(len(centered) - 1, 1)
    evals, evecs = np.linalg.eigh(cov)
    axis = evecs[:, int(np.argmax(evals))]
    # Point the axis toward the head (higher Z end of the cloud along this axis).
    proj = centered @ axis
    top = torso[proj >= np.percentile(proj, 85)].mean(axis=0)
    bot = torso[proj <= np.percentile(proj, 15)].mean(axis=0)
    if np.dot(top - bot, axis) < 0:
        axis = -axis
    return axis / (np.linalg.norm(axis) + 1e-12)


def _rotation_a_to_b(a, b):
    """Minimal rotation matrix sending unit vector a → b."""
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    a = a / (np.linalg.norm(a) + 1e-12)
    b = b / (np.linalg.norm(b) + 1e-12)
    c = float(np.clip(np.dot(a, b), -1.0, 1.0))
    if c > 0.999999:
        return np.eye(3)
    if c < -0.999999:
        # 180° — pick any orthogonal axis.
        helper = np.array([1.0, 0.0, 0.0]) if abs(a[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
        axis = np.cross(a, helper)
        axis = axis / (np.linalg.norm(axis) + 1e-12)
        # Rodrigues with angle π
        K = np.array([
            [0, -axis[2], axis[1]],
            [axis[2], 0, -axis[0]],
            [-axis[1], axis[0], 0],
        ])
        return np.eye(3) + 2.0 * (K @ K)
    v = np.cross(a, b)
    s = np.linalg.norm(v)
    K = np.array([
        [0, -v[2], v[1]],
        [v[2], 0, -v[0]],
        [-v[1], v[0], 0],
    ])
    return np.eye(3) + K + (K @ K) * ((1.0 - c) / (s * s + 1e-12))


def _as_matrix4(R3):
    M = Matrix.Identity(4)
    for i in range(3):
        for j in range(3):
            M[i][j] = float(R3[i, j])
    return M


def _apply_rot(obj, matrix):
    obj.matrix_world = matrix @ obj.matrix_world
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def _fix_arm_axis(obj):
    """After upright, put the wide T-pose arm span on X (character left/right)."""
    co = _world_coords(obj)
    span = co.max(axis=0) - co.min(axis=0)
    # If depth (Y) is wider than width (X), yaw 90° so arms lie on X.
    if span[1] > span[0] * 1.05:
        _apply_rot(obj, Matrix.Rotation(math.radians(90.0), 4, "Z"))
        print("STAND_UP yaw 90 so arms lie on X")


def _ensure_face_neg_y(obj):
    """Bodymath assumes the character faces -Y. Flip depth if the face points +Y."""
    co = _world_coords(obj)
    zmin, zmax = float(co[:, 2].min()), float(co[:, 2].max())
    h = max(zmax - zmin, 1e-6)
    head = co[co[:, 2] > zmax - 0.18 * h]
    mid = co[
        (co[:, 2] > zmin + 0.48 * h)
        & (co[:, 2] < zmin + 0.62 * h)
        & (np.abs(co[:, 0]) < 0.10 * h)
    ]
    if len(head) < 30 or len(mid) < 30:
        print("STAND_UP face check skipped (not enough samples)")
        return
    ty = float(np.median(mid[:, 1]))
    y_lo = float(np.percentile(head[:, 1], 2))
    y_hi = float(np.percentile(head[:, 1], 98))
    # Nose / face is the head extreme farther from the torso center.
    face_y = y_lo if abs(y_lo - ty) >= abs(y_hi - ty) else y_hi
    print(f"STAND_UP face_y={face_y:.4f} torso_y={ty:.4f}")
    if face_y <= ty:
        print("STAND_UP facing ok (-Y)")
        return
    # Reflect through XZ so face goes to -Y without swapping left/right (+X).
    print("STAND_UP mirror Y so face is -Y")
    S = Matrix.Diagonal((1.0, -1.0, 1.0, 1.0))
    obj.matrix_world = S @ obj.matrix_world
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    # Negative scale inverts normals — rebuild outward.
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def _ground_and_center(obj):
    co = _world_coords(obj)
    zmin = float(co[:, 2].min())
    cx = 0.5 * (float(co[:, 0].min()) + float(co[:, 0].max()))
    cy = 0.5 * (float(co[:, 1].min()) + float(co[:, 1].max()))
    obj.matrix_world = Matrix.Translation(Vector((-cx, -cy, -zmin))) @ obj.matrix_world
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=in_path)
body = _main_body()

# Apply any import transform into the mesh so PCA sees final verts.
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

up = np.array([0.0, 0.0, 1.0])
R_total = np.eye(3)
# Mid-torso PCA can oscillate on anime chests — damp each step and stop if lean grows.
prev_lean = None
for pass_i in range(3):
    co = _world_coords(body)
    axis = _torso_axis(co)
    dot = float(np.clip(np.dot(axis, up), -1.0, 1.0))
    lean_deg = math.degrees(math.acos(dot))
    print(
        f"STAND_UP pass={pass_i + 1} lean_deg={lean_deg:.2f} "
        f"axis=({axis[0]:.4f},{axis[1]:.4f},{axis[2]:.4f})"
    )
    if lean_deg < 1.25:
        if pass_i == 0:
            print("STAND_UP skip rotation (already upright)")
        break
    if prev_lean is not None and lean_deg >= prev_lean - 0.05:
        print("STAND_UP stop (lean not improving)")
        break
    prev_lean = lean_deg
    R_full = _rotation_a_to_b(axis, up)
    # Rodrigues angle of R_full; apply 70% to avoid overshoot.
    c = float(np.clip((np.trace(R_full) - 1.0) * 0.5, -1.0, 1.0))
    ang = math.acos(c)
    if ang < 1e-6:
        break
    # Extract axis from R_full and rebuild damped rotation.
    # R = I + sinθ K + (1-cosθ) K²; for small steps slerp via matrix power approx:
    # R_damped = exp(0.7 * log(R_full)) ≈ I + 0.7*(R_full-I) when angle is small.
    damp = 0.7
    # Rotate by damp*ang about the same axis as R_full.
    axis_r = np.array([
        R_full[2, 1] - R_full[1, 2],
        R_full[0, 2] - R_full[2, 0],
        R_full[1, 0] - R_full[0, 1],
    ], dtype=np.float64)
    n = np.linalg.norm(axis_r)
    if n < 1e-9:
        R = R_full
    else:
        axis_r = axis_r / n
        th = damp * ang
        Kx = np.array([
            [0.0, -axis_r[2], axis_r[1]],
            [axis_r[2], 0.0, -axis_r[0]],
            [-axis_r[1], axis_r[0], 0.0],
        ])
        R = np.eye(3) + math.sin(th) * Kx + (1.0 - math.cos(th)) * (Kx @ Kx)
    R_total = R @ R_total
    body.matrix_world = _as_matrix4(R) @ body.matrix_world
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

_fix_arm_axis(body)
_ensure_face_neg_y(body)
_ground_and_center(body)

# World coords after ground — used by agents to transform markers with the mesh.
co_final = _world_coords(body)
zmin_final = float(co_final[:, 2].min())
cx = 0.5 * (float(co_final[:, 0].min()) + float(co_final[:, 0].max()))
cy = 0.5 * (float(co_final[:, 1].min()) + float(co_final[:, 1].max()))
xform_path = out_path + ".stand_up_xform.json"
# out_path is .glb — write sidecar next to it
if out_path.lower().endswith(".glb"):
    xform_path = out_path[:-4] + ".stand_up_xform.json"
import json as _json
_json.dump(
    {
        "R": R_total.tolist(),
        "note": "Apply R to old marker points, then re-ground with mesh zmin after stand_up",
        "zmin": zmin_final,
        "center_xy": [cx, cy],
    },
    open(xform_path, "w", encoding="utf-8"),
    indent=2,
)
print("STAND_UP xform", xform_path)

# Drop empties / extras so the GLB is one body.
for obj in list(bpy.data.objects):
    if obj != body:
        bpy.data.objects.remove(obj, do_unlink=True)

bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
)
print("STAND_UP wrote", out_path)
