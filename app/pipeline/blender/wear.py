"""Fit the Mesh2Motion skeleton, weight the mesh, and export clips. Run by Blender.

Bone lengths follow the joints. Bone roll stays with the template so a library
quaternion still bends the same hinge. Nothing here plays a clip.
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

import addon_utils
addon_utils.enable("io_scene_gltf2")

argv = sys.argv[sys.argv.index("--") + 1:]
mesh_path, markers_path, out_dir, library = argv
os.makedirs(out_dir, exist_ok=True)
APP = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if APP not in sys.path:
    sys.path.insert(0, APP)
from pipeline.bodymath import DEFAULT_ENVELOPE_SCALES

CLIPS = {
    "idle": "idle-subtle.glb",
    "walk": "walk.glb",
    "wave": "greeting.glb",
    "run": "run-anime.glb",
    "jump": "jump-2.glb",
    "sit": "sitting-idle.glb",
    "bow": "bow.glb",
    "clap": "clapping.glb",
    "point": "interact.glb",
    "jog": "jog.glb",
    "idle-talking": "idle-talking.glb",
}
DROP = {
    "four": ("pinky_",),
    "three": ("pinky_", "ring_"),
    "mitten": ("pinky_", "ring_", "middle_", "index_", "thumb_"),
}

# Bones the jiggle mode exists for: name, parent, side (+1 is the _l side), and
# which surface of the body it drives.
SECONDARY = (
    ("breast_l", "spine_03", 1.0, "front"),
    ("breast_r", "spine_03", -1.0, "front"),
    ("glute_l", "pelvis", 1.0, "back"),
    ("glute_r", "pelvis", -1.0, "back"),
)

CHAIN = {
    "root": ("root", "pelvis"),
    "pelvis": ("pelvis", "spine_01"),
    "spine_01": ("spine_01", "spine_02"),
    "spine_02": ("spine_02", "spine_03"),
    "spine_03": ("spine_03", "neck_base"),
    "neck_01": ("neck_base", "head"),
    "head": ("head", "head_top"),
    "clavicle_l": ("clavicle_l", "upperarm_l"),
    "upperarm_l": ("upperarm_l", "lowerarm_l"),
    "lowerarm_l": ("lowerarm_l", "hand_l"),
    "hand_l": ("hand_l", "hand_tip_l"),
    "thigh_l": ("thigh_l", "calf_l"),
    "calf_l": ("calf_l", "foot_l"),
    "foot_l": ("foot_l", "ball_l"),
    "ball_l": ("ball_l", "toe_l"),
    "clavicle_r": ("clavicle_r", "upperarm_r"),
    "upperarm_r": ("upperarm_r", "lowerarm_r"),
    "lowerarm_r": ("lowerarm_r", "hand_r"),
    "hand_r": ("hand_r", "hand_tip_r"),
    "thigh_r": ("thigh_r", "calf_r"),
    "calf_r": ("calf_r", "foot_r"),
    "foot_r": ("foot_r", "ball_r"),
    "ball_r": ("ball_r", "toe_r"),
}


def log(key, value):
    print("STEP", key, json.dumps(value)[:500])


def enable_gltf():
    addon_utils.enable("io_scene_gltf2")


def load_mesh(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    body = max((o for o in new if o.type == "MESH"), key=lambda o: len(o.data.vertices))
    for o in new:
        if o is not body:
            bpy.data.objects.remove(o, do_unlink=True)
    body.name = "Body"
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return body


def load_armature(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    for o in new:
        if o is not arm:
            bpy.data.objects.remove(o, do_unlink=True)
    arm.name = "Armature"
    arm.data.name = "Armature"
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return arm


def template_snapshot(arm):
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    snap = {}
    for bone in arm.data.edit_bones:
        snap[bone.name] = {
            "head": bone.head.copy(),
            "tail": bone.tail.copy(),
            "x": bone.matrix.to_3x3().col[0].copy(),
            "parent": bone.parent.name if bone.parent else None,
            "matrix": bone.matrix.copy(),
            "length": (bone.tail - bone.head).length,
            "deform": bone.use_deform,
        }
    bpy.ops.object.mode_set(mode="OBJECT")
    return snap


def keep_roll(bone, src_x):
    y = (bone.tail - bone.head)
    if y.length < 1e-8:
        return
    y = y.normalized()
    hint = src_x - y * y.dot(src_x)
    if hint.length < 1e-8:
        return
    hint.normalize()
    bone.roll = 0.0
    current = bone.matrix.to_3x3().col[0].normalized()
    cross = current.cross(hint)
    bone.roll = math.atan2(cross.dot(y), current.dot(hint))


def _aim_fingers(eb, joints, tips, fingers, snap, placed, height):
    drop = DROP.get(fingers, ())
    for side in ("l", "r"):
        hand = joints.get(f"hand_{side}")
        palm = joints.get(f"hand_tip_{side}")
        if not hand or not palm:
            continue
        hand_v = Vector(hand)
        for digit in ("index", "middle", "ring", "pinky", "thumb"):
            if any(f"{digit}_".startswith(prefix) for prefix in drop):
                continue
            tip = (tips or {}).get(f"{digit}_{side}")
            if not tip:
                continue
            names = [f"{digit}_0{i}_{side}" for i in (1, 2, 3)]
            if any(eb.get(name) is None for name in names):
                continue
            end = Vector(tip)
            start = hand_v.lerp(end, 0.62)
            for index, name in enumerate(names):
                bone = eb[name]
                head = start.lerp(end, index / 3)
                tail = start.lerp(end, (index + 1) / 3)
                if (tail - head).length < 1e-5:
                    tail = head + Vector((0, 0.01 * height, 0))
                bone.head, bone.tail = head, tail
                if name in snap:
                    keep_roll(bone, snap[name]["x"])
                placed.append(name)
            leaf = eb.get(f"{digit}_04_leaf_{side}")
            parent = eb.get(names[-1])
            if leaf is not None and parent is not None:
                direction = parent.tail - parent.head
                if direction.length < 1e-6:
                    direction = Vector((0, 0.01 * height, 0))
                leaf.head = parent.tail.copy()
                leaf.tail = parent.tail + direction.normalized() * (0.01 * height)
                placed.append(leaf.name)


def fit_bones(arm, joints, height, zmin, fingers, snap, tips=None):
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for bone in eb:
        bone.use_connect = False
    placed = []
    for name, (head_key, tail_key) in CHAIN.items():
        bone = eb.get(name)
        if bone is None or name not in snap:
            continue
        if name == "root":
            pelvis = Vector(joints["pelvis"])
            h, t = Vector((pelvis.x, pelvis.y, zmin)), pelvis
        else:
            if head_key not in joints or tail_key not in joints:
                continue
            h, t = Vector(joints[head_key]), Vector(joints[tail_key])
        if fingers == "mitten" and name in ("hand_l", "hand_r"):
            tip = "hand_tip_l" if name.endswith("_l") else "hand_tip_r"
            if tip in joints:
                t = Vector(joints[tip])
        if (t - h).length < 1e-4:
            t = h + Vector((0, 0, 0.02 * height))
        bone.head, bone.tail = h, t
        keep_roll(bone, snap[name]["x"])
        placed.append(name)
    _aim_fingers(eb, joints, tips, fingers, snap, placed, height)

    order = []
    seen = set()

    def walk(name):
        if name in seen or name not in snap:
            return
        if snap[name]["parent"]:
            walk(snap[name]["parent"])
        seen.add(name)
        order.append(name)

    for name in snap:
        walk(name)
    for name in order:
        if name in placed or name not in eb:
            continue
        parent_name = snap[name]["parent"]
        if not parent_name or parent_name not in eb:
            continue
        parent = eb[parent_name]
        src_len = snap[parent_name]["length"]
        scale = (parent.tail - parent.head).length / src_len if src_len > 1e-6 else 1.0
        inv = snap[parent_name]["matrix"].inverted()
        local_head = inv @ snap[name]["head"]
        local_tail = inv @ snap[name]["tail"]
        axes = parent.matrix.to_3x3()
        bone = eb[name]
        bone.head = parent.head + axes @ (Vector(local_head) * scale)
        bone.tail = parent.head + axes @ (Vector(local_tail) * scale)
        if (bone.tail - bone.head).length < 1e-5:
            bone.tail = bone.head + axes.col[1].normalized() * (0.01 * height)
        keep_roll(bone, snap[name]["x"])

    drop = DROP.get(fingers, ())
    for name, rec in snap.items():
        bone = eb.get(name)
        if bone is None:
            continue
        dropped = any(name.startswith(prefix) for prefix in drop)
        bone.use_deform = (not dropped) and rec["deform"] and name != "root" and "_leaf" not in name
    bpy.ops.object.mode_set(mode="OBJECT")


def add_secondary_bones(arm, body, joints, height, tissue=None):
    """Breast and glute bones, so jiggle physics moves tissue, not a body bone.

    Each bone sits inside the surface it drives and pivots at the chest wall or
    the pelvis, and ``paint`` weights the skin over it. A rigid child of
    spine_03/pelvis deforms exactly like its parent until something rotates it,
    so an unmarked job binds and plays as before.

    ``tissue`` is the markers.json override map ({name: {head, tail}}): a
    dragged pivot wins over auto-detection for that bone.
    """
    coords = np.array([(body.matrix_world @ v.co)[:] for v in body.data.vertices], dtype=np.float64)
    if not len(coords):
        return []
    fwd = _faces_forward(arm, height)
    zs = coords[:, 2]

    def axis_of(key, axis, fallback):
        point = joints.get(key)
        if point and len(point) > axis:
            return float(point[axis])
        return float(fallback)

    spine_z = axis_of("spine_03", 2, np.percentile(zs, 62))
    spine_y = axis_of("spine_03", 1, np.median(coords[:, 1]))
    neck_z = axis_of("neck_01", 2, axis_of("head", 2, np.percentile(zs, 76)))
    pelvis_z = axis_of("pelvis", 2, np.percentile(zs, 52))
    pelvis_y = axis_of("pelvis", 1, np.median(coords[:, 1]))
    span = max(neck_z - spine_z, 0.02 * height)
    middle = 0.01 * height
    made = []
    overridden = []
    over = tissue if isinstance(tissue, dict) else {}
    for name, parent_name, hand, face in SECONDARY:
        sigma = 0.045 * height if face == "front" else 0.05 * height
        drag = over.get(name) if isinstance(over.get(name), dict) else None
        if drag is not None:
            try:
                head = Vector([float(c) for c in drag["head"]])
                tail = Vector([float(c) for c in drag["tail"]])
            except (TypeError, ValueError, KeyError):
                head = tail = None
            if head is not None and (tail - head).length >= 1e-4:
                made.append({
                    "name": name,
                    "parent": parent_name,
                    "hand": hand,
                    "place": face,
                    "head": head,
                    "tail": tail,
                    "center": np.array([head.x, head.y, head.z], dtype=np.float64),
                    "sigma": sigma,
                })
                overridden.append(name)
                continue
        if face == "front":
            band = (zs > spine_z + 0.25 * span) & (zs < neck_z - 0.05 * span)
            base_y = spine_y
            out = fwd * (coords[:, 1] - base_y)
            room = 0.24 * height
        else:
            band = (zs > pelvis_z - 0.14 * height) & (zs < pelvis_z + 0.05 * height)
            base_y = pelvis_y
            out = -fwd * (coords[:, 1] - base_y)
            room = 0.22 * height
        mine = band & (np.abs(coords[:, 0]) < room) & (coords[:, 0] * hand > middle) & (out > 0.01 * height)
        if not mine.any():
            continue
        reach = float(np.max(out[mine]))
        shell = coords[mine & (out > 0.55 * reach)]
        if not len(shell):
            continue
        # Pivot 40% of the way out from the body centre, so the surface swings
        # around the chest wall or pelvis instead of sliding off it.
        cy = float(shell[:, 1].mean())
        head = Vector((float(shell[:, 0].mean()), base_y + (cy - base_y) * 0.4, float(shell[:, 2].mean())))
        reach_out = 0.06 * height
        if face == "front":
            tail = head + Vector((0.0, fwd * reach_out, 0.015 * height))
        else:
            tail = head + Vector((0.0, -fwd * reach_out, -0.010 * height))
        made.append({
            "name": name,
            "parent": parent_name,
            "hand": hand,
            "place": face,
            "head": head,
            "tail": tail,
            "center": np.array([head.x, head.y, head.z], dtype=np.float64),
            "sigma": sigma,
        })
    if not made:
        return [], []
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for rec in made:
        bone = eb.get(rec["name"])
        if bone is None:
            bone = eb.new(rec["name"])
        bone.head = rec["head"]
        bone.tail = rec["tail"]
        bone.use_connect = False
        bone.use_deform = True
        bone.parent = eb.get(rec["parent"])
    bpy.ops.object.mode_set(mode="OBJECT")
    return made, overridden


def _faces_forward(arm, height):
    """+1 when the character faces +Y. The toes point forward; the chin is the fallback."""
    for name in ("foot_l", "foot_r"):
        bone = arm.data.bones.get(name)
        if bone is None:
            continue
        step = bone.tail_local.y - bone.head_local.y
        if abs(step) > 0.02 * height:
            return 1.0 if step > 0 else -1.0
    return 1.0


def paint(body, arm, height, det, secondary=()):
    bones = [b for b in arm.data.bones if b.use_deform and "_leaf" not in b.name and not b.name.startswith(("ik_", "socket"))]
    mw = arm.matrix_world
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
    envelopes = det.get("envelopes") or {}
    tags = det.get("tags") or {}
    applied = {
        n: float(envelopes[n]) if n in envelopes else float(DEFAULT_ENVELOPE_SCALES.get(n, 1.0))
        for n in names
    }
    scales = np.array([applied[n] for n in names], dtype=np.float64)
    sigma = (0.02 * height * scales) ** 2
    neck_i = index.get("neck_01")
    head_i = index.get("head")
    spine03_i = index.get("spine_03")
    foot_l_i = index.get("foot_l")
    foot_r_i = index.get("foot_r")
    calf_l_i = index.get("calf_l")
    calf_r_i = index.get("calf_r")
    neck_z = float(heads[neck_i][2]) if neck_i is not None else None
    head_z = float(heads[head_i][2]) if head_i is not None else None
    foot_l_z = float(heads[foot_l_i][2]) if foot_l_i is not None else None
    foot_r_z = float(heads[foot_r_i][2]) if foot_r_i is not None else None
    side = 0.06 * height
    collar_r = 0.035 * height
    coords = np.array([(body.matrix_world @ v.co)[:] for v in body.data.vertices], dtype=np.float64)
    # Tissue bones never win the nearest-bone search; the falloff below feeds
    # them instead, so the region stays predictable.
    tissue = [(index[r["name"]], r["center"], float(r["sigma"]), float(r.get("hand", 1.0)), r["name"])
              for r in secondary if r["name"] in index]
    groups = {}
    for n in names:
        groups[n] = body.vertex_groups.new(name=n)
    weights = {n: [] for n in names}
    finger_sum = 0.0
    head_sum = 0.0
    for start in range(0, len(coords), 25000):
        pts = coords[start:start + 25000]
        ab = tails - heads
        ap = pts[:, None, :] - heads[None, :, :]
        denom = np.sum(ab * ab, axis=1) + 1e-12
        t = np.clip(np.sum(ap * ab[None, :, :], axis=2) / denom[None, :], 0, 1)
        closest = heads[None, :, :] + ab[None, :, :] * t[:, :, None]
        dist = np.linalg.norm(pts[:, None, :] - closest, axis=2)
        for local, vert in enumerate(pts):
            vi = start + local
            d = dist[local].copy()
            for tissue_i, _center, _sigma, _hand, _tname in tissue:
                d[tissue_i] = 1e6
            if neck_z is not None and head_i is not None and vert[2] < neck_z - 0.02 * height:
                d[head_i] = 1e6
            # Hair / crown above the head joint — neck must not own these verts.
            if neck_i is not None and head_z is not None and vert[2] > head_z + 0.02 * height:
                d[neck_i] = 1e6
            # Thin collar only — AF keeps neck as a small band, not trapezius/jaw/chest.
            if neck_i is not None and neck_z is not None:
                if (
                    abs(vert[2] - neck_z) > 0.055 * height
                    or abs(vert[0]) > 0.08 * height
                    or d[neck_i] > collar_r
                ):
                    d[neck_i] = 1e6
            # Face / throat only — keep jaw off clavicle/upperarm. Do NOT widen this into
            # the trapezius: that hands shoulder skin to neck/head and yanks it into hair.
            if neck_z is not None:
                face_x = 0.07 * height
                throat_x = 0.045 * height
                if vert[2] > neck_z - 0.02 * height and abs(vert[0]) < face_x:
                    if spine03_i is not None:
                        d[spine03_i] = 1e6
                    for i, name in enumerate(names):
                        if name.startswith(("clavicle_", "upperarm_", "lowerarm_", "hand_")):
                            d[i] = 1e6
                elif (neck_z - 0.05 * height) < vert[2] < (neck_z + 0.04 * height) and abs(vert[0]) < throat_x:
                    for i, name in enumerate(names):
                        if name.startswith(("upperarm_", "clavicle_")):
                            d[i] = 1e6
            # Sole / ankle: foot owns below the foot joint so calf does not wash out toes.
            if foot_l_i is not None and calf_l_i is not None and foot_l_z is not None:
                if vert[2] < foot_l_z + 0.04 * height and vert[0] > -side:
                    d[calf_l_i] = 1e6
            if foot_r_i is not None and calf_r_i is not None and foot_r_z is not None:
                if vert[2] < foot_r_z + 0.04 * height and vert[0] < side:
                    d[calf_r_i] = 1e6
            # Arm tubes — AF keeps upper/lowerarm on the limb, not a wide chest bloom.
            arm_r = 0.05 * height
            for i, name in enumerate(names):
                if name.startswith(("upperarm_", "lowerarm_")) and d[i] > arm_r:
                    d[i] = 1e6

            for i, name in enumerate(names):
                if name.endswith("_l") and vert[0] < -side:
                    d[i] = 1e6
                elif name.endswith("_r") and vert[0] > side:
                    d[i] = 1e6
            nearest = int(np.argmin(d))
            tag = tags.get(names[nearest], "body")
            if tag == "prop":
                weights[names[nearest]].append((vi, 1.0))
                continue
            use = {nearest, parent[nearest]}
            use.update(children.get(nearest, ()))
            use.discard(-1)
            # Shoulder / trapezius / neck owners must not blend with head — that pulls
            # deltoid and collar into the hair when head/neck pose moves. Head volume
            # likewise must not share with neck (AF keeps a thin collar, strong head).
            nearest_name = names[nearest]
            if head_i is not None and (
                nearest_name.startswith(("clavicle_", "upperarm_", "lowerarm_"))
                or nearest_name in ("spine_03", "neck_01")
            ):
                use.discard(head_i)
            if nearest_name == "head" and neck_i is not None:
                use.discard(neck_i)
            sig = sigma[nearest] * (4.0 if tag == "cloth" else 1.0)
            chosen = []
            for i in use:
                if d[i] > 1e5:
                    continue
                w = 1.0 / (d[i] * d[i] + sig)
                if w >= 0.01:
                    chosen.append((i, w))
            if not chosen:
                chosen = [(nearest, 1.0)]
            chosen.sort(key=lambda item: -item[1])
            chosen = chosen[:4]
            total = sum(w for _, w in chosen) or 1.0
            # Hand weight to the tissue bones. Each one takes a Gaussian share
            # around its pivot and only on its own side, scaling down whatever
            # the body bones claimed. The surface stays attached because the
            # weight moves off the parent instead of being added.
            steal = []
            for tissue_i, center, tsig, thand, _tname in tissue:
                if vert[0] * thand <= 0:
                    continue
                delta = vert - center
                w = float(np.exp(-float(delta @ delta) / (2.0 * tsig * tsig)))
                if w >= 0.01:
                    steal.append((tissue_i, w))
            if steal:
                take = min(sum(w for _, w in steal), 0.85)
                keep = 1.0 - take
                norm = take / sum(w for _, w in steal)
                merged = [(i, w / total * keep) for i, w in chosen]
                merged += [(i, w * norm) for i, w in steal]
                merged.sort(key=lambda item: -item[1])
                merged = merged[:4]
                mtotal = sum(w for _, w in merged) or 1.0
                for i, w in merged:
                    weights[names[i]].append((vi, w / mtotal))
                    if names[i].startswith(("index_", "middle_", "ring_", "pinky_", "thumb_")):
                        finger_sum += w / mtotal
                    if names[i] == "head":
                        head_sum += w / mtotal
            else:
                for i, w in chosen:
                    weights[names[i]].append((vi, w / total))
                    if names[i].startswith(("index_", "middle_", "ring_", "pinky_", "thumb_")):
                        finger_sum += w / total
                    if names[i] == "head":
                        head_sum += w / total
    for name, pairs in weights.items():
        bins = {}
        for vi, w in pairs:
            bins.setdefault(int(round(w * 100)), []).append(vi)
        for key, ids in bins.items():
            groups[name].add(ids, max(key, 1) / 100.0, "REPLACE")
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    touched = np.zeros(len(coords), dtype=bool)
    for pairs in weights.values():
        for vi, _w in pairs:
            touched[vi] = True
    log("weights", {
        "method": "region_envelope",
        "bones": len(names),
        "verts": int(len(coords)),
        "unweighted": int((~touched).sum()),
        "envelopes": envelopes,
        "envelope_scales": {k: round(v, 3) for k, v in applied.items() if abs(v - 1.0) > 1e-6},
        "tags": tags,
        "finger_weight": round(finger_sum, 1),
        "head_weight": round(head_sum, 1),
        "secondary": sorted({names[i] for i, _, _, _, _ in tissue}) if tissue else [],
    })


def action_range(action):
    start, end = action.frame_range
    return int(round(start)), int(round(end))


def _parent_space_rest(pb):
    rest = pb.bone.matrix_local
    if pb.parent:
        return pb.parent.bone.matrix_local.inverted() @ rest
    return rest.copy()


def _armature_height(arm):
    zs = []
    mw = arm.matrix_world
    for bone in arm.data.bones:
        zs.append((mw @ bone.head_local).z)
        zs.append((mw @ bone.tail_local).z)
    return (max(zs) - min(zs)) if zs else 1.0


def copy_clip(dst, src, clip_id):
    """Bake library motion onto dst with parent-space rest correction.

    Raw local quaternions assume matching bone axes. After fit_bones the
    character's parent-space rests diverge, so idle/walk pull in a lean and
    yank the hips. Conjugate each source basis rotation into dst axes, and
    only transfer scaled root location (never raw pelvis translation).
    """
    if src.animation_data is None or src.animation_data.action is None:
        raise RuntimeError(f"{clip_id} has no action")
    src_action = src.animation_data.action
    start, end = action_range(src_action)
    if end <= start:
        end = start + 1
    dst.animation_data_create()
    action = bpy.data.actions.new(clip_id)
    action.use_fake_user = True
    dst.animation_data.action = action
    if hasattr(action, "slots") and hasattr(dst.animation_data, "action_slot"):
        try:
            slot = action.slots.new("OBJECT", dst.name)
            dst.animation_data.action_slot = slot
        except Exception:
            pass
    scene = bpy.context.scene
    src.animation_data.action = src_action
    src_h = _armature_height(src)
    dst_h = _armature_height(dst)
    loc_scale = (dst_h / src_h) if src_h > 1e-6 else 1.0
    corr = {}
    for bone in dst.pose.bones:
        src_bone = src.pose.bones.get(bone.name)
        if src_bone is None:
            continue
        src_axes = _parent_space_rest(src_bone).to_3x3()
        dst_axes = _parent_space_rest(bone).to_3x3()
        corr[bone.name] = dst_axes.inverted() @ src_axes
    frames = list(range(start, end + 1))
    frames.append(start)  # loop-close: the last pose is the first pose
    for out_i, frame in enumerate(frames):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        written = out_i + 1
        for bone in dst.pose.bones:
            src_bone = src.pose.bones.get(bone.name)
            if src_bone is None:
                continue
            loc, rot, _scale = src_bone.matrix_basis.decompose()
            c = corr[bone.name]
            dst_r = c @ rot.to_matrix() @ c.inverted()
            bone.rotation_mode = "QUATERNION"
            bone.rotation_quaternion = dst_r.to_quaternion()
            bone.keyframe_insert("rotation_quaternion", frame=written)
            if bone.name == "root":
                bone.location = Vector(loc) * loc_scale
                bone.keyframe_insert("location", frame=written)
    action.frame_range
    return end - start + 1


def import_armature(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next((o for o in new if o.type == "ARMATURE"), None)
    return arm, new


def remove_objects(objs):
    for o in objs:
        if o and o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)


TEAR_RATIO = 2.5
CRUSH_RATIO = 1.0 / TEAR_RATIO


def _weight_table(body):
    names = {g.index: g.name for g in body.vertex_groups}
    table = []
    for vert in body.data.vertices:
        pairs = []
        for slot in vert.groups:
            weight = float(slot.weight)
            if weight < 0.05:
                continue
            pairs.append((names.get(slot.group, str(slot.group)), round(weight, 3)))
        pairs.sort(key=lambda item: -item[1])
        table.append(pairs[:4])
    return table


def _edge_bones(table, a, b):
    merged = {}
    for index in (int(a), int(b)):
        if index < 0 or index >= len(table):
            continue
        for name, weight in table[index]:
            merged[name] = max(merged.get(name, 0.0), weight)
    ranked = sorted(merged.items(), key=lambda item: -item[1])[:4]
    owner = ranked[0][0] if ranked else None
    return [[name, weight] for name, weight in ranked], owner


def _bind_heads(arm):
    mw = arm.matrix_world
    heads = {}
    for bone in arm.data.bones:
        if not bone.use_deform:
            continue
        head = mw @ bone.head_local
        heads[bone.name] = [round(head.x, 4), round(head.y, 4), round(head.z, 4)]
    return heads


def _top(counts, limit=8):
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return {name: count for name, count in ranked[:limit]}


def _sorted_counts(counts):
    return {name: count for name, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))}


def _interpenetrations(ids, rest, posed, owners, linked, touch):
    """Vertices from different bones that were apart at rest and now occupy one spot."""
    if touch <= 1e-8:
        return []
    grid = {}
    for index in ids:
        cell = (
            int(math.floor(posed[index][0] / touch)),
            int(math.floor(posed[index][1] / touch)),
            int(math.floor(posed[index][2] / touch)),
        )
        grid.setdefault(cell, []).append(index)
    hits = []
    far = touch * 4.0
    for index in ids:
        cell = (
            int(math.floor(posed[index][0] / touch)),
            int(math.floor(posed[index][1] / touch)),
            int(math.floor(posed[index][2] / touch)),
        )
        origin = posed[index]
        rest_i = rest[index]
        bone_i = owners.get(index)
        if not bone_i:
            continue
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for other in grid.get((cell[0] + dx, cell[1] + dy, cell[2] + dz), ()):
                        if other <= index:
                            continue
                        bone_o = owners.get(other)
                        if not bone_o or bone_o == bone_i:
                            continue
                        pair = (index, other)
                        if pair in linked:
                            continue
                        other_p = posed[other]
                        dxp = origin[0] - other_p[0]
                        dyp = origin[1] - other_p[1]
                        dzp = origin[2] - other_p[2]
                        dist = math.sqrt(dxp * dxp + dyp * dyp + dzp * dzp)
                        if dist > touch:
                            continue
                        rest_o = rest[other]
                        dxr = rest_i[0] - rest_o[0]
                        dyr = rest_i[1] - rest_o[1]
                        dzr = rest_i[2] - rest_o[2]
                        rest_dist = math.sqrt(dxr * dxr + dyr * dyr + dzr * dzr)
                        if rest_dist < far:
                            continue
                        hits.append({
                            "verts": [index, other],
                            "rest": round(rest_dist, 5),
                            "posed": round(dist, 5),
                            "bones": [bone_i, bone_o],
                        })
    return hits


def deform_gate(body, arm):
    rest = {}
    for edge in body.data.edges:
        a, b = edge.vertices
        rest[edge.index] = (body.data.vertices[a].co - body.data.vertices[b].co).length
    sample = list(rest)[::max(1, len(rest) // 4000)]
    lengths = sorted(rest[i] for i in sample if rest[i] > 1e-6)
    median = lengths[len(lengths) // 2] if lengths else 0.0
    touch = median * 0.75
    weights = _weight_table(body)
    owners = {index: pairs[0][0] for index, pairs in enumerate(weights) if pairs}
    scene = bpy.context.scene
    poses = {}
    detail = {}
    tears = 0
    used_bones = set()
    frames = [("idle", 30), ("walk", 1), ("walk", 9), ("walk", 25), ("sit", 20)]
    for clip, frame in frames:
        act = bpy.data.actions.get(clip)
        if act is None:
            continue
        arm.animation_data.action = act
        scene.frame_set(min(frame, int(act.frame_range[1])))
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        ev = body.evaluated_get(deps)
        me = ev.to_mesh()
        stretch = 1.0
        shrink = 1.0
        bad = 0
        torn = []
        crushed_edges = []
        tear_bones = {}
        crush_bones = {}
        posed = {}
        rest_co = {}
        ids = []
        linked = set()
        seen_verts = set()
        for idx in sample:
            if idx >= len(me.edges):
                continue
            a, b = me.edges[idx].vertices
            length = (me.vertices[a].co - me.vertices[b].co).length
            base = rest.get(idx) or 1e-6
            ratio = length / base if base > 1e-6 else 1.0
            stretch = max(stretch, ratio)
            shrink = min(shrink, ratio)
            bones, owner = _edge_bones(weights, a, b)
            record = {
                "edge": int(idx),
                "verts": [int(a), int(b)],
                "rest": round(base, 5),
                "posed": round(length, 5),
                "ratio": round(ratio, 3),
                "bones": bones,
            }
            if ratio > TEAR_RATIO:
                bad += 1
                torn.append(record)
                if owner:
                    tear_bones[owner] = tear_bones.get(owner, 0) + 1
                    used_bones.add(owner)
            elif ratio < CRUSH_RATIO:
                crushed_edges.append(record)
                if owner:
                    crush_bones[owner] = crush_bones.get(owner, 0) + 1
                    used_bones.add(owner)
            linked.add((min(int(a), int(b)), max(int(a), int(b))))
            for vert in (int(a), int(b)):
                if vert in seen_verts:
                    continue
                seen_verts.add(vert)
                co = me.vertices[vert].co
                posed[vert] = (float(co.x), float(co.y), float(co.z))
                src = body.data.vertices[vert].co
                rest_co[vert] = (float(src.x), float(src.y), float(src.z))
                ids.append(vert)
        ev.to_mesh_clear()
        hits = _interpenetrations(ids, rest_co, posed, owners, linked, touch)
        hit_bones = {}
        for hit in hits:
            for name in hit["bones"]:
                hit_bones[name] = hit_bones.get(name, 0) + 1
                used_bones.add(name)
        key = f"{clip}@{frame}"
        poses[key] = {"tears": bad, "max_stretch": round(stretch, 3)}
        detail[key] = {
            "tears": torn,
            "crushes": crushed_edges,
            "interpenetrations": hits[:300],
            "interpenetration_count": len(hits),
            "tear_bones": _sorted_counts(tear_bones),
            "crush_bones": _sorted_counts(crush_bones),
            "interpenetrate_bones": _sorted_counts(hit_bones),
            "min_ratio": round(shrink, 3),
            "max_stretch": round(stretch, 3),
        }
        tears += bad
        log("deform_pose", {
            "pose": key,
            "tears": bad,
            "max_stretch": round(stretch, 3),
            "crushes": len(crushed_edges),
            "min_ratio": round(shrink, 3),
            "interpenetrations": len(hits),
            "tear_bones": _top(tear_bones),
            "crush_bones": _top(crush_bones),
        })
    arm.animation_data.action = None
    scene.frame_set(1)
    gate = "PASS" if tears == 0 else "FAIL"
    log("deform_qa", {"gate": gate, "edges": len(sample), "poses": poses})
    heads = _bind_heads(arm)
    payload = {
        "gate": gate,
        "gate_counts": "tears only; an edge tears when posed/rest > 2.5",
        "crush_ratio": round(CRUSH_RATIO, 3),
        "touch": round(touch, 5),
        "sampled_edges": len(sample),
        "interpenetrate": (
            "two sampled vertices on different bones, at least 4x the touch "
            "distance apart at rest, now within the touch distance"
        ),
        "bind_positions": {name: heads[name] for name in sorted(used_bones) if name in heads},
        "poses": detail,
    }
    path = os.path.join(out_dir, "deform_attribution.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh)
    log("deform_attr", {"file": path, "bones": len(payload["bind_positions"]), "gate": gate})
    return gate


def main():
    enable_gltf()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    det = json.load(open(markers_path, encoding="utf-8"))
    joints = det["joints"]
    body = load_mesh(mesh_path)
    zs = [body.matrix_world @ v.co for v in body.data.vertices]
    zmin = min(p.z for p in zs)
    zmax = max(p.z for p in zs)
    height = float(det.get("height") or (zmax - zmin))
    arm = load_armature(os.path.join(library, "skeleton.glb"))
    snap = template_snapshot(arm)
    fingers = det.get("fingers") or "five"
    fit_bones(arm, joints, height, zmin, fingers, snap, det.get("finger_tips") or {})
    secondary, overruled = add_secondary_bones(arm, body, joints, height, det.get("tissue") or {})
    deform = sum(1 for b in arm.data.bones if b.use_deform)
    log("skeleton", {"bones": len(arm.data.bones), "source": "mesh2motion", "deform": deform, "fingers": fingers,
                     "secondary": [r["name"] for r in secondary], "tissue_overrides": overruled})
    body.parent = arm
    mod = body.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    paint(body, arm, height, det, secondary)
    copied = {}
    for clip_id, filename in CLIPS.items():
        path = os.path.join(library, "animations", filename)
        src, created = import_armature(path)
        if src is None:
            copied[clip_id] = 0
            remove_objects(created)
            continue
        copied[clip_id] = copy_clip(arm, src, clip_id)
        remove_objects(created)
    log("library_clips", copied)
    gate = deform_gate(body, arm)
    arm.animation_data.action = None
    bpy.context.scene.frame_set(1)
    blend = os.path.join(out_dir, "rigged.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    glb = os.path.join(out_dir, "rigged_animated.glb")
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=glb,
        export_format="GLB",
        use_selection=True,
        export_skins=True,
        export_animations=True,
        export_yup=True,
        export_animation_mode="ACTIONS",
    )
    report = {"steps": {"deform_qa": {"gate": gate}, "library_clips": copied}}
    # The STEP lines are the source of truth; also keep a small report.
    with open(os.path.join(out_dir, "report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=1)
    with open(os.path.join(out_dir, "joints.json"), "w", encoding="utf-8") as fh:
        json.dump(det, fh, indent=1)
    extra = [{"name": r["name"], "parent": r["parent"], "place": r["place"],
              "head": [round(float(v), 5) for v in r["head"]],
              "tail": [round(float(v), 5) for v in r["tail"]]} for r in secondary]
    with open(os.path.join(out_dir, "extra_bones.json"), "w", encoding="utf-8") as fh:
        json.dump(extra, fh, indent=1)
    log("secondary", {"bones": [r["name"] for r in secondary], "file": "extra_bones.json"})
    log("export", {"glb": glb, "bytes": os.path.getsize(glb)})
    print("DONE", gate)


if __name__ == "__main__":
    main()
