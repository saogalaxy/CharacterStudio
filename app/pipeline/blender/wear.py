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
DROP = {
    "four": ("pinky_",),
    "three": ("pinky_", "ring_"),
    "mitten": ("pinky_", "ring_", "middle_", "index_", "thumb_"),
}

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
        palm_v = Vector(palm)
        for digit in ("index", "middle", "ring", "pinky", "thumb"):
            if any(f"{digit}_".startswith(prefix) for prefix in drop):
                continue
            tip = (tips or {}).get(f"{digit}_{side}")
            if not tip:
                continue
            names = [f"{digit}_0{i}_{side}" for i in (1, 2, 3)]
            if any(eb.get(name) is None for name in names):
                continue
            start = hand_v.lerp(palm_v, 0.35)
            end = Vector(tip)
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


def paint(body, arm, height, det):
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
    scales = np.array([float(envelopes.get(n, 1.0)) for n in names], dtype=np.float64)
    sigma = (0.02 * height * scales) ** 2
    neck_i = index.get("neck_01")
    head_i = index.get("head")
    neck_z = float(heads[neck_i][2]) if neck_i is not None else None
    side = 0.06 * height
    coords = np.array([(body.matrix_world @ v.co)[:] for v in body.data.vertices], dtype=np.float64)
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
            if neck_z is not None and head_i is not None and vert[2] < neck_z - 0.02 * height:
                d[head_i] = 1e6
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
        "tags": tags,
        "finger_weight": round(finger_sum, 1),
        "head_weight": round(head_sum, 1),
    })


def action_range(action):
    start, end = action.frame_range
    return int(round(start)), int(round(end))


def copy_clip(dst, src, clip_id):
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
            bone.rotation_mode = "QUATERNION"
            bone.rotation_quaternion = src_bone.rotation_quaternion.copy()
            bone.keyframe_insert("rotation_quaternion", frame=written)
            if bone.name in ("pelvis", "root"):
                bone.location = src_bone.location.copy()
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


def deform_gate(body, arm):
    rest = {}
    for edge in body.data.edges:
        a, b = edge.vertices
        rest[edge.index] = (body.data.vertices[a].co - body.data.vertices[b].co).length
    sample = list(rest)[::max(1, len(rest) // 4000)]
    scene = bpy.context.scene
    poses = {}
    worst = 1.0
    tears = 0
    action = bpy.data.actions.get("walk") or bpy.data.actions.get("idle")
    frames = [("idle", 30), ("walk", 1), ("walk", 9), ("walk", 25), ("mild_crouch", 20)]
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
        bad = 0
        for idx in sample:
            if idx >= len(me.edges):
                continue
            a, b = me.edges[idx].vertices
            length = (me.vertices[a].co - me.vertices[b].co).length
            base = rest.get(idx) or 1e-6
            ratio = length / base if base > 1e-6 else 1.0
            stretch = max(stretch, ratio)
            if ratio > 2.5:
                bad += 1
        ev.to_mesh_clear()
        poses[f"{clip}@{frame}"] = {"tears": bad, "max_stretch": round(stretch, 3)}
        worst = max(worst, stretch)
        tears += bad
    arm.animation_data.action = None
    scene.frame_set(1)
    gate = "PASS" if tears == 0 else "FAIL"
    log("deform_qa", {"gate": gate, "edges": len(sample), "poses": poses})
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
    deform = sum(1 for b in arm.data.bones if b.use_deform)
    log("skeleton", {"bones": len(arm.data.bones), "source": "mesh2motion", "deform": deform, "fingers": fingers})
    body.parent = arm
    mod = body.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    paint(body, arm, height, det)
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
    log("export", {"glb": glb, "bytes": os.path.getsize(glb)})
    print("DONE", gate)


if __name__ == "__main__":
    main()
