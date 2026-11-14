"""Pack the saved motions onto the character and write chosen formats. Run by Blender."""
import json
import os
import sys

import bpy
from mathutils import Vector

import addon_utils
addon_utils.enable("io_scene_gltf2")

argv = sys.argv[sys.argv.index("--") + 1:]
rig_path, manifest_path, out_stem = argv[:3]
formats = ["glb"]
if len(argv) > 3 and argv[3].strip():
    raw = json.loads(argv[3])
    if isinstance(raw, list) and raw:
        formats = [str(item).lower() for item in raw]


def log(step, payload):
    print("STEP", step, json.dumps(payload), flush=True)


def action_range(action):
    start, end = action.frame_range
    return int(round(start)), int(round(end))


def import_armature(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next((o for o in new if o.type == "ARMATURE"), None)
    return arm, new


def remove_objects(objs):
    for obj in objs:
        if obj and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)


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
    frames.append(start)
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
    return end - start + 1


def _select_export(arm):
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            obj.select_set(True)
    bpy.context.view_layer.objects.active = arm


def _write_format(fmt, stem, arm):
    _select_export(arm)
    out_dir = os.path.dirname(stem)
    os.makedirs(out_dir, exist_ok=True)
    # Named by type so multi-format exports are obvious in the folder.
    path = f"{stem}_{fmt}.{fmt}"
    if fmt == "glb":
        bpy.ops.export_scene.gltf(
            filepath=path,
            export_format="GLB",
            use_selection=True,
            export_skins=True,
            export_animations=True,
            export_yup=True,
            export_animation_mode="ACTIONS",
        )
        return path
    if fmt == "gltf":
        bpy.ops.export_scene.gltf(
            filepath=path,
            export_format="GLTF_EMBEDDED",
            use_selection=True,
            export_skins=True,
            export_animations=True,
            export_yup=True,
            export_animation_mode="ACTIONS",
        )
        return path
    if fmt == "fbx":
        bpy.ops.export_scene.fbx(
            filepath=path,
            use_selection=True,
            object_types={"ARMATURE", "MESH"},
            add_leaf_bones=False,
            bake_anim=True,
            bake_anim_use_all_actions=True,
            bake_anim_use_nla_strips=False,
            bake_anim_force_startend_keying=True,
            path_mode="COPY",
            embed_textures=True,
        )
        return path
    raise RuntimeError(f"unknown export format {fmt}")


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    manifest = json.load(open(manifest_path, encoding="utf-8"))
    keep = [item["id"] for item in manifest]
    import_armature(rig_path)
    arm = next((obj for obj in bpy.data.objects if obj.type == "ARMATURE"), None)
    if arm is None:
        raise RuntimeError("rig has no skeleton")
    copied = {}
    for item in manifest:
        clip_id = item["id"]
        if bpy.data.actions.get(clip_id) is not None:
            copied[clip_id] = "kept"
            continue
        path = item.get("file") or ""
        if not path or not os.path.isfile(path):
            copied[clip_id] = "missing"
            continue
        created = []
        try:
            src, created = import_armature(path)
            if src is None:
                copied[clip_id] = "missing"
                continue
            copied[clip_id] = copy_clip(arm, src, clip_id)
        except Exception as exc:
            copied[clip_id] = f"skip {exc}"
        finally:
            remove_objects(created)
    for action in list(bpy.data.actions):
        action.use_fake_user = action.name in keep
        if action.name not in keep:
            bpy.data.actions.remove(action)
    if arm.animation_data:
        arm.animation_data.action = None
    bpy.context.scene.frame_set(1)
    stem = out_stem
    lower = stem.lower()
    for ext in (".glb", ".gltf", ".fbx"):
        if lower.endswith(ext):
            stem = stem[: -len(ext)]
            break
    # Drop a trailing _glb/_gltf/_fbx if a typed name was passed as the stem.
    for suffix in ("_glb", "_gltf", "_fbx"):
        if stem.lower().endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    written = {}
    for fmt in formats:
        path = _write_format(fmt, stem, arm)
        written[fmt] = {"path": path, "bytes": os.path.getsize(path)}
        log("pack", {"format": fmt, "clips": copied, "bytes": written[fmt]["bytes"]})
    print("DONE", json.dumps({"formats": written}), flush=True)


if __name__ == "__main__":
    main()
