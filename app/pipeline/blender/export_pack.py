"""Write the common hand-off files for a character.

blender -b -P export_pack.py -- <mesh.glb> <out_dir> [rigged.blend] [animations.json]

Always writes (for Mixamo auto-rig / Action Forge auto-rig):
  mesh_for_mixamo.fbx          unrigged mesh, textures embedded
  mesh_for_actionforge.glb     unrigged T-pose mesh

If rigged.blend is given, also writes:
  rigged_animated.fbx          skin + named clips (Unity / Unreal / AF +Rigged)
  rigged_animated.glb          same, filtered by animations.json when provided
"""
import json
import os
import shutil
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

args = common.args()
mesh_glb, out = args[0], args[1]
rig_blend = args[2] if len(args) > 2 else None
anim_json = args[3] if len(args) > 3 else None
os.makedirs(out, exist_ok=True)
action_fcurves = common.action_fcurves


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def only_mesh():
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for m in list(body.modifiers):
        body.modifiers.remove(m)
    body.vertex_groups.clear()
    body.name = "Body"
    return body


def write_readme(path, has_rig, clip_names=None):
    lines = [
        "Character Studio exports",
        "",
        "mesh_for_mixamo.fbx",
        "  Upload to mixamo.com → Upload Character (auto-rig).",
        "  Unrigged T-pose, textures embedded. Mixamo does not accept GLB.",
        "",
        "mesh_for_actionforge.glb",
        "  Import into Action Forge as an unrigged character for AF auto-rig.",
        "",
    ]
    if has_rig:
        clips = ", ".join(clip_names) if clip_names else "idle/walk/crouch/wave/farm_harvest"
        lines += [
            "rigged_animated.glb",
            f"  Our UE5-named skin + selected clips ({clips}).",
            "  Action Forge: import as + Rigged character (do not re-auto-rig).",
            "  Also works in Blender / three.js / many glTF viewers.",
            "",
            "rigged_animated.fbx",
            "  Same rigged character for Unity / Unreal / tools that want FBX.",
            "  Action Forge + Rigged also accepts this if GLB fails.",
            "",
        ]
    else:
        lines += [
            "No rigged files yet — run Rig in Character Studio first.",
            "",
        ]
    path.write_text("\n".join(lines), encoding="utf-8")


def load_anim_settings(path):
    if not path or not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _bone_from_path(data_path):
    # pose.bones["upperarm_l"].rotation_quaternion
    if 'pose.bones["' not in data_path:
        return None, None
    try:
        name = data_path.split('pose.bones["', 1)[1].split('"]', 1)[0]
        prop = data_path.split('"].', 1)[1]
        return name, prop
    except Exception:
        return None, None


def _quat_at(curves, i):
    from mathutils import Quaternion
    return Quaternion((
        curves[3].keyframe_points[i].co.y,  # w
        curves[0].keyframe_points[i].co.y,  # x
        curves[1].keyframe_points[i].co.y,  # y
        curves[2].keyframe_points[i].co.y,  # z
    ))


def _set_quat_at(curves, i, q):
    # Blender Quaternion is (w, x, y, z); fcurves are x,y,z,w by array_index
    vals = (q.x, q.y, q.z, q.w)
    for axis, fc in enumerate(curves):
        kp = fc.keyframe_points[i]
        kp.co.y = vals[axis]
        kp.handle_left.y = vals[axis]
        kp.handle_right.y = vals[axis]


def _apply_fit_to_action(act, fit):
    """Warp clip keyframes like Action Forge offsets: armSpace / armFwd / overdrive."""
    from mathutils import Quaternion, Vector
    import math
    import re

    if not fit:
        return
    arms = float(fit.get("arms", 1.0) or 1.0)
    legs = float(fit.get("legs", 1.0) or 1.0)
    if fit.get("arm_space") is not None:
        arm_space = float(fit.get("arm_space") or 0.0)
    else:
        arm_space = float(fit.get("arm_raise", 0.0) or 0.0)
    arm_fwd = float(fit.get("arm_fwd", 0.0) or 0.0)
    hip = float(fit.get("hip", 0.0) or 0.0)
    turn = float(fit.get("turn", 0.0) or 0.0)
    if (abs(arms - 1.0) < 1e-6 and abs(legs - 1.0) < 1e-6 and abs(arm_space) < 1e-6
            and abs(arm_fwd) < 1e-6 and abs(hip) < 1e-6 and abs(turn) < 1e-6):
        return

    arm_re = re.compile(r"(clavicle|upperarm|lowerarm|hand)_([lr])$")
    leg_re = re.compile(r"(thigh|calf|foot|ball)_([lr])$")
    # Group quaternion fcurves by bone
    quat_groups = {}
    loc_groups = {}
    for fc in action_fcurves(act):
        bone, prop = _bone_from_path(fc.data_path)
        if not bone or not prop:
            continue
        if prop == "rotation_quaternion":
            quat_groups.setdefault(bone, {})[fc.array_index] = fc
        elif prop == "location":
            loc_groups.setdefault(bone, {})[fc.array_index] = fc

    identity = Quaternion((1, 0, 0, 0))
    # Lockstep with viewer.js _applyFit: local q = q @ R(axis, radians * mirror).
    # arm_space axis +Z, arm_fwd axis (0, -1, 0). Right arm flips the angle.
    space_rad = math.radians(arm_space)
    fwd_rad = math.radians(arm_fwd)
    turn_q = Quaternion((0, 0, 1), math.radians(turn)) if abs(turn) > 1e-8 else None

    for bone, axes in quat_groups.items():
        if not all(i in axes for i in (0, 1, 2, 3)):
            continue
        curves = [axes[0], axes[1], axes[2], axes[3]]
        n = len(curves[0].keyframe_points)
        if any(len(c.keyframe_points) != n for c in curves):
            continue
        is_arm = bool(arm_re.match(bone))
        is_leg = bool(leg_re.match(bone))
        amount = arms if is_arm else (legs if is_leg else None)
        mirror = -1.0 if bone.endswith("_r") else 1.0
        space_q = Quaternion((0, 0, 1), space_rad * mirror) if abs(space_rad) > 1e-8 and bone.startswith("upperarm") else None
        fwd_q = Quaternion((0, -1, 0), fwd_rad * mirror) if abs(fwd_rad) > 1e-8 and bone.startswith("upperarm") else None
        for i in range(n):
            q = _quat_at(curves, i)
            if amount is not None and abs(amount - 1.0) > 1e-6:
                q = identity.slerp(q, amount)
            if space_q is not None:
                q = q @ space_q
            if fwd_q is not None:
                q = q @ fwd_q
            if bone == "pelvis" and turn_q is not None:
                q = turn_q @ q
            _set_quat_at(curves, i, q)
        for fc in curves:
            fc.update()

    # Hip height: nudge pelvis location along bone-local up (−Z drop space → +Z raise)
    if abs(hip) > 1e-6 and "pelvis" in loc_groups:
        # Prefer world-up-ish channel. Studio keys pelvis with Z as vertical drop.
        z_fc = loc_groups["pelvis"].get(2)
        if z_fc is not None:
            for kp in z_fc.keyframe_points:
                kp.co.y += hip
                kp.handle_left.y += hip
                kp.handle_right.y += hip
            z_fc.update()


def apply_anim_settings(settings):
    """Keep enabled clips, apply speed + Mixamo/AF limb fit. Returns kept names."""
    if not settings:
        return [a.name for a in bpy.data.actions]
    clips = settings.get("clips") or {}
    kept = []
    for act in list(bpy.data.actions):
        meta = clips.get(act.name)
        if meta is not None and not meta.get("enabled", True):
            bpy.data.actions.remove(act)
            continue
        speed = float((meta or {}).get("speed", 1.0) or 1.0)
        speed = max(0.25, min(3.0, speed))
        if abs(speed - 1.0) > 1e-3:
            for fc in action_fcurves(act):
                for kp in fc.keyframe_points:
                    # keep frame 1 anchored; scale duration
                    kp.co.x = 1.0 + (kp.co.x - 1.0) / speed
                    kp.handle_left.x = 1.0 + (kp.handle_left.x - 1.0) / speed
                    kp.handle_right.x = 1.0 + (kp.handle_right.x - 1.0) / speed
                fc.update()
        _apply_fit_to_action(act, (meta or {}).get("fit"))
        kept.append(act.name)
    return kept


# ---- unrigged mesh for Mixamo + AF auto-rig --------------------------------
clear_scene()
bpy.ops.import_scene.gltf(filepath=mesh_glb)
body = only_mesh()
for o in bpy.context.scene.objects:
    o.select_set(o == body)

mixamo = os.path.join(out, "mesh_for_mixamo.fbx")
bpy.ops.export_scene.fbx(
    filepath=mixamo,
    use_selection=True,
    object_types={"MESH"},
    path_mode="COPY",
    embed_textures=True,
    apply_scale_options="FBX_SCALE_ALL",
    axis_forward="-Z",
    axis_up="Y",
    add_leaf_bones=False,
    bake_anim=False,
)

af_mesh = os.path.join(out, "mesh_for_actionforge.glb")
bpy.ops.export_scene.gltf(
    filepath=af_mesh,
    export_format="GLB",
    use_selection=True,
    export_skins=False,
    export_animations=False,
    export_yup=True,
    export_apply=True,
)

written = {"mesh_for_mixamo.fbx": os.path.getsize(mixamo),
           "mesh_for_actionforge.glb": os.path.getsize(af_mesh)}

# ---- rigged character ------------------------------------------------------
has_rig = False
kept_clips = None
if rig_blend and os.path.isfile(rig_blend):
    clear_scene()
    bpy.ops.wm.open_mainfile(filepath=rig_blend)
    settings = load_anim_settings(anim_json)
    kept_clips = apply_anim_settings(settings)
    for o in bpy.context.scene.objects:
        o.select_set(o.type in ("MESH", "ARMATURE"))
    fbx = os.path.join(out, "rigged_animated.fbx")
    bpy.ops.export_scene.fbx(
        filepath=fbx,
        use_selection=True,
        object_types={"ARMATURE", "MESH"},
        path_mode="COPY",
        embed_textures=True,
        apply_scale_options="FBX_SCALE_ALL",
        axis_forward="-Z",
        axis_up="Y",
        add_leaf_bones=False,
        bake_anim=True,
        bake_anim_use_all_actions=True,
        bake_anim_use_nla_strips=False,
        bake_anim_use_all_bones=True,
        bake_anim_force_startend_keying=True,
    )
    written["rigged_animated.fbx"] = os.path.getsize(fbx)

    glb = os.path.join(out, "rigged_animated.glb")
    # Always re-export GLB from the (possibly filtered) blend so clip picks apply
    bpy.ops.export_scene.gltf(
        filepath=glb,
        export_format="GLB",
        use_selection=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_yup=True,
        export_apply=False,
    )
    written["rigged_animated.glb"] = os.path.getsize(glb)
    # Studio preview keeps the unfitted clip so live Fit sliders do not double-apply.
    # Only refresh preview when this export did not warp by anim settings.
    if not settings:
        src_dir = os.path.dirname(rig_blend)
        preview = os.path.join(src_dir, "rigged_animated.glb")
        shutil.copy2(glb, preview)
    has_rig = True

write_readme(__import__("pathlib").Path(out) / "README.txt", has_rig, kept_clips)
print("EXPORT", written, "clips", kept_clips)
