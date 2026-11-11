"""Fit the Mesh2Motion skeleton onto a character and copy its clips locally.

The library clips are authored on this bone set (UE5 names, including fingers).
Bone lengths follow the character. Bone rolls stay with the template, so a
library quaternion still bends the same hinge.
"""
import math
import os

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
LIBRARY = os.path.abspath(os.path.join(HERE, "..", "..", "..", "library", "mesh2motion"))
TEMPLATE = os.path.join(LIBRARY, "skeleton.glb")
ANIMS = os.path.join(LIBRARY, "animations")

# Studio joint that is the head of each template bone. Tails point at the next joint.
_HEAD = {
    "pelvis": "pelvis",
    "spine_01": "spine_01",
    "spine_02": "spine_02",
    "spine_03": "spine_03",
    "neck_01": "neck_base",
    "head": "head",
    "clavicle_l": "clavicle_l", "clavicle_r": "clavicle_r",
    "upperarm_l": "upperarm_l", "upperarm_r": "upperarm_r",
    "lowerarm_l": "lowerarm_l", "lowerarm_r": "lowerarm_r",
    "hand_l": "hand_l", "hand_r": "hand_r",
    "thigh_l": "thigh_l", "thigh_r": "thigh_r",
    "calf_l": "calf_l", "calf_r": "calf_r",
    "foot_l": "foot_l", "foot_r": "foot_r",
    "ball_l": "ball_l", "ball_r": "ball_r",
}
_TAIL = {
    "pelvis": "spine_01",
    "spine_01": "spine_02",
    "spine_02": "spine_03",
    "spine_03": "neck_base",
    "neck_01": "head",
    "head": "head_top",
    "clavicle_l": "upperarm_l", "clavicle_r": "upperarm_r",
    "upperarm_l": "lowerarm_l", "upperarm_r": "lowerarm_r",
    "lowerarm_l": "hand_l", "lowerarm_r": "hand_r",
    "thigh_l": "calf_l", "thigh_r": "calf_r",
    "calf_l": "foot_l", "calf_r": "foot_r",
    "foot_l": "ball_l", "foot_r": "ball_r",
    "ball_l": "toe_l", "ball_r": "toe_r",
}


def _vec(joints, name, fallback=None):
    if name in joints:
        return Vector(joints[name])
    return fallback


def _match_roll(bone, template_y, template_x):
    """Keep the template hinge after the bone is aimed along the character.

    align_roll() does not land on this axis for bones that lie along X (the
    forearms and hands), so the roll is set from the signed angle instead.
    """
    y = bone.tail - bone.head
    if y.length < 1e-6 or template_y.length < 1e-6:
        return
    y = y.normalized()
    ref = template_y.normalized().rotation_difference(y) @ template_x
    x = ref - y * ref.dot(y)
    if x.length < 1e-4:
        return
    x = x.normalized()
    target_z = x.cross(y)
    bone.roll = 0.0
    z0 = bone.z_axis.normalized()
    bone.roll = math.atan2(z0.cross(target_z).dot(y), z0.dot(target_z))


def _record(arm):
    out = {}
    for b in arm.data.edit_bones:
        y = b.tail - b.head
        out[b.name] = {
            "head": b.head.copy(),
            "tail": b.tail.copy(),
            "x": b.x_axis.copy(),
            "y": y.copy(),
            "length": y.length,
            "parent": b.parent.name if b.parent else None,
            "deform": b.use_deform,
            "matrix": b.matrix.copy(),
        }
    return out


def _knuckle_frac(tmpl, side):
    hand = tmpl.get(f"hand_{side}")
    leaf = tmpl.get(f"middle_04_leaf_{side}")
    if not hand or not leaf or hand["length"] < 1e-6:
        return 0.55
    reach = (leaf["tail"] - hand["tail"]).length
    return hand["length"] / max(hand["length"] + reach, 1e-6)


def fit(joints, height, zmin):
    """Import the Mesh2Motion skeleton and fit it to these joints. Returns the armature."""
    if not os.path.isfile(TEMPLATE):
        raise RuntimeError("Mesh2Motion skeleton is missing at library/mesh2motion/skeleton.glb")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=TEMPLATE)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next((o for o in new if o.type == "ARMATURE"), None)
    if arm is None:
        raise RuntimeError("Mesh2Motion skeleton has no armature")
    for o in new:
        if o is not arm:
            bpy.data.objects.remove(o, do_unlink=True)
    arm.name = "Armature"
    arm.data.name = "Armature"
    arm.parent = None
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    bpy.ops.object.mode_set(mode="EDIT")
    tmpl = _record(arm)
    eb = arm.data.edit_bones
    for b in eb:
        b.use_connect = False

    frac_l, frac_r = _knuckle_frac(tmpl, "l"), _knuckle_frac(tmpl, "r")
    pelvis = _vec(joints, "pelvis")

    def head_of(bone_name):
        if bone_name == "root":
            return Vector((pelvis.x, pelvis.y, zmin))
        key = _HEAD.get(bone_name)
        if key is None:
            return None
        if key == "neck_base" and key not in joints:
            return _vec(joints, "neck")
        return _vec(joints, key) if key in joints else None

    def tail_of(bone_name):
        if bone_name == "root":
            return pelvis.copy()
        if bone_name == "hand_l":
            return _vec(joints, "hand_l").lerp(_vec(joints, "hand_tip_l"), frac_l)
        if bone_name == "hand_r":
            return _vec(joints, "hand_r").lerp(_vec(joints, "hand_tip_r"), frac_r)
        key = _TAIL.get(bone_name)
        if key and key in joints:
            return _vec(joints, key)
        # spine tail falls back along pelvis → neck when a joint is missing
        if bone_name in ("pelvis", "spine_01", "spine_02", "spine_03", "neck_01"):
            return None
        return None

    mapped = []
    for name, bone in [(n, eb[n]) for n in eb.keys() if n in tmpl]:
        h, t = head_of(name), tail_of(name)
        if h is None or t is None:
            continue
        if (t - h).length < 1e-4:
            t = h + Vector((0, 0, 0.02 * height))
        bone.head, bone.tail = h, t
        _match_roll(bone, tmpl[name]["y"], tmpl[name]["x"])
        mapped.append(name)

    # Fingers, leaf bones: same local offset as the template, scaled with the parent.
    order = []
    seen = set()

    def walk(name):
        if name in seen or name not in eb:
            return
        parent = tmpl[name]["parent"]
        if parent:
            walk(parent)
        seen.add(name)
        order.append(name)

    for name in list(eb.keys()):
        walk(name)
    mapped_set = set(mapped)
    for name in order:
        if name in mapped_set:
            continue
        bone = eb[name]
        parent_name = tmpl[name]["parent"]
        if not parent_name or parent_name not in eb:
            continue
        parent = eb[parent_name]
        src_len = tmpl[parent_name]["length"]
        scale = (parent.tail - parent.head).length / src_len if src_len > 1e-6 else 1.0
        inv = tmpl[parent_name]["matrix"].inverted()
        local_head = inv @ tmpl[name]["head"]
        local_tail = inv @ tmpl[name]["tail"]
        axes = parent.matrix.to_3x3()
        bone.head = parent.head + axes @ (Vector(local_head) * scale)
        bone.tail = parent.head + axes @ (Vector(local_tail) * scale)
        if (bone.tail - bone.head).length < 1e-5:
            bone.tail = bone.head + axes.col[1].normalized() * (0.01 * height)
        _match_roll(bone, tmpl[name]["y"], tmpl[name]["x"])

    for name, rec in tmpl.items():
        bone = eb[name]
        bone.use_deform = bool(rec["deform"]) and name != "root" and "_leaf" not in name

    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def copy_clip(rig, glb_path, action_name):
    """Write one library clip onto rig as a local-quaternion action. Returns frames keyed."""
    if not os.path.isfile(glb_path):
        return 0
    before = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    new_objs = [o for o in bpy.data.objects if o not in before]
    src = next((o for o in new_objs if o.type == "ARMATURE"), None)
    new_actions = [a for a in bpy.data.actions if a not in before_actions]
    if src is None or not new_actions and not (src and src.animation_data and src.animation_data.action):
        for o in new_objs:
            bpy.data.objects.remove(o, do_unlink=True)
        return 0
    src_act = new_actions[0] if new_actions else src.animation_data.action
    if src.animation_data is None:
        src.animation_data_create()
    src.animation_data.action = src_act
    try:
        slots = list(getattr(src.animation_data, "action_suitable_slots", []) or [])
        if slots and hasattr(src.animation_data, "action_slot"):
            src.animation_data.action_slot = slots[0]
    except Exception:
        pass

    frame_start = int(src_act.frame_range[0])
    frame_end = int(src_act.frame_range[1])
    if frame_end <= frame_start:
        frame_end = frame_start + 1
    src_h = max((b.head_local.z for b in src.data.bones), default=1.0) - min((b.head_local.z for b in src.data.bones), default=0.0)
    dst_h = max((b.head_local.z for b in rig.data.bones), default=1.0) - min((b.head_local.z for b in rig.data.bones), default=0.0)
    hip_scale = (dst_h / src_h) if src_h > 1e-4 else 1.0

    if action_name in bpy.data.actions:
        bpy.data.actions.remove(bpy.data.actions[action_name])
    dst = bpy.data.actions.new(action_name)
    dst.use_fake_user = True
    if rig.animation_data is None:
        rig.animation_data_create()
    rig.animation_data.action = dst
    try:
        slots = list(getattr(rig.animation_data, "action_suitable_slots", []) or [])
        if slots and hasattr(rig.animation_data, "action_slot"):
            rig.animation_data.action_slot = slots[0]
    except Exception:
        pass

    src_by = {b.name: b for b in src.pose.bones}
    ours = {b.name: b for b in rig.pose.bones}
    loc_bones = {"root", "pelvis"}
    keyed = 0
    for fr in range(frame_start, frame_end + 1):
        bpy.context.scene.frame_set(fr)
        bpy.context.view_layer.update()
        local = fr - frame_start + 1
        for name, dpb in ours.items():
            spb = src_by.get(name)
            if spb is None:
                continue
            dpb.rotation_mode = "QUATERNION"
            dpb.rotation_quaternion = spb.rotation_quaternion.copy()
            if name in loc_bones:
                dpb.location = Vector(spb.location) * hip_scale
                dpb.keyframe_insert("location", frame=local)
            else:
                dpb.location = (0.0, 0.0, 0.0)
            dpb.keyframe_insert("rotation_quaternion", frame=local)
            keyed += 1

    for o in new_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in new_actions:
        if a != dst and a.name != action_name:
            try:
                bpy.data.actions.remove(a)
            except Exception:
                pass
    return keyed
