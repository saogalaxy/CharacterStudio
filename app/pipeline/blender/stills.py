"""Render front and side stills of named clips. Run by Blender."""
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
blend, out_dir = argv[0], argv[1]
shots = [a.split(":") for a in argv[2:]]
os.makedirs(out_dir, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=blend)
scene = bpy.context.scene
arm = bpy.data.objects["Armature"]
body = bpy.data.objects["Body"]
pts = [body.matrix_world @ v.co for v in body.data.vertices]
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
center, size = (mn + mx) / 2, max(mx - mn) * 1.15
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "MATERIAL"
scene.render.resolution_x = 420
scene.render.resolution_y = 520
cam_data = bpy.data.cameras.new("still")
cam_data.type = "ORTHO"
cam_data.ortho_scale = size
cam_data.clip_end = size * 20
cam = bpy.data.objects.new("still", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
views = {"front": Vector((0.2, -1, 0.12)), "side": Vector((1, 0, 0.08))}
for act, frame in shots:
    action = bpy.data.actions.get(act)
    if action is None:
        print("SKIP", act)
        continue
    arm.animation_data.action = action
    scene.frame_set(int(frame))
    for view, direction in views.items():
        if view == "side" and act not in ("walk", "farm_harvest"):
            continue
        cam.location = center + direction.normalized() * size * 4
        cam.rotation_mode = "QUATERNION"
        cam.rotation_quaternion = (center - cam.location).to_track_quat("-Z", "Y")
        path = os.path.join(out_dir, f"{act}_{view}.png" if view == "front" or act in ("walk", "farm_harvest") else f"{act}_{view}.png")
        if view == "side":
            path = os.path.join(out_dir, f"{act}_{frame}_{view}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print("STILL", path)
print("STILLS DONE")
