"""Pack the saved motions into one GLB on the character. Run by Blender."""
import json
import os
import sys

import bpy

import addon_utils
addon_utils.enable("io_scene_gltf2")

argv = sys.argv[sys.argv.index("--") + 1:]
rig_path, manifest_path, out_path = argv


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
    frames.append(start)
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
    return end - start + 1


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
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            obj.select_set(True)
    bpy.context.view_layer.objects.active = arm
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_skins=True,
        export_animations=True,
        export_yup=True,
        export_animation_mode="ACTIONS",
    )
    log("pack", {"clips": copied, "bytes": os.path.getsize(out_path)})
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
