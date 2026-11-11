"""Insert / replace a pose key on a named action, then refresh the preview GLB.

blender -b -P key_clip.py -- <rigged.blend> <out_dir> <clip_name> <frame> <pose.json>

pose.json: { "bone": {"quat": [x,y,z,w], "loc": [x,y,z] }, ... }
Coordinates are Blender armature local (same as three.js bone.quaternion / position
when the glTF was exported with our naming).
"""
import json
import os
import sys

import bpy
from mathutils import Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

blend, out, clip_name, frame_s, pose_path = common.args()[:5]
frame = int(float(frame_s))
pose = json.load(open(pose_path, encoding="utf-8"))

bpy.ops.wm.open_mainfile(filepath=blend)
rig = bpy.data.objects.get("Armature")
body = bpy.data.objects.get("Body")
if not rig:
    raise RuntimeError("no Armature")
if clip_name not in bpy.data.actions:
    raise RuntimeError(f"no action named {clip_name}")

rig.animation_data_create()
rig.animation_data.action = bpy.data.actions[clip_name]
bpy.context.scene.frame_set(frame)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE")

for name, data in pose.items():
    pb = rig.pose.bones.get(name)
    if not pb:
        continue
    q = data.get("quat")
    if q and len(q) == 4:
        pb.rotation_mode = "QUATERNION"
        # three.js / glTF quat is (x,y,z,w); Blender Quaternion is (w,x,y,z)
        pb.rotation_quaternion = Quaternion((q[3], q[0], q[1], q[2]))
        pb.keyframe_insert("rotation_quaternion", frame=frame)
    loc = data.get("loc")
    if loc and len(loc) == 3:
        pb.location = Vector(loc)
        pb.keyframe_insert("location", frame=frame)

bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.wm.save_as_mainfile(filepath=blend)

for o in bpy.context.scene.objects:
    o.select_set(o in (rig, body) if body else o == rig)
glb = os.path.join(out, "rigged_animated.glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_skins=True,
                          export_animations=True, export_animation_mode="ACTIONS", export_yup=True,
                          export_apply=False)

act = bpy.data.actions[clip_name]
duration = int(act.frame_range[1] - act.frame_range[0]) + 1
meta = {"clip": clip_name, "frame": frame, "duration": max(1, duration)}
json.dump(meta, open(os.path.join(out, "key_last.json"), "w"), indent=1)
print("KEY", meta)
