"""Import an FBX/GLB animation onto the Studio UE5 skeleton.

blender -b -P import_motion.py -- <rigged.blend> <motion.fbx|glb> <clip_name> <out_dir>

The rig is the Mesh2Motion skeleton fitted to the character, so a library
quaternion is already in the right local space. Copy it straight across.
Hip and root travel is scaled to this character's height. Other bones keep
their rest positions so the joints are not locked in world space.
"""
import json
import os
import re
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

blend, motion, clip_name, out = common.args()[:4]
os.makedirs(out, exist_ok=True)

ALIAS = {
    "hips": "pelvis", "pelvis": "pelvis", "root": "root",
    "spine": "spine_01", "spine1": "spine_02", "spine2": "spine_03",
    "spine_01": "spine_01", "spine_02": "spine_02", "spine_03": "spine_03",
    "neck": "neck_01", "neck_01": "neck_01", "head": "head",
    "leftshoulder": "clavicle_l", "rightshoulder": "clavicle_r",
    "clavicle_l": "clavicle_l", "clavicle_r": "clavicle_r",
    "leftarm": "upperarm_l", "rightarm": "upperarm_r",
    "leftforearm": "lowerarm_l", "rightforearm": "lowerarm_r",
    "lefthand": "hand_l", "righthand": "hand_r",
    "upperarm_l": "upperarm_l", "upperarm_r": "upperarm_r",
    "lowerarm_l": "lowerarm_l", "lowerarm_r": "lowerarm_r",
    "hand_l": "hand_l", "hand_r": "hand_r",
    "leftupleg": "thigh_l", "rightupleg": "thigh_r",
    "leftleg": "calf_l", "rightleg": "calf_r",
    "leftfoot": "foot_l", "rightfoot": "foot_r",
    "lefttoebase": "ball_l", "righttoebase": "ball_r",
    "thigh_l": "thigh_l", "thigh_r": "thigh_r",
    "calf_l": "calf_l", "calf_r": "calf_r",
    "foot_l": "foot_l", "foot_r": "foot_r",
    "ball_l": "ball_l", "ball_r": "ball_r",
}

LOC_BONES = {"root", "pelvis"}


def norm(name):
    n = name.split(":")[-1]
    n = re.sub(r"[^a-z0-9]", "", n.lower())
    for prefix in ("mixamorig", "armature", "bip001", "bip01"):
        if n.startswith(prefix):
            n = n[len(prefix):]
    return n


def map_bone(name, ours):
    n = norm(name)
    if name in ours:
        return name
    if n in ALIAS and ALIAS[n] in ours:
        return ALIAS[n]
    return None


def armature_height(arm):
    zs = [b.head_local.z for b in arm.data.bones] or [0.0]
    ys = [b.head_local.y for b in arm.data.bones] or [0.0]
    # Prefer vertical span (Blender Z-up); fall back to Y if flat
    span_z = max(zs) - min(zs)
    span_y = max(ys) - min(ys)
    return max(span_z, span_y, 1e-3)


def hierarchy_order(arm):
    bones = list(arm.pose.bones)
    rank = {}

    def depth(b):
        if b.name in rank:
            return rank[b.name]
        d = 0 if b.parent is None else depth(b.parent) + 1
        rank[b.name] = d
        return d

    for b in bones:
        depth(b)
    return sorted(bones, key=lambda b: rank[b.name])


bpy.ops.wm.open_mainfile(filepath=blend)
rig = bpy.data.objects.get("Armature")
body = bpy.data.objects.get("Body")
if not rig:
    raise RuntimeError("rigged.blend has no Armature")
ours = {b.name for b in rig.data.bones}

before = set(bpy.data.objects)
before_actions = set(bpy.data.actions)
ext = os.path.splitext(motion)[1].lower()
if ext in (".fbx",):
    bpy.ops.import_scene.fbx(filepath=motion, automatic_bone_orientation=True)
elif ext in (".glb", ".gltf"):
    bpy.ops.import_scene.gltf(filepath=motion)
else:
    raise RuntimeError("motion must be .fbx, .glb, or .gltf")

new_objs = [o for o in bpy.data.objects if o not in before]
src_arm = next((o for o in new_objs if o.type == "ARMATURE"), None)
new_actions = [a for a in bpy.data.actions if a not in before_actions]
if not new_actions and src_arm and src_arm.animation_data and src_arm.animation_data.action:
    new_actions = [src_arm.animation_data.action]
if not new_actions:
    raise RuntimeError("no animation tracks found in the motion file")

src_act = new_actions[0]
frame_start = int(src_act.frame_range[0])
frame_end = int(src_act.frame_range[1])
if frame_end <= frame_start:
    frame_end = frame_start + 30

if src_arm:
    if not src_arm.animation_data:
        src_arm.animation_data_create()
    src_arm.animation_data.action = src_act
    try:
        slots = list(getattr(src_arm.animation_data, "action_suitable_slots", []) or [])
        if slots and hasattr(src_arm.animation_data, "action_slot"):
            src_arm.animation_data.action_slot = slots[0]
    except Exception:
        pass

if clip_name in bpy.data.actions:
    bpy.data.actions.remove(bpy.data.actions[clip_name])
dst = bpy.data.actions.new(clip_name)
dst.use_fake_user = True
rig.animation_data_create()
rig.animation_data.action = dst

# Build src→dst pairs
pairs = []
if src_arm:
    src_by = {b.name: b for b in src_arm.pose.bones}
    for dpb in hierarchy_order(rig):
        spb = src_by.get(dpb.name)
        if spb is None:
            for cand in src_arm.pose.bones:
                if map_bone(cand.name, ours) == dpb.name:
                    spb = cand
                    break
        if spb is None:
            continue
        pairs.append((spb, dpb))

hip_scale = 1.0
if src_arm:
    hip_scale = armature_height(rig) / armature_height(src_arm)

keyed_count = 0
for fr in range(frame_start, frame_end + 1):
    bpy.context.scene.frame_set(fr)
    bpy.context.view_layer.update()
    local_frame = fr - frame_start + 1
    for spb, dpb in pairs:
        src_loc, _src_rot, _src_scale = spb.matrix_basis.decompose()
        dpb.rotation_mode = "QUATERNION"
        dpb.rotation_quaternion = spb.rotation_quaternion.copy()
        if dpb.name in LOC_BONES:
            dpb.location = Vector(src_loc) * hip_scale
            dpb.keyframe_insert("location", frame=local_frame)
        else:
            dpb.location = (0.0, 0.0, 0.0)
        dpb.keyframe_insert("rotation_quaternion", frame=local_frame)
        keyed_count += 1

if keyed_count == 0 and not common.action_has_keys(dst) and src_act:
    for fc in common.action_fcurves(src_act):
        m = re.search(r'pose\.bones\["([^"]+)"\]\.(.+)', fc.data_path)
        if not m:
            continue
        target = map_bone(m.group(1), ours)
        if not target:
            continue
        new_path = f'pose.bones["{target}"].{m.group(2)}'
        nfc = common.action_new_fcurve(dst, new_path, fc.array_index, datablock=rig)
        for kp in fc.keyframe_points:
            nfc.keyframe_points.insert(kp.co.x - frame_start + 1, kp.co.y, options={"FAST"})
        nfc.update()

if keyed_count == 0 and not common.action_has_keys(dst):
    raise RuntimeError("no bones could be retargeted from this motion file")

for o in new_objs:
    bpy.data.objects.remove(o, do_unlink=True)
for a in new_actions:
    if a != dst and a.name != clip_name:
        try:
            bpy.data.actions.remove(a)
        except Exception:
            pass

duration = max(1, frame_end - frame_start + 1)
bpy.ops.wm.save_as_mainfile(filepath=blend)

for o in bpy.context.scene.objects:
    o.select_set(o in (rig, body) if body else o == rig)
glb = os.path.join(out, "rigged_animated.glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_skins=True,
                          export_animations=True, export_animation_mode="ACTIONS", export_yup=True,
                          export_apply=False)

meta = {
    "clip": clip_name,
    "duration": duration,
    "frames": duration,
    "thumb_frame": max(1, duration // 2),
    "keyed": keyed_count,
    "retarget": "local_copy",
    "hip_scale": round(hip_scale, 4),
}
json.dump(meta, open(os.path.join(out, "import_last.json"), "w"), indent=1)
print("IMPORT", meta)
