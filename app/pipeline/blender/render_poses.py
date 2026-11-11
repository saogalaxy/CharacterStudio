"""Render per-clip thumbs + a contact sheet from rigged.blend.

blender -b -P render_poses.py -- <rigged.blend> <out_prefix> action:frame ...

Writes:
  <out_prefix>.png                 contact sheet (front + side rows)
  <dir(out_prefix)>/<action>_front.png   AF-style library thumbs
"""
import bpy, sys, math, os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
blend, out = argv[0], argv[1]
shots = [a.split(":") for a in argv[2:]]
bpy.ops.wm.open_mainfile(filepath=blend)
scn = bpy.context.scene
rig = bpy.data.objects["Armature"]
body = bpy.data.objects["Body"]
co = [body.matrix_world @ v.co for v in body.data.vertices]
mn = Vector((min(p.x for p in co), min(p.y for p in co), min(p.z for p in co)))
mx = Vector((max(p.x for p in co), max(p.y for p in co), max(p.z for p in co)))
c, size = (mn + mx) / 2, max(mx - mn) * 1.1

scn.render.engine = "BLENDER_WORKBENCH"
scn.display.shading.light = "STUDIO"
scn.display.shading.color_type = "MATERIAL"
scn.render.resolution_x, scn.render.resolution_y = 420, 520
cd = bpy.data.cameras.new("c")
cd.type, cd.ortho_scale, cd.clip_end = "ORTHO", size, size * 20
cam = bpy.data.objects.new("c", cd)
scn.collection.objects.link(cam)
scn.camera = cam

rig_dir = os.path.dirname(out) or "."
thumb_dir = os.path.join(rig_dir, "poses")
os.makedirs(thumb_dir, exist_ok=True)
tiles = []
for i, (act, fr) in enumerate(shots):
    rig.animation_data.action = bpy.data.actions[act]
    scn.frame_set(int(fr))
    for view, d in (("front", Vector((0.35, -1, 0.15))), ("side", Vector((1, 0, 0.1)))):
        cam.location = c + d.normalized() * size * 4
        cam.rotation_mode = "QUATERNION"
        cam.rotation_quaternion = (c - cam.location).to_track_quat("-Z", "Y")
        p = f"{out}_{i:02d}_{act}_{fr}_{view}.png"
        scn.render.filepath = p
        bpy.ops.render.render(write_still=True)
        tiles.append(p)
        if view == "front":
            import shutil
            thumb = os.path.join(thumb_dir, f"{act}_front.png")
            shutil.copy2(p, thumb)

# stitch into one sheet (2 rows: front / side)
cols = len(shots)
W, Hh = 420, 520
sheet = bpy.data.images.new("sheet", W * cols, Hh * 2, alpha=False)
import numpy as np
buf = np.ones((Hh * 2, W * cols, 4), dtype=np.float32)
for i in range(cols):
    for r, view in enumerate(("front", "side")):
        img = bpy.data.images.load(tiles[i * 2 + r])
        px = np.array(img.pixels[:], dtype=np.float32).reshape(Hh, W, 4)
        y0 = (1 - r) * Hh
        buf[y0:y0 + Hh, i * W:(i + 1) * W] = px
sheet.pixels = buf.ravel()
sheet.filepath_raw = out + ".png"
sheet.file_format = "PNG"
sheet.save()
for t in tiles:
    os.remove(t)
print("SHEET", out + ".png")
print("THUMBS", thumb_dir)
